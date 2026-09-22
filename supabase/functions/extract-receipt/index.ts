import { corsHeaders } from '../_shared/cors.ts'

/**
 * extract-receipt
 * Priority: GROQ_API_KEY → GEMINI_API_KEY → OPENAI_API_KEY
 * Always returns HTTP 200; errors go in { error: string }.
 */
function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const PROMPT = `คุณคือผู้ช่วยอ่านใบเสร็จ/ใบแจ้งหนี้ภาษาไทยและภาษาอังกฤษ
ดึงข้อมูลจากรูปภาพนี้แล้วตอบเป็น JSON เท่านั้น ไม่ต้องมีคำอธิบาย ไม่ต้องมี code block

รูปแบบที่ต้องการ:
{
  "amount": <ยอดรวมทั้งหมดที่ต้องชำระ เป็นตัวเลขเท่านั้น ไม่มีเครื่องหมาย ไม่มีสกุลเงิน>,
  "vendor": "<ชื่อร้านค้า บริษัท หรือผู้ขาย>",
  "date": "<วันที่ในรูปแบบ YYYY-MM-DD หรือ null>",
  "description": "<รายละเอียดสินค้าหรือบริการ สั้นๆ ไม่เกิน 120 ตัวอักษร>",
  "confidence": <ความมั่นใจ 0.0-1.0>
}
กฎ: amount ต้องเป็นตัวเลขบวก, date/vendor ถ้าหาไม่ได้ใส่ null, ตอบ JSON เท่านั้น`

function parseJson(content: string) {
  const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  const match = stripped.match(/\{[\s\S]*\}/)
  if (!match) return { error: `แปลง JSON ไม่ได้: ${content.slice(0, 200)}` }
  const data = JSON.parse(match[0])
  if (data.amount != null) {
    const n = Number(String(data.amount).replace(/[^0-9.]/g, ''))
    data.amount = Number.isFinite(n) && n > 0 ? n : null
  }
  return data
}

// ── Groq (Llama Vision) — free tier, OpenAI-compatible ────
async function callGroq(b64: string, mime: string, key: string) {
  // Try models in order (scout is newest, 11b is fallback)
  const models = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.2-11b-vision-preview',
    'llama-3.2-90b-vision-preview',
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
    // Only continue on 404 / model-not-found; stop on auth/quota
    const body = (() => { try { return JSON.parse(raw) } catch { return {} } })()
    const code: string = body?.error?.code ?? ''
    if (res.status !== 404 && code !== 'model_not_found') return { error: lastErr }
  }
  return { error: lastErr }
}

// ── Google Gemini ──────────────────────────────────────────
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
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
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

// ── OpenAI GPT-4o-mini ─────────────────────────────────────
async function callOpenAI(b64: string, mime: string, key: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'auto' } },
        ],
      }],
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

// ── Main ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { imageBase64, mimeType } = await req.json() as { imageBase64: string; mimeType?: string }
    if (!imageBase64) return ok({ error: 'imageBase64 is required' })
    const mime = mimeType ?? 'image/jpeg'
    const groqKey   = Deno.env.get('GROQ_API_KEY')
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (groqKey) {
      const r = await callGroq(imageBase64, mime, groqKey)
      if (!r.error) return ok(r)
    }
    if (geminiKey) {
      const r = await callGemini(imageBase64, mime, geminiKey)
      if (!r.error) return ok(r)
    }
    if (openaiKey) return ok(await callOpenAI(imageBase64, mime, openaiKey))
    return ok({ error: 'กรุณาตั้งค่า GROQ_API_KEY, GEMINI_API_KEY หรือ OPENAI_API_KEY ใน Supabase secrets' })
  } catch (err) {
    return ok({ error: err instanceof Error ? err.message : String(err) })
  }
})
