import { corsHeaders } from '../_shared/cors.ts'

/** ai-todo-split — แบ่ง Todo ใหญ่เป็น Subtask */
function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type SplitInput = { title: string; note?: string | null; today: string }

function buildPrompt(input: SplitInput): string {
  return `คุณคือผู้ช่วยจัดการงานขององค์กร YEC หอการค้าไทย
แบ่ง Todo รายการใหญ่ด้านล่างออกเป็น Subtask ย่อยๆ ที่สามารถทำได้จริง
ตอบ JSON เท่านั้น ไม่มีคำอธิบาย ไม่มี code block
วันที่วันนี้: ${input.today}

Todo หลัก: "${input.title}"
${input.note ? `รายละเอียด: "${input.note}"` : ''}

รูปแบบที่ต้องการ:
{
  "subtasks": [
    { "title": "<ชื่อ subtask กระชับ>", "due_date": "<YYYY-MM-DD หรือ null>", "note": "<หมายเหตุสั้นๆ หรือ null>" },
    ...
  ]
}

กฎ:
- แบ่งออก 3-7 subtask ที่สมเหตุสมผล
- แต่ละ subtask ต้องทำได้ภายใน 1-3 วัน
- due_date ต้องเป็น null หรือวันที่จริงในรูปแบบ YYYY-MM-DD เท่านั้น
- ถ้า Todo ใหญ่มี due date โดยนัย ให้กระจาย due_date ของแต่ละ subtask ให้สมเหตุสมผล
- ตอบ JSON เท่านั้น ภาษาไทย`
}

function parseJson(content: string) {
  const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  const match = stripped.match(/\{[\s\S]*\}/)
  if (!match) return { error: `แปลง JSON ไม่ได้` }
  try { return JSON.parse(match[0]) } catch { return { error: 'JSON ไม่ถูกต้อง' } }
}

async function callGroq(prompt: string, key: string) {
  const models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']
  let lastErr = 'Groq: ไม่พบ model'
  for (const model of models) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.3 }),
    })
    const raw = await res.text()
    if (res.ok) {
      const content: string = JSON.parse(raw)?.choices?.[0]?.message?.content ?? ''
      return content ? parseJson(content) : { error: 'Groq ไม่ส่งผลลัพธ์' }
    }
    let msg = raw; try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    lastErr = `Groq/${model} (${res.status}): ${msg}`
    const body = (() => { try { return JSON.parse(raw) } catch { return {} } })()
    if (res.status !== 404 && (body?.error?.code ?? '') !== 'model_not_found') return { error: lastErr }
  }
  return { error: lastErr }
}

async function callGemini(prompt: string, key: string) {
  const MODELS = [{ v: 'v1beta', m: 'gemini-2.0-flash-lite' }, { v: 'v1beta', m: 'gemini-2.0-flash' }, { v: 'v1', m: 'gemini-1.5-flash' }]
  let lastErr = 'Gemini: ไม่พบ model'
  for (const { v, m } of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 800, temperature: 0.3 } }),
    })
    const raw = await res.text()
    if (res.ok) {
      const content: string = JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      return content ? parseJson(content) : { error: 'Gemini ไม่ส่งผลลัพธ์' }
    }
    let msg = raw; try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    lastErr = `Gemini/${m} (${res.status}): ${msg}`
    if (res.status !== 404 && res.status !== 429) return { error: lastErr }
  }
  return { error: lastErr }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json() as SplitInput
    if (!input.title?.trim()) return ok({ error: 'title is required' })
    const prompt = buildPrompt(input)
    const groqKey = Deno.env.get('GROQ_API_KEY')
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (groqKey) { const r = await callGroq(prompt, groqKey); if (!r.error) return ok(r) }
    if (geminiKey) { const r = await callGemini(prompt, geminiKey); if (!r.error) return ok(r) }
    return ok({ error: 'กรุณาตั้งค่า GROQ_API_KEY หรือ GEMINI_API_KEY' })
  } catch (err) {
    return ok({ error: err instanceof Error ? err.message : String(err) })
  }
})
