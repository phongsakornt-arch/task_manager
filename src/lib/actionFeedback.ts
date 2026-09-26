import { toast } from '../stores/toastStore'

// Every Supabase request goes through feedbackFetch (wired in lib/supabase.ts), so
// each write/action gets a success/failure popup without touching every button.
// Writes that land within a short window (e.g. saving a task also rewrites its
// task_members/task_staff rows) are reported as ONE popup.

const TABLE_LABELS: Record<string, string> = {
  tasks: 'งาน',
  sections: 'Section',
  task_members: 'ผู้เกี่ยวข้องในงาน',
  task_staff: 'ผู้รับผิดชอบงาน',
  approval_documents: 'เอกสารอนุมัติ',
  approval_approvers: 'ลำดับผู้อนุมัติ',
  approval_logs: 'ประวัติการอนุมัติ',
  budget_projects: 'โครงการงบประมาณ',
  budget_transactions: 'รายการงบประมาณ',
  budget_plans: 'แผนงบประมาณ',
  committees: 'คณะกรรมการ',
  members: 'สมาชิกทำเนียบ',
  meetings: 'การประชุม',
  meeting_members: 'รายชื่อผู้เข้าประชุม',
  kanban_cards: 'การ์ด Kanban',
  todo_items: 'Todo',
  master_members: 'ข้อมูลสมาชิก',
  users: 'ผู้ใช้',
}

// Written alongside a primary record; only named in the popup if nothing else was written.
const SECONDARY_TABLES = new Set(['task_members', 'task_staff', 'approval_logs', 'approval_approvers', 'meeting_members'])
// Background bookkeeping, never worth a popup.
const SILENT_TABLES = new Set(['activity_log'])

const WRITE_RPCS: Record<string, string> = {
  create_member: 'เพิ่มสมาชิกทำเนียบสำเร็จ',
  create_committee: 'เพิ่มคณะกรรมการสำเร็จ',
}

const FUNCTION_SUCCESS: Record<string, string> = {
  'admin-create-user': 'เพิ่มผู้ใช้สำเร็จ',
  'admin-delete-user': 'ลบผู้ใช้สำเร็จ',
  'admin-set-user-password': 'ตั้งรหัสผ่านสำเร็จ',
  'approval-links': 'สร้างลิงก์อนุมัติสำเร็จ',
  'approval-public-action': 'บันทึกผลการพิจารณาสำเร็จ',
  'upload-approval-version': 'อัปโหลดเอกสารฉบับใหม่สำเร็จ',
  'meeting-checkin-submit': 'ส่งคำตอบเช็คชื่อสำเร็จ',
  'drive-bridge': 'สร้างโฟลเดอร์ Google Drive สำเร็จ',
  'sync-task-calendar': 'ซิงก์ Google Calendar สำเร็จ',
  'resync-task-calendar': 'ซิงก์ Google Calendar ใหม่ทั้งหมดสำเร็จ',
  'send-task-email': 'ส่งอีเมลสำเร็จ',
  'backup-snapshot': 'สำรองข้อมูลสำเร็จ',
  'restore-latest-backup': 'กู้คืนข้อมูลสำเร็จ',
}

// Loaders, background jobs, and AI tools that already show their own inline
// results/errors (the check-in page also polls every 6s — must never toast).
const FUNCTION_IGNORE = new Set([
  'send-push', 'notify-approval-step', 'approval-public-data', 'meeting-checkin-data',
  'app-meta', 'system-health', 'list-backups', 'reminder-stats', 'google-oauth-status', 'google-oauth-start',
  'ai-assistant', 'ai-task-parse', 'ai-annual-report', 'ai-approval', 'ai-member-search', 'ai-todo-split',
  'extract-doc-info', 'extract-receipt',
])

type Tracked = { label: string; primary: boolean; kind: 'rest' | 'fn' | 'storage' }
type Outcome = { ok: true; label: string; primary: boolean } | { ok: false; message: string }

let pending: Outcome[] = []
let flushTimer: ReturnType<typeof setTimeout> | undefined

function record(outcome: Outcome) {
  pending.push(outcome)
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 600)
}

function flush() {
  const batch = pending
  pending = []
  const failed = batch.find((o): o is Extract<Outcome, { ok: false }> => !o.ok)
  if (failed) {
    toast.error(`❌ ทำรายการไม่สำเร็จ: ${failed.message}`)
    return
  }
  const successes = batch.filter((o): o is Extract<Outcome, { ok: true }> => o.ok)
  const main = successes.find(o => o.primary) ?? successes[0]
  if (main) toast.success(`✅ ${main.label}`)
}

export function translateError(raw: string): string {
  const msg = raw || 'ไม่ทราบสาเหตุ'
  if (/row-level security|permission denied|42501|forbidden/i.test(msg)) return 'ไม่มีสิทธิ์ทำรายการนี้'
  if (/duplicate key|23505/i.test(msg)) return 'ข้อมูลซ้ำกับที่มีอยู่แล้ว'
  if (/weak|pwned|easy to guess/i.test(msg)) return 'รหัสผ่านนี้เดาง่ายหรือเคยรั่วไหลในอินเทอร์เน็ต กรุณาใช้รหัสอื่นที่ซับซ้อนกว่านี้'
  if (/should be different|same_password/i.test(msg)) return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม'
  if (/at least 8/i.test(msg)) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'
  if (/invalid authorization token|jwt expired|invalid jwt|missing authorization/i.test(msg)) return 'เซสชันหมดอายุ กรุณา refresh หน้าแล้วลองใหม่'
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'
  return msg
}

async function errorFromResponse(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return translateError(body?.message ?? body?.error ?? body?.msg ?? body?.error_description ?? `HTTP ${res.status}`)
  } catch {
    return translateError(`HTTP ${res.status}`)
  }
}

// For pages that surface invoke() errors themselves: supabase-js only exposes a
// generic "non-2xx status code" message; the real reason is in error.context.
export async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context
  if (context instanceof Response) return errorFromResponse(context.clone())
  return translateError(error instanceof Error ? error.message : String(error))
}

function classify(url: string, method: string, body: unknown): Tracked | null {
  let path: string
  try { path = new URL(url).pathname } catch { return null }

  if (path.startsWith('/rest/v1/rpc/')) {
    const label = WRITE_RPCS[path.slice('/rest/v1/rpc/'.length)]
    return label ? { label, primary: true, kind: 'rest' } : null
  }

  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length).split('/')[0]
    if (SILENT_TABLES.has(table)) return null
    if (table === 'push_subscriptions') {
      return { label: method === 'DELETE' ? 'ปิดการแจ้งเตือนสำเร็จ' : 'เปิดการแจ้งเตือนสำเร็จ', primary: true, kind: 'rest' }
    }
    const noun = TABLE_LABELS[table] ?? 'ข้อมูล'
    const softDelete = method === 'PATCH' && typeof body === 'string' && /"deleted"\s*:\s*true/.test(body)
    const verb = method === 'POST' ? 'เพิ่ม' : method === 'DELETE' || softDelete ? 'ลบ' : 'บันทึก'
    return { label: `${verb}${noun}สำเร็จ`, primary: !SECONDARY_TABLES.has(table), kind: 'rest' }
  }

  if (path.startsWith('/functions/v1/')) {
    const name = path.slice('/functions/v1/'.length).split('/')[0]
    if (FUNCTION_IGNORE.has(name)) return null
    return { label: FUNCTION_SUCCESS[name] ?? '', primary: true, kind: 'fn' }
  }

  if (path.startsWith('/storage/v1/object/') && (method === 'POST' || method === 'PUT')) {
    return { label: 'อัปโหลดไฟล์สำเร็จ', primary: false, kind: 'storage' }
  }

  return null
}

async function inspect(res: Response, tracked: Tracked) {
  if (!res.ok) {
    record({ ok: false, message: await errorFromResponse(res) })
    return
  }
  if (tracked.kind === 'fn') {
    // several functions answer 200 with { error } / { success: false } instead of a status code
    try {
      const data = await res.json()
      if (data && (data.error || data.success === false)) {
        record({ ok: false, message: translateError(String(data.error ?? data.message ?? 'ไม่สำเร็จ')) })
        return
      }
    } catch { /* non-JSON body: treat as success */ }
  }
  if (tracked.label) record({ ok: true, label: tracked.label, primary: tracked.primary })
}

export const feedbackFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

  // Callers opt out per request with `__silent: true` in the JSON body (used for
  // background side effects); it's stripped here so the server never sees it.
  let silent = false
  let requestInit = init
  if (typeof init?.body === 'string' && init.body.includes('"__silent"')) {
    try {
      const parsed = JSON.parse(init.body)
      if (parsed && typeof parsed === 'object' && parsed.__silent) {
        silent = true
        delete parsed.__silent
        requestInit = { ...init, body: JSON.stringify(parsed) }
      }
    } catch { /* not JSON — leave as is */ }
  }

  const tracked = silent || method === 'GET' || method === 'HEAD' ? null : classify(url, method, requestInit?.body)

  let response: Response
  try {
    response = await globalThis.fetch(input, requestInit)
  } catch (err) {
    if (tracked) record({ ok: false, message: translateError(err instanceof Error ? err.message : String(err)) })
    throw err
  }
  if (tracked) void inspect(response.clone(), tracked)
  return response
}
