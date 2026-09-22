import { corsHeaders } from '../_shared/cors.ts'

/**
 * extract-doc-info
 * อ่านไฟล์เอกสาร (รูปภาพ / PDF) แล้วดึง title + description สำหรับกรอกฟอร์มอัตโนมัติ
 * Priority: GROQ_API_KEY → GEMINI_API_KEY → OPENAI_API_KEY
 * Always returns HTTP 200; errors go in { error: string }
 */

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const PROMPT = `คุณคือผู้ช่วยอ่านเอกสารราชการ/องค์กร ภาษาไทยและภาษาอังกฤษ
ดึงข้อมูลสำคัญจากเอกสารนี้แล้วตอบเป็น JSON เท่านั้น ไม่ต้องมีคำอธิบาย ไม่ต้องมี code block

รูปแบบที่ต้องการ:
{
  "title": "<ชื่อเรื่อง / หัวข้อหลักของเอกสาร ไม่เกิน 120 ตัวอักษร>",
  "description": "<สรุปเนื้อหาสั้นๆ ว่าเอกสารนี้คืออะไร ต้องการอะไร ไม่เกิน 200 ตัวอักษร>",
  "document_type": "<ประเภทเอกสาร เช่น หนังสือขออนุมัติ, ใบเสนอราคา, บันทึกข้อความ, สัญญา, รายงาน ฯลฯ>",
  "confidence": <ความมั่นใจในการอ่าน 0.0-1.0>
}
กฎ: title ห้ามว่าง, ตอบภาษาไทย, ตอบ JSON เท่านั้น`

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

// ── Groq (vision — images only, not PDF) ─────────────────────
async function callGroq(b64: string, mime: string, key: string) {
  const models = [
    'qwen/qwen3.8-27b',
  ]
  let lastErr = 'Groq: ไม่พบ model ที่ใช้งานได้'
  for (const model of models) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        }],
        max_tokens: 500,
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

// ── Gemini (supports images + PDF inline_data) ────────────────
const GEMINI_MODELS = [
  { v: 'v1beta', m: 'gemini-2.0-flash-lite' },
  { v: 'v1beta', m: 'gemini-2.0-flash' },
  { v: 'v1',     m: 'gemini-1.5-flash' },
  { v: 'v1',     m: 'gemini-1.5-flash-8b' },
]
async function callGemini(b64: string, mime: string, key: string) {
  let lastErr = 'Gemini: ไม่พบ model ที่ใช้งานได้'
  for (const { v, m } of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${key}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mime, data: b64 } },
        ]}],
        generationConfig: { maxOutputTokens: 500, temperature: 0.1 },
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
    // ข้าม model ถัดไปเมื่อ 404 (ไม่พบ model) หรือ 429 (quota หมด/rate limit)
    if (res.status !== 404 && res.status !== 429) return { error: lastErr }
  }
  return { error: lastErr }
}

// ── OpenAI GPT-4o (supports images + PDF via base64) ─────────
async function callOpenAI(b64: string, mime: string, key: string) {
  const isPdf = mime === 'application/pdf'
  const contentParts = isPdf
    ? [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'auto' } },
      ]
    : [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'auto' } },
      ]
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: contentParts }],
      max_tokens: 500,
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

// ── Main ──────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { imageBase64, mimeType } = await req.json() as { imageBase64: string; mimeType?: string }
    if (!imageBase64) return ok({ error: 'imageBase64 is required' })
    const mime = mimeType ?? 'image/jpeg'
    const isPdf = mime === 'application/pdf'

    const groqKey   = Deno.env.get('GROQ_API_KEY')
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    // Groq ไม่รองรับ PDF → ข้ามสำหรับ PDF เท่านั้น
    // ถ้า provider ใดล้มเหลว → fallback ต่อเสมอ
    if (groqKey && !isPdf) {
      const r = await callGroq(imageBase64, mime, groqKey)
      if (!r.error) return ok(r)
    }
    if (geminiKey) {
      const r = await callGemini(imageBase64, mime, geminiKey)
      if (!r.error) return ok(r)
    }
    if (openaiKey) return ok(await callOpenAI(imageBase64, mime, openaiKey))

    return ok({ error: 'กรุณาตั้งค่า GROQ_API_KEY, GEMINI_API_KEY หรือ OPENAI_API_KEY' })
  } catch (err) {
    return ok({ error: err instanceof Error ? err.message : String(err) })
  }
})
