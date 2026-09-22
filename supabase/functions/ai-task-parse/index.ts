import { corsHeaders } from '../_shared/cors.ts'

/**
 * ai-task-parse
 * แปลงภาษาธรรมชาติเป็น task fields
 * Priority: GROQ_API_KEY → GEMINI_API_KEY → OPENAI_API_KEY
 * Always returns HTTP 200; errors go in { error: string }
 */

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type SectionHint = { id: string; title: string }

type ParseInput = {
  text: string
  today?: string          // YYYY-MM-DD
  sections?: SectionHint[]
}

function buildPrompt(input: ParseInput): string {
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const sectionList = (input.sections ?? []).map(s => `  - "${s.title}" (id: ${s.id})`).join('\n') || '  (ไม่มี)'

  return `คุณคือผู้ช่วยสร้าง Task ในระบบจัดการงานขององค์กร YEC หอการค้าไทย
วันที่วันนี้คือ ${today} (ปี ค.ศ. ${today.slice(0, 4)})

รายการ Section ที่มีอยู่ในระบบ:
${sectionList}

ข้อความจากผู้ใช้:
"${input.text}"

แปลงข้อความเป็น JSON เท่านั้น ไม่ต้องมีคำอธิบาย ไม่ต้องมี code block

รูปแบบที่ต้องการ:
{
  "title": "<ชื่องานกระชับ ไม่เกิน 80 ตัวอักษร>",
  "description": "<รายละเอียดเพิ่มเติมถ้ามี หรือ null>",
  "start_date": "<YYYY-MM-DD หรือ null>",
  "end_date": "<YYYY-MM-DD หรือ null>",
  "start_time": "<HH:MM หรือ null>",
  "end_time": "<HH:MM หรือ null>",
  "section_id": "<id ของ section ที่เหมาะสมที่สุด หรือ null>",
  "tags": ["<tag1>", "<tag2>"]
}

กฎ:
- title ต้องไม่ว่าง
- วันที่ให้คิดจากวันนี้ (${today}) เช่น "วันพรุ่งนี้" = ${new Date(new Date(today).getTime() + 86400000).toISOString().slice(0, 10)}, "สัปดาห์หน้า" = วันจันทร์ถัดไป
- ถ้าข้อความระบุเพียงวันเดียว ให้ start_date = end_date
- tags ไม่เกิน 4 อัน เป็นคำสั้นๆ เช่น "ประชุม", "ส่งรายงาน", "อีเวนต์"
- section_id ให้เลือก section ที่เหมาะกับงานที่สุด ถ้าไม่มีที่เหมาะเลยให้ใส่ null
- ตอบ JSON เท่านั้น`
}

function parseJson(content: string) {
  const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  const match = stripped.match(/\{[\s\S]*\}/)
  if (!match) return { error: `แปลง JSON ไม่ได้: ${content.slice(0, 200)}` }
  try {
    return JSON.parse(match[0])
  } catch {
    return { error: `JSON ไม่ถูกต้อง: ${content.slice(0, 200)}` }
  }
}

// ── Groq ──────────────────────────────────────────────────
async function callGroq(prompt: string, key: string) {
  const models = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
  ]
  let lastErr = 'Groq: ไม่พบ model ที่ใช้งานได้'
  for (const model of models) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.1,
      }),
    })
    const raw = await res.text()
    if (res.ok) {
      const content: string = JSON.parse(raw)?.choices?.[0]?.message?.content ?? ''
      return content ? parseJson(content) : { error: 'Groq ไม่ส่งผลลัพธ์กลับมา' }
    }
    let msg = raw
    try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    lastErr = `Groq/${model} (${res.status}): ${msg}`
    const body = (() => { try { return JSON.parse(raw) } catch { return {} } })()
    const code: string = body?.error?.code ?? ''
    if (res.status !== 404 && code !== 'model_not_found') return { error: lastErr }
  }
  return { error: lastErr }
}

// ── Gemini ────────────────────────────────────────────────
async function callGemini(prompt: string, key: string) {
  const MODELS = [
    { v: 'v1beta', m: 'gemini-2.0-flash-lite' },
    { v: 'v1beta', m: 'gemini-2.0-flash' },
    { v: 'v1', m: 'gemini-1.5-flash' },
  ]
  let lastErr = 'Gemini: ไม่พบ model ที่ใช้งานได้'
  for (const { v, m } of MODELS) {
    const url = `https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${key}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.1 },
      }),
    })
    const raw = await res.text()
    if (res.ok) {
      const content: string = JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      return content ? parseJson(content) : { error: 'Gemini ไม่ส่งผลลัพธ์กลับมา' }
    }
    let msg = raw
    try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    lastErr = `Gemini/${m} (${res.status}): ${msg}`
    if (res.status !== 404 && res.status !== 429) return { error: lastErr }
  }
  return { error: lastErr }
}

// ── OpenAI ────────────────────────────────────────────────
async function callOpenAI(prompt: string, key: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    }),
  })
  const raw = await res.text()
  if (!res.ok) {
    let msg = raw
    try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    return { error: `OpenAI (${res.status}): ${msg}` }
  }
  const content: string = JSON.parse(raw)?.choices?.[0]?.message?.content ?? ''
  return content ? parseJson(content) : { error: 'OpenAI ไม่ส่งผลลัพธ์กลับมา' }
}

// ── Main ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json() as ParseInput
    if (!input.text?.trim()) return ok({ error: 'text is required' })

    const prompt = buildPrompt(input)
    const groqKey   = Deno.env.get('GROQ_API_KEY')
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    if (groqKey) {
      const r = await callGroq(prompt, groqKey)
      if (!r.error) return ok(r)
    }
    if (geminiKey) {
      const r = await callGemini(prompt, geminiKey)
      if (!r.error) return ok(r)
    }
    if (openaiKey) return ok(await callOpenAI(prompt, openaiKey))

    return ok({ error: 'กรุณาตั้งค่า GROQ_API_KEY, GEMINI_API_KEY หรือ OPENAI_API_KEY' })
  } catch (err) {
    return ok({ error: err instanceof Error ? err.message : String(err) })
  }
})
