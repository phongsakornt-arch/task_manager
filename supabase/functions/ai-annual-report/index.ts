import { corsHeaders } from '../_shared/cors.ts'

/** ai-annual-report — สรุปผลงานรายปีเป็นรายงาน */
function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type TaskSummary = {
  title: string
  section?: string | null
  type?: string | null
  start_date?: string | null
  end_date?: string | null
  completed: boolean
}

type ReportInput = { year: number; tasks: TaskSummary[] }

function buildStats(input: ReportInput) {
  const total = input.tasks.length
  const done = input.tasks.filter(t => t.completed).length
  const pending = total - done
  const rate = total > 0 ? Math.round((done / total) * 100) : 0
  return { total, done, pending, rate: `${rate}%` }
}

function buildPrompt(input: ReportInput): string {
  const stats = buildStats(input)
  const sample = input.tasks.slice(0, 60)
  const truncated = input.tasks.length > 60

  const bySection: Record<string, { done: number; total: number; titles: string[] }> = {}
  sample.forEach(t => {
    const key = t.section || '(ไม่มีกลุ่ม)'
    if (!bySection[key]) bySection[key] = { done: 0, total: 0, titles: [] }
    bySection[key].total++
    if (t.completed) bySection[key].done++
    if (bySection[key].titles.length < 4) bySection[key].titles.push(t.title)
  })

  const sectionLines = Object.entries(bySection).map(([sec, v]) =>
    `• ${sec}: ${v.total} งาน เสร็จ ${v.done} | ตัวอย่าง: ${v.titles.join(' / ')}`
  ).join('\n')

  return `คุณคือผู้ช่วยเขียนรายงานขององค์กร YEC หอการค้าไทย ประจำปี ${input.year} (พ.ศ. ${input.year + 543})

ข้อมูลงานทั้งปี (รวม ${stats.total} งาน เสร็จ ${stats.done} ค้าง ${stats.pending} อัตราสำเร็จ ${stats.rate})${truncated ? ` แสดง ${sample.length} งานแรก` : ''}:
${sectionLines}

เขียนรายงานสรุปผลงานประจำปีภาษาทางการ ประกอบด้วย:
1. บทสรุปภาพรวม (1-2 ย่อหน้า)
2. ผลงานเด่นตามกลุ่มงาน (bullet point)
3. ข้อเสนอแนะสำหรับปีถัดไป 2-3 ข้อ

ตอบเป็นข้อความล้วน ภาษาไทย ไม่ต้องใส่ JSON หรือ code block`
}

/** เรียก AI แบบ plain text */
async function callGroq(prompt: string, key: string): Promise<{ text?: string; error?: string }> {
  const models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']
  let lastErr = 'Groq: ไม่พบ model'
  for (const model of models) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 2048, temperature: 0.4 }),
    })
    const raw = await res.text()
    if (res.ok) {
      const text: string = JSON.parse(raw)?.choices?.[0]?.message?.content ?? ''
      return text ? { text } : { error: 'Groq ไม่ส่งผลลัพธ์' }
    }
    let msg = raw; try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    lastErr = `Groq/${model} (${res.status}): ${msg}`
    const body = (() => { try { return JSON.parse(raw) } catch { return {} } })()
    if (res.status !== 404 && (body?.error?.code ?? '') !== 'model_not_found') return { error: lastErr }
  }
  return { error: lastErr }
}

async function callGemini(prompt: string, key: string): Promise<{ text?: string; error?: string }> {
  const MODELS = [{ v: 'v1beta', m: 'gemini-2.0-flash' }, { v: 'v1beta', m: 'gemini-1.5-flash' }]
  let lastErr = 'Gemini: ไม่พบ model'
  for (const { v, m } of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048, temperature: 0.4 } }),
    })
    const raw = await res.text()
    if (res.ok) {
      const text: string = JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      return text ? { text } : { error: 'Gemini ไม่ส่งผลลัพธ์' }
    }
    let msg = raw; try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    lastErr = `Gemini/${m} (${res.status}): ${msg}`
    if (res.status !== 404 && res.status !== 429) return { error: lastErr }
  }
  return { error: lastErr }
}

async function callOpenAI(prompt: string, key: string): Promise<{ text?: string; error?: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 2048, temperature: 0.4 }),
  })
  const raw = await res.text()
  if (res.ok) {
    const text: string = JSON.parse(raw)?.choices?.[0]?.message?.content ?? ''
    return text ? { text } : { error: 'OpenAI ไม่ส่งผลลัพธ์' }
  }
  let msg = raw; try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
  return { error: `OpenAI (${res.status}): ${msg}` }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json() as ReportInput
    if (!input.year || !input.tasks?.length) return ok({ error: 'year และ tasks จำเป็น' })
    const prompt = buildPrompt(input)
    const stats = buildStats(input)
    const groqKey = Deno.env.get('GROQ_API_KEY')
    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    const errors: string[] = []
    if (groqKey) { const r = await callGroq(prompt, groqKey); if (r.text) return ok({ report: r.text, stats }); if (r.error) errors.push(r.error) }
    if (geminiKey) { const r = await callGemini(prompt, geminiKey); if (r.text) return ok({ report: r.text, stats }); if (r.error) errors.push(r.error) }
    if (openaiKey) { const r = await callOpenAI(prompt, openaiKey); if (r.text) return ok({ report: r.text, stats }); if (r.error) errors.push(r.error) }
    return ok({ error: errors.length ? errors.join(' | ') : 'ไม่สามารถเชื่อมต่อ AI ได้ กรุณาลองใหม่อีกครั้ง' })
  } catch (err) {
    return ok({ error: err instanceof Error ? err.message : String(err) })
  }
})
