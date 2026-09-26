import { corsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'

/** ai-member-search — ค้นหาสมาชิกจากคำบรรยายภาษาธรรมชาติ */
function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type MemberHint = {
  id: string
  name_th: string
  nickname?: string | null
  position_committee?: string | null
  position_yec?: string | null
  province?: string | null
  committee?: string | null
}

type SearchInput = { query: string; members: MemberHint[] }

function buildPrompt(input: SearchInput): string {
  const list = input.members.map((m, i) =>
    `${i + 1}. id=${m.id} | ชื่อ: ${m.name_th}${m.nickname ? ` (${m.nickname})` : ''} | ตำแหน่ง: ${m.position_committee || m.position_yec || '-'} | จังหวัด: ${m.province || '-'} | คณะ: ${m.committee || '-'}`
  ).join('\n')

  return `คุณคือผู้ช่วยค้นหาสมาชิก YEC หอการค้าไทย
จากคำอธิบายของผู้ใช้ ให้หาสมาชิกที่ตรงหรือใกล้เคียงที่สุด
ตอบ JSON เท่านั้น ไม่มีคำอธิบาย ไม่มี code block

คำค้นหา: "${input.query}"

รายชื่อสมาชิกทั้งหมด (${input.members.length} คน):
${list}

รูปแบบที่ต้องการ:
{
  "matched_ids": ["<id1>", "<id2>", ...],
  "reasoning": "<เหตุผลสั้นๆ ว่าทำไมเลือกคนเหล่านี้>"
}

กฎ:
- matched_ids เรียงจากที่ตรงที่สุดก่อน ไม่เกิน 20 รายการ
- ถ้าไม่พบใครที่ตรงเลย ให้ matched_ids = []
- reasoning ไม่เกิน 2 ประโยค ภาษาไทย`
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
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.1 }),
    })
    const raw = await res.text()
    if (res.ok) {
      const content: string = JSON.parse(raw)?.choices?.[0]?.message?.content ?? ''
      return content ? parseJson(content) : { error: 'Groq ไม่ส่งผลลัพธ์' }
    }
    let msg = raw
    try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
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
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 600, temperature: 0.1 } }),
    })
    const raw = await res.text()
    if (res.ok) {
      const content: string = JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      return content ? parseJson(content) : { error: 'Gemini ไม่ส่งผลลัพธ์' }
    }
    let msg = raw
    try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    lastErr = `Gemini/${m} (${res.status}): ${msg}`
    if (res.status !== 404 && res.status !== 429) return { error: lastErr }
  }
  return { error: lastErr }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  // anon key is public (shipped in the frontend bundle), so without this anyone could call this and spend the AI quota
  try { await requireUser(req) } catch {
    return new Response(JSON.stringify({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  try {
    const input = await req.json() as SearchInput
    if (!input.query?.trim()) return ok({ error: 'query is required' })
    if (!input.members?.length) return ok({ matched_ids: [], reasoning: 'ไม่มีข้อมูลสมาชิก' })

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
