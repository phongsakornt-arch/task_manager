import { corsHeaders } from '../_shared/cors.ts'

/**
 * ai-approval
 * วิเคราะห์เอกสารขออนุมัติและให้คำแนะนำ
 * Priority: GROQ_API_KEY → GEMINI_API_KEY → OPENAI_API_KEY
 * Always returns HTTP 200; errors go in { error: string }
 */

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type ApproverInfo = {
  name: string
  email: string
  status: string
  note?: string | null
}

type DocInput = {
  title: string
  description?: string | null
  fileName?: string | null
  version?: number
  approvers?: ApproverInfo[]
}

function buildPrompt(doc: DocInput): string {
  const approverLines = (doc.approvers ?? []).map((a, i) =>
    `  ${i + 1}. ${a.name} (${a.email}): ${a.status}${a.note ? ` — หมายเหตุ: "${a.note}"` : ''}`
  ).join('\n') || '  (ยังไม่มีผู้อนุมัติ)'

  return `คุณคือผู้ช่วยวิเคราะห์เอกสารขออนุมัติขององค์กร YEC หอการค้าไทย
วิเคราะห์ข้อมูลเอกสารด้านล่างและตอบเป็น JSON เท่านั้น ไม่ต้องมีคำอธิบาย ไม่ต้องมี code block

ข้อมูลเอกสาร:
- ชื่อเอกสาร: ${doc.title}
- รายละเอียด: ${doc.description || '(ไม่มี)'}
- ไฟล์แนบ: ${doc.fileName || '(ไม่มี)'}
- เวอร์ชัน: ${doc.version ?? 1}
- สายอนุมัติ:
${approverLines}

รูปแบบที่ต้องการ:
{
  "summary": "<สรุปเนื้อหาเอกสารสั้นๆ 1-2 ประโยค>",
  "recommendation": "approve" | "revise" | "pending",
  "reason": "<เหตุผลประกอบคำแนะนำ 1-2 ประโยค>",
  "risk_level": "low" | "medium" | "high",
  "confidence": <ความมั่นใจ 0.0-1.0>
}

กฎ:
- recommendation = "approve" เมื่อเอกสารสมบูรณ์และพร้อมอนุมัติ
- recommendation = "revise" เมื่อมีผู้ขอแก้ไขหรือข้อมูลไม่ครบ
- recommendation = "pending" เมื่ออยู่ระหว่างรอผู้อนุมัติ
- ตอบเป็นภาษาไทยทั้งหมด
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
        max_tokens: 600,
        temperature: 0.2,
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
        generationConfig: { maxOutputTokens: 600, temperature: 0.2 },
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
      max_tokens: 600,
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
    const doc = await req.json() as DocInput
    if (!doc.title) return ok({ error: 'title is required' })

    const prompt = buildPrompt(doc)
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
