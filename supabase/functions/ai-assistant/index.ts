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
      description: 'ค้นหางานในระบบจากคำค้นในชื่อ/รายละเอียด, กรองตามสถานะ, และ/หรือช่วงวันที่ครบกำหนด — ถ้าผู้ใช้ถามถึงช่วงเวลา (เช่น "สัปดาห์นี้", "เดือนนี้") ต้องคำนวณ dateFrom/dateTo เป็น YYYY-MM-DD จากวันที่วันนี้เองแล้วส่งมาด้วยเสมอ ห้ามเรียกแบบไม่ระบุช่วงวันที่แล้วเดาเอาเองว่าอันไหนอยู่ในช่วงนั้น',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'คำค้นหา เว้นว่างได้ถ้าจะกรองแค่สถานะ/วันที่' },
          status: { type: 'string', enum: ['open', 'done', 'overdue', 'all'], description: 'กรองตามสถานะงาน default all' },
          dateFrom: { type: 'string', description: 'YYYY-MM-DD เริ่มช่วงวันที่ครบกำหนด (รวมวันนี้)' },
          dateTo: { type: 'string', description: 'YYYY-MM-DD สิ้นสุดช่วงวันที่ครบกำหนด' },
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
      name: 'search_budget_projects',
      description: 'ค้นหาโครงการในระบบงบประมาณ จากชื่อโครงการ/รหัสหน่วยงาน/รหัสงบ — ใช้เมื่อผู้ใช้ถามเรื่องงบประมาณ/ใช้ไปเท่าไหร่/โครงการไหนใช้งบเกิน ฯลฯ (คนละระบบกับ "งาน" ใน search_tasks)',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'คำค้นหาชื่อโครงการ/หน่วยงาน เว้นว่างได้ถ้าจะดูทั้งหมด' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_budget_project',
      description: 'ดูรายละเอียดงบประมาณของโครงการเต็มๆ (แผนงบ vs ใช้จริง, รายการธุรกรรม) จาก project id (ได้จาก search_budget_projects ก่อน)',
      parameters: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_todos',
      description: 'ค้นหา Todo ส่วนตัวของผู้ใช้ที่คุยอยู่ตอนนี้ (เห็นเฉพาะของตัวเอง) จากคำค้นในชื่อ/บันทึก และ/หรือสถานะ — ใช้เมื่อผู้ใช้ถามว่ามี todo อะไรบ้าง/ยังไม่ได้ทำอะไรบ้าง',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'คำค้นหา เว้นว่างได้ถ้าจะกรองแค่สถานะ' },
          status: { type: 'string', enum: ['open', 'done', 'all'], description: 'กรองตามสถานะ default open' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_complete_todo',
      description: 'เสนอทำเครื่องหมาย Todo (ที่มีอยู่แล้ว) ว่าเสร็จแล้ว จาก todo id (ได้จาก search_todos ก่อน) ยังไม่บันทึกจริง ต้องรอผู้ใช้กดยืนยันในหน้าแชทเสมอ ห้ามบอกว่า "ทำเสร็จให้แล้ว" ให้บอกว่า "เตรียมไว้ให้แล้ว กดยืนยันได้เลย"',
      parameters: { type: 'object', properties: { todoId: { type: 'string' } }, required: ['todoId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_approvals',
      description: 'ค้นหาเอกสารในระบบอนุมัติ จากชื่อเรื่อง และ/หรือสถานะ — ใช้เมื่อผู้ใช้ถามเรื่องเอกสารรออนุมัติ/สถานะการอนุมัติ',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'คำค้นหาชื่อเรื่อง เว้นว่างได้' },
          status: { type: 'string', enum: ['draft', 'pending', 'approved', 'revision_requested', 'cancelled', 'all'], description: 'กรองตามสถานะ default all' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_approval',
      description: 'ดูรายละเอียดเอกสารอนุมัติเต็มๆ พร้อมลำดับผู้อนุมัติทุกคนและสถานะแต่ละคน (ใครอนุมัติแล้ว ใครกำลังรอ) จาก approval id (ได้จาก search_approvals ก่อน)',
      parameters: { type: 'object', properties: { approvalId: { type: 'string' } }, required: ['approvalId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_members',
      description: 'ค้นหาสมาชิก/กรรมการในทำเนียบ (Directory) จากชื่อ ชื่อเล่น ตำแหน่ง จังหวัด หรือชื่อคณะกรรมการ — ใช้เมื่อผู้ใช้ถามถึงคน/สมาชิก/กรรมการ เช่น "ใครคือ...", "ติดต่อ...ยังไง", "กรรมการชุดไหนบ้าง" (คนละระบบกับ tasks/budget)',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'คำค้นหาชื่อ/ชื่อเล่น/ตำแหน่ง/จังหวัด เว้นว่างได้ถ้าจะกรองแค่คณะกรรมการ' },
          committee: { type: 'string', description: 'ชื่อหรือรหัสคณะกรรมการ เว้นว่างได้' },
        },
      },
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
      description: 'เสนอสร้าง "งาน" ใหม่ในบอร์ดทีม (Task Board, ทุกคนในทีมเห็น) — ใช้เมื่อผู้ใช้พูดถึงงาน/โปรเจกต์/กิจกรรมของทีม ไม่ใช่ todo ส่วนตัว ยังไม่บันทึกจริง ระบบจะแสดงให้ผู้ใช้ยืนยันก่อนเสมอ ห้ามบอกผู้ใช้ว่า "สร้างแล้ว" ให้บอกว่า "เตรียมไว้ให้แล้ว กดยืนยันได้เลย"',
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
  {
    type: 'function',
    function: {
      name: 'propose_create_todo',
      description: 'เสนอจด "Todo ส่วนตัว" ใหม่ (เห็นเฉพาะผู้ใช้คนที่คุยอยู่คนเดียว ไม่มีใครอื่นเห็น) — ใช้เมื่อผู้ใช้พูดถึงสิ่งที่ต้องทำ/เตือนความจำส่วนตัว ไม่ใช่งานของทีม ยังไม่บันทึกจริง ระบบจะแสดงให้ผู้ใช้ยืนยันก่อนเสมอ ห้ามบอกผู้ใช้ว่า "จดแล้ว" ให้บอกว่า "เตรียมไว้ให้แล้ว กดยืนยันได้เลย"',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          note: { type: 'string' },
          priority: { type: 'string', enum: ['normal', 'high'] },
          due_date: { type: 'string', description: 'YYYY-MM-DD หรือเว้นว่าง' },
          due_time: { type: 'string', description: 'HH:MM หรือเว้นว่าง' },
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

กติกาสำคัญที่สุด: คุณ**ไม่มีข้อมูลอะไรในระบบติดตัวเลย** ห้ามเดา/สรุปว่ามีอะไร
บ้างหรือไม่มีเลยจากความจำเด็ดขาด — ทุกครั้งที่ผู้ใช้ถามอะไรที่เกี่ยวกับข้อมูล
จริงในระบบ ต้องเรียกเครื่องมือก่อนเสมอแล้วค่อยตอบจากผลลัพธ์ที่ได้กลับมา
เท่านั้น ถ้าเรียกแล้วไม่พบข้อมูลจริงๆ ค่อยบอกผู้ใช้ตามนั้น:
- ถามเรื่องงาน (ค้นหา, มีงานอะไรบ้าง, งานนี้คืออะไร) → เรียก search_tasks/get_task
- ถามเรื่องงบประมาณ (ใช้ไปเท่าไหร่, โครงการไหนเกินงบ ฯลฯ) → เรียก
  search_budget_projects/get_budget_project (คนละระบบกับ "งาน" — งบประมาณอยู่
  ในตาราง budget_projects ไม่ใช่ tasks ห้ามไปค้นด้วย search_tasks)
- ถามเรื่องคน/สมาชิก/กรรมการ/ทำเนียบ (ใครคือ..., ติดต่อ...ยังไง, กรรมการชุดไหน
  บ้าง) → เรียก search_members (คนละระบบกับ tasks และ budget_projects — ห้ามไป
  ค้นด้วย search_tasks หรือเดาว่าไม่มีข้อมูลติดต่อ ต้องเรียก search_members ก่อน
  เสมอ)
- ถามถึง todo ส่วนตัวที่มีอยู่แล้ว (มี todo อะไรบ้าง, ยังไม่ได้ทำอะไรบ้าง) →
  เรียก search_todos ถ้าผู้ใช้บอกว่าทำเสร็จแล้ว/ให้ทำเครื่องหมายเสร็จ → หา id
  จาก search_todos ก่อนแล้วเรียก propose_complete_todo (เป็นแค่ข้อเสนอ รอ
  ผู้ใช้ยืนยันเหมือน propose_create_* ห้ามบอกว่า "ทำให้แล้ว")
- ถามเรื่องเอกสารอนุมัติ/สถานะการอนุมัติ (รออนุมัติอะไรบ้าง, เอกสารนี้ถึงใครแล้ว)
  → เรียก search_approvals/get_approval (get_approval จะบอกลำดับผู้อนุมัติแต่ละ
  คนและสถานะ ใช้ตอบว่า "ตอนนี้รอ [ชื่อ] คนที่ [ลำดับ] อนุมัติอยู่" ได้)

แยกให้ถูกระหว่าง 2 อย่างนี้:
- "งาน" ของทีม (propose_create_task) — ทุกคนในทีมเห็น เหมาะกับโปรเจกต์/กิจกรรม
- "Todo" ส่วนตัว (propose_create_todo) — เห็นเฉพาะผู้ใช้คนนี้ เหมาะกับสิ่งที่ต้อง
  ทำ/เตือนความจำส่วนตัว ถ้าผู้ใช้พูดว่า "จด", "เตือน", "ให้ฉันจำ" มักหมายถึง
  Todo ส่วนตัว ไม่ใช่งานของทีม — ถ้าไม่แน่ใจให้ถามผู้ใช้ก่อนว่าต้องการแบบไหน

ทั้งสองอย่างเป็นแค่ "ข้อเสนอ" เท่านั้น ระบบจะบันทึกจริงก็ต่อเมื่อผู้ใช้กดยืนยัน
ในหน้าจอเองเท่านั้น — ห้ามบอกผู้ใช้ว่า "สร้าง/จดให้แล้ว" เด็ดขาด ให้บอกว่า
"เตรียมข้อมูลไว้ให้แล้ว กดยืนยันด้านล่างได้เลย"`
}

async function execSearchTasks(supabase: SupabaseClient, args: { query?: string; status?: string; dateFrom?: string; dateTo?: string }) {
  let q = supabase.from('tasks').select('id, title, section_id, start_date, end_date, completed, sections(title)').eq('deleted', false)
  if (args.query?.trim()) q = q.or(`title.ilike.%${args.query.trim()}%,description.ilike.%${args.query.trim()}%`)
  if (args.status === 'open') q = q.eq('completed', false)
  else if (args.status === 'done') q = q.eq('completed', true)
  else if (args.status === 'overdue') q = q.eq('completed', false).lt('end_date', todayStr())
  if (args.dateFrom && args.dateTo) {
    // "วันครบกำหนด" ของงาน = end_date ถ้ามี ไม่งั้นใช้ start_date (แบบเดียวกับ
    // view pending_tasks) — กรองว่าวันนั้นตกอยู่ในช่วง [dateFrom, dateTo]
    q = q.or(
      `and(end_date.gte.${args.dateFrom},end_date.lte.${args.dateTo}),`
      + `and(end_date.is.null,start_date.gte.${args.dateFrom},start_date.lte.${args.dateTo})`,
    )
  }
  q = q.order('start_date', { ascending: true, nullsFirst: false }).limit(20)
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

async function execSearchBudgetProjects(supabase: SupabaseClient, args: { query?: string }) {
  let q = supabase.from('budget_projects').select('id, project_name, department_code, budget_filter, planned_revenue, planned_expense').neq('status', 'deleted').limit(15)
  if (args.query?.trim()) q = q.or(`project_name.ilike.%${args.query.trim()}%,department_code.ilike.%${args.query.trim()}%,budget_filter.ilike.%${args.query.trim()}%`)
  const { data: projects, error } = await q
  if (error) return { error: error.message }
  if (!projects?.length) return { count: 0, projects: [] }

  const ids = projects.map((p) => p.id)
  const { data: txs } = await supabase.from('budget_transactions').select('project_id, kind, amount').in('project_id', ids).eq('deleted', false)
  const actualByProject = new Map<string, { revenue: number; expense: number }>()
  for (const t of txs ?? []) {
    const cur = actualByProject.get(t.project_id) ?? { revenue: 0, expense: 0 }
    if (t.kind === 'revenue') cur.revenue += Number(t.amount)
    else cur.expense += Number(t.amount)
    actualByProject.set(t.project_id, cur)
  }

  return {
    count: projects.length,
    projects: projects.map((p) => ({
      id: p.id, project_name: p.project_name, department_code: p.department_code, budget_filter: p.budget_filter,
      planned_expense: p.planned_expense, actual_expense: actualByProject.get(p.id)?.expense ?? 0,
      planned_revenue: p.planned_revenue, actual_revenue: actualByProject.get(p.id)?.revenue ?? 0,
    })),
  }
}

async function execGetBudgetProject(supabase: SupabaseClient, args: { projectId?: string }) {
  if (!args.projectId) return { error: 'missing projectId' }
  const { data: project, error } = await supabase.from('budget_projects').select('*').eq('id', args.projectId).single()
  if (error || !project) return { error: error?.message ?? 'ไม่พบโครงการนี้' }
  const { data: txs } = await supabase
    .from('budget_transactions')
    .select('transaction_date, kind, amount, vendor, description, accounting_code')
    .eq('project_id', args.projectId)
    .eq('deleted', false)
    .order('transaction_date', { ascending: false })
    .limit(30)
  const actualExpense = (txs ?? []).filter((t) => t.kind === 'expense').reduce((sum, t) => sum + Number(t.amount), 0)
  const actualRevenue = (txs ?? []).filter((t) => t.kind === 'revenue').reduce((sum, t) => sum + Number(t.amount), 0)
  return { project, actualExpense, actualRevenue, transactions: txs ?? [] }
}

async function execSearchTodos(supabase: SupabaseClient, ownerId: string, args: { query?: string; status?: string }) {
  let q = supabase
    .from('todo_items')
    .select('id, title, note, status, priority, due_date, due_time')
    .eq('owner_id', ownerId)
    .eq('deleted', false)
    .limit(20)
  if (args.query?.trim()) q = q.or(`title.ilike.%${args.query.trim()}%,note.ilike.%${args.query.trim()}%`)
  if (args.status === 'open') q = q.eq('status', 'open')
  else if (args.status === 'done') q = q.eq('status', 'done')
  q = q.order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
  const { data, error } = await q
  if (error) return { error: error.message }
  return { count: data?.length ?? 0, todos: data ?? [] }
}

async function execSearchApprovals(supabase: SupabaseClient, args: { query?: string; status?: string }) {
  let q = supabase
    .from('approval_documents')
    .select('id, code, title, status, created_by_email, created_at')
    .eq('deleted', false)
    .limit(20)
  if (args.query?.trim()) q = q.ilike('title', `%${args.query.trim()}%`)
  if (args.status && args.status !== 'all') q = q.eq('status', args.status)
  q = q.order('created_at', { ascending: false })
  const { data, error } = await q
  if (error) return { error: error.message }
  return { count: data?.length ?? 0, documents: data ?? [] }
}

async function execGetApproval(supabase: SupabaseClient, args: { approvalId?: string }) {
  if (!args.approvalId) return { error: 'missing approvalId' }
  const { data: doc, error } = await supabase
    .from('approval_documents')
    .select('id, code, title, description, status, created_by_email, created_at')
    .eq('id', args.approvalId)
    .single()
  if (error || !doc) return { error: error?.message ?? 'ไม่พบเอกสารนี้' }
  const { data: approvers } = await supabase
    .from('approval_approvers')
    .select('order_no, approver_name, status, acted_at, note')
    .eq('approval_id', args.approvalId)
    .order('order_no', { ascending: true })
  return { document: doc, approvers: approvers ?? [] }
}

async function execSearchMembers(supabase: SupabaseClient, args: { query?: string; committee?: string }) {
  let q = supabase
    .from('members')
    .select('id, name_th, name_en, nickname, position_committee, position_yec, province, email, phone, committees(name, name_en, code)')
    .eq('active', true)
    .limit(20)
  if (args.query?.trim()) {
    const term = args.query.trim()
    q = q.or(
      `name_th.ilike.%${term}%,name_en.ilike.%${term}%,nickname.ilike.%${term}%,`
      + `position_committee.ilike.%${term}%,position_yec.ilike.%${term}%,province.ilike.%${term}%`,
    )
  }
  const { data, error } = await q
  if (error) return { error: error.message }
  let members = data ?? []
  if (args.committee?.trim()) {
    const term = args.committee.trim().toLowerCase()
    members = members.filter((m) => {
      const c = m.committees as { name?: string; name_en?: string; code?: string } | null
      return [c?.name, c?.name_en, c?.code].some((v) => v?.toLowerCase().includes(term))
    })
  }
  return {
    count: members.length,
    members: members.map((m) => ({
      id: m.id, name_th: m.name_th, name_en: m.name_en, nickname: m.nickname,
      position_committee: m.position_committee, position_yec: m.position_yec, province: m.province,
      email: m.email, phone: m.phone, committee: (m.committees as { name?: string } | null)?.name ?? null,
    })),
  }
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
    const { supabase, user } = await requireUser(req)
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

    let proposedAction: { type: 'create_task' | 'create_todo' | 'complete_todo'; payload: Record<string, unknown> } | null = null

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
        else if (call.function.name === 'search_budget_projects') result = await execSearchBudgetProjects(supabase, args)
        else if (call.function.name === 'get_budget_project') result = await execGetBudgetProject(supabase, args)
        else if (call.function.name === 'search_members') result = await execSearchMembers(supabase, args)
        else if (call.function.name === 'search_todos') result = await execSearchTodos(supabase, user.id, args)
        else if (call.function.name === 'search_approvals') result = await execSearchApprovals(supabase, args)
        else if (call.function.name === 'get_approval') result = await execGetApproval(supabase, args)
        else if (call.function.name === 'summarize_attachment') result = await execSummarizeAttachment(args)
        else if (call.function.name === 'propose_create_task') {
          proposedAction = { type: 'create_task', payload: args }
          result = { status: 'proposed', message: 'เตรียมข้อเสนอไว้แล้ว รอผู้ใช้ยืนยัน' }
        } else if (call.function.name === 'propose_create_todo') {
          proposedAction = { type: 'create_todo', payload: args }
          result = { status: 'proposed', message: 'เตรียมข้อเสนอไว้แล้ว รอผู้ใช้ยืนยัน' }
        } else if (call.function.name === 'propose_complete_todo') {
          const todoId = args.todoId as string | undefined
          if (!todoId) {
            result = { error: 'missing todoId' }
          } else {
            const { data: todo, error: todoErr } = await supabase
              .from('todo_items').select('id, title, status').eq('id', todoId).eq('owner_id', user.id).single()
            if (todoErr || !todo) {
              result = { error: 'ไม่พบ todo นี้ หรือไม่ใช่ของผู้ใช้คนนี้' }
            } else if (todo.status === 'done') {
              result = { status: 'already_done', message: 'Todo นี้ทำเสร็จไปแล้ว' }
            } else {
              proposedAction = { type: 'complete_todo', payload: { todoId: todo.id, title: todo.title } }
              result = { status: 'proposed', message: 'เตรียมข้อเสนอไว้แล้ว รอผู้ใช้ยืนยัน' }
            }
          }
        } else result = { error: `unknown tool: ${call.function.name}` }

        messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) })
      }
    }

    return jsonResponse({ success: true, reply: 'ขอโทษค่ะ ตอบไม่ทันในรอบนี้ ลองถามใหม่อีกครั้งนะคะ', messages, proposedAction })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
