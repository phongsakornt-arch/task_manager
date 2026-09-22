import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'

/**
 * ai-assistant — แชทสั่งงานด้วยภาษาธรรมชาติ (ค้นหา/ดูรายละเอียด/สรุปไฟล์แนบ
 * ทำทันที, สร้างงานใหม่ต้องรอผู้ใช้กดยืนยันในหน้าแชทก่อนเสมอ)
 *
 * Tool-calling ผ่าน Groq (หลัก) → OpenAI (สำรอง) — ทั้งคู่ใช้ chat/completions
 * format แบบเดียวกัน (OpenAI-compatible) จึงใช้ตัวเดียวกันเรียกได้ทั้งคู่
 * Gemini ไม่รองรับในโหมดนี้ (function-calling format ต่างกัน)
 */

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  reasoning?: string | null // gpt-oss models on Groq put chain-of-thought here, separate from content
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_tasks',
      description: 'ค้นหางานในระบบจากคำค้นในชื่อ/รายละเอียด หรือกรองตามสถานะ',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'คำค้นหา เว้นว่างได้ถ้าจะกรองแค่สถานะ' },
          status: { type: 'string', enum: ['open', 'done', 'overdue', 'all'], description: 'กรองตามสถานะงาน default all' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_task',
      description: 'ดูรายละเอียดงานเต็มๆ รวมไฟล์แนบและ checklist จาก task id (ได้จาก search_tasks ก่อน)',
      parameters: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_attachment',
      description: 'อ่านและสรุปเนื้อหาไฟล์แนบ (รูปภาพหรือ PDF) จาก URL ของไฟล์',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' }, name: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_create_task',
      description: 'เสนอสร้างงานใหม่ — ยังไม่บันทึกจริง ระบบจะแสดงให้ผู้ใช้ยืนยันก่อนเสมอ ห้ามบอกผู้ใช้ว่า "สร้างแล้ว" ให้บอกว่า "เตรียมไว้ให้แล้ว กดยืนยันได้เลย"',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          section_id: { type: 'string', description: 'id ของ section ที่เหมาะสมที่สุดจากรายการที่ให้ไว้ใน system prompt' },
          start_date: { type: 'string', description: 'YYYY-MM-DD หรือเว้นว่าง' },
          end_date: { type: 'string', description: 'YYYY-MM-DD หรือเว้นว่าง' },
          start_time: { type: 'string', description: 'HH:MM หรือเว้นว่าง' },
          end_time: { type: 'string', description: 'HH:MM หรือเว้นว่าง' },
        },
        required: ['title'],
      },
    },
  },
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

async function buildSystemPrompt(supabase: SupabaseClient) {
  const { data: sections } = await supabase.from('sections').select('id, title').order('title')
  const sectionList = (sections ?? []).map((s: { id: string; title: string }) => `  - "${s.title}" (id: ${s.id})`).join('\n') || '  (ไม่มี)'
  return `คุณคือผู้ช่วย AI ในระบบจัดการงาน YEC Task Manager ของหอการค้าไทย
วันนี้คือ ${todayStr()}
ตอบเป็นภาษาไทย กระชับ เป็นกันเอง

รายการ Section ที่มีอยู่ในระบบ (ใช้ตอนค้นหา/เสนอสร้างงาน):
${sectionList}

กติกาสำคัญ: การสร้างงานใหม่ (propose_create_task) เป็นแค่ "ข้อเสนอ" เท่านั้น
ระบบจะบันทึกจริงก็ต่อเมื่อผู้ใช้กดยืนยันในหน้าจอเองเท่านั้น — ห้ามบอกผู้ใช้ว่า
"สร้างงานให้แล้ว" เด็ดขาด ให้บอกว่า "เตรียมข้อมูลไว้ให้แล้ว กดยืนยันด้านล่างได้เลย"`
}

async function execSearchTasks(supabase: SupabaseClient, args: { query?: string; status?: string }) {
  let q = supabase.from('tasks').select('id, title, section_id, start_date, end_date, completed, sections(title)').eq('deleted', false).limit(15)
  if (args.query?.trim()) q = q.or(`title.ilike.%${args.query.trim()}%,description.ilike.%${args.query.trim()}%`)
  if (args.status === 'open') q = q.eq('completed', false)
  else if (args.status === 'done') q = q.eq('completed', true)
  else if (args.status === 'overdue') q = q.eq('completed', false).lt('end_date', todayStr())
  const { data, error } = await q
  if (error) return { error: error.message }
  return {
    count: data?.length ?? 0,
    tasks: (data ?? []).map((t) => ({
      id: t.id, title: t.title, section: (t.sections as { title?: string } | null)?.title ?? null,
      start_date: t.start_date, end_date: t.end_date, completed: t.completed,
    })),
  }
}

async function execGetTask(supabase: SupabaseClient, args: { taskId?: string }) {
  if (!args.taskId) return { error: 'missing taskId' }
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, description, start_date, end_date, start_time, end_time, completed, checklist, attachments, sections(title)')
    .eq('id', args.taskId)
    .single()
  if (error || !data) return { error: error?.message ?? 'ไม่พบงานนี้' }
  return data
}

async function execSummarizeAttachment(args: { url?: string; name?: string }) {
  if (!args.url) return { error: 'missing url' }
  if (/drive\.google\.com/.test(args.url)) {
    return { error: 'ไม่รองรับการอ่านไฟล์จาก Google Drive อัตโนมัติตอนนี้ — เปิดลิงก์ดูเองได้ที่: ' + args.url }
  }
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!geminiKey) return { error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY สำหรับอ่านไฟล์' }
  try {
    const fileRes = await fetch(args.url)
    if (!fileRes.ok) return { error: `ดาวน์โหลดไฟล์ไม่ได้ (${fileRes.status})` }
    const mime = fileRes.headers.get('content-type') ?? 'application/octet-stream'
    if (!/^image\//.test(mime) && mime !== 'application/pdf') {
      return { error: `ไฟล์ประเภท ${mime} ยังไม่รองรับการอ่านสรุปอัตโนมัติ` }
    }
    const buf = new Uint8Array(await fileRes.arrayBuffer())
    if (buf.byteLength > 15 * 1024 * 1024) return { error: 'ไฟล์ใหญ่เกินไป (เกิน 15MB)' }
    let binary = ''
    for (const b of buf) binary += String.fromCharCode(b)
    const b64 = btoa(binary)

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: `สรุปเนื้อหาไฟล์นี้ (${args.name ?? 'ไฟล์แนบ'}) เป็นภาษาไทย กระชับ ไม่เกิน 5 บรรทัด` },
            { inline_data: { mime_type: mime, data: b64 } },
          ] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.1 },
        }),
      },
    )
    const raw = await geminiRes.json().catch(() => ({}))
    const summary = raw?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!summary) return { error: 'อ่านไฟล์ไม่สำเร็จ' }
    return { summary }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ' }
  }
}

async function callChat(baseUrl: string, key: string, model: string, messages: ChatMessage[]) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 600 }),
  })
  const raw = await res.text()
  if (!res.ok) {
    let msg = raw
    try { msg = JSON.parse(raw)?.error?.message ?? raw } catch { /* ignore */ }
    throw new Error(`(${res.status}) ${msg}`)
  }
  return JSON.parse(raw)?.choices?.[0]?.message as ChatMessage | undefined
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase } = await requireUser(req)
    const { messages: rawClientMessages } = await req.json() as { messages: ChatMessage[] }
    if (!Array.isArray(rawClientMessages) || rawClientMessages.length === 0) {
      return jsonResponse({ error: 'messages is required' }, 400)
    }
    // จำกัดประวัติแชทที่ส่งเข้า LLM แต่ละครั้ง — ไม่งั้น token ต่อ request จะบวมขึ้นเรื่อยๆ
    // จนชน rate limit ของ Groq (TPM) โดยเฉพาะรอบที่มี tool result (search/get_task) แทรกอยู่
    // ตัดเฉพาะ user/assistant ที่มีเนื้อหาจริง เอาไว้ 10 ข้อความหลังสุดพอ (ยังพอจำบริบทได้)
    const clientMessages = rawClientMessages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
      .slice(-10)
    if (clientMessages.length === 0) return jsonResponse({ error: 'messages is required' }, 400)

    const groqKey = Deno.env.get('GROQ_API_KEY')
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!groqKey && !openaiKey) return jsonResponse({ error: 'กรุณาตั้งค่า GROQ_API_KEY หรือ OPENAI_API_KEY' }, 500)

    // ลองหลาย model/provider ตามลำดับ เผื่อบาง model ไม่รองรับ tool-calling
    // หรือ deprecate ไปแล้ว — เหมือนแพทเทิร์นที่ใช้ในฟังก์ชัน AI อื่นของระบบนี้
    const providers: { baseUrl: string; key: string; model: string }[] = []
    if (groqKey) {
      // model รุ่น llama เดิมทั้งหมด (llama-3.3-70b-versatile, llama-3.1-8b-instant,
      // meta-llama/llama-4-scout-*) ถูกถอดออกจาก catalog ของ Groq ไปแล้ว — เช็คจาก
      // GET /openai/v1/models ตรงๆ แล้วเลือกเฉพาะ model ที่มี "tools" ใน
      // supported_features จริง (ทดสอบยืนยันแล้วว่า tool-calling ใช้ได้จริง)
      providers.push(
        { baseUrl: 'https://api.groq.com/openai/v1/chat/completions', key: groqKey, model: 'openai/gpt-oss-120b' },
        { baseUrl: 'https://api.groq.com/openai/v1/chat/completions', key: groqKey, model: 'openai/gpt-oss-20b' },
      )
    }
    if (openaiKey) providers.push({ baseUrl: 'https://api.openai.com/v1/chat/completions', key: openaiKey, model: 'gpt-4o-mini' })

    async function callChatWithFallback(messages: ChatMessage[]) {
      const errors: string[] = []
      for (const p of providers) {
        try {
          return await callChat(p.baseUrl, p.key, p.model, messages)
        } catch (err) {
          errors.push(`${p.model}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      throw new Error(errors.join(' | ') || 'ไม่พบ provider ที่ใช้งานได้')
    }

    const systemPrompt = await buildSystemPrompt(supabase)
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...clientMessages]

    let proposedAction: { type: 'create_task'; payload: Record<string, unknown> } | null = null

    for (let round = 0; round < 4; round++) {
      const assistantMsg = await callChatWithFallback(messages)
      if (!assistantMsg) return jsonResponse({ error: 'ไม่ได้รับคำตอบจาก AI' }, 502)
      messages.push(assistantMsg)

      if (!assistantMsg.tool_calls?.length) {
        // gpt-oss models บางทีตอบจริงไปอยู่ที่ reasoning แทน content ถ้า content ว่าง
        const reply = assistantMsg.content?.trim() ? assistantMsg.content : (assistantMsg.reasoning ?? '')
        return jsonResponse({ success: true, reply, messages, proposedAction })
      }

      for (const call of assistantMsg.tool_calls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(call.function.arguments || '{}') } catch { /* ignore */ }

        let result: unknown
        if (call.function.name === 'search_tasks') result = await execSearchTasks(supabase, args)
        else if (call.function.name === 'get_task') result = await execGetTask(supabase, args)
        else if (call.function.name === 'summarize_attachment') result = await execSummarizeAttachment(args)
        else if (call.function.name === 'propose_create_task') {
          proposedAction = { type: 'create_task', payload: args }
          result = { status: 'proposed', message: 'เตรียมข้อเสนอไว้แล้ว รอผู้ใช้ยืนยัน' }
        } else result = { error: `unknown tool: ${call.function.name}` }

        messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) })
      }
    }

    return jsonResponse({ success: true, reply: 'ขอโทษค่ะ ตอบไม่ทันในรอบนี้ ลองถามใหม่อีกครั้งนะคะ', messages, proposedAction })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
