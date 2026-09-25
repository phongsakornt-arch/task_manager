import { supabase } from './supabase'
import type { User } from '../types'

// action ในกลุ่มนี้เท่านั้นที่จะแจ้งเตือน super_admin แบบ push — คัดเฉพาะที่ถือว่า
// "สำคัญ" (งานสร้าง/ลบ/เสร็จ, อนุมัติเอกสาร, งบประมาณ) บวกกับ kanban ทุกฟังก์ชันตามที่ตกลงไว้
// ไม่รวม todo ส่วนตัว หรือ action ย่อยอื่นๆ (task.updated, section.reordered ฯลฯ) เพราะถี่เกินไป
const NOTIFY_SUPER_ADMIN_ACTIONS = new Set([
  'task.created', 'task.deleted', 'task.completed',
  'approval.submitted', 'approval.approved', 'approval.revision_requested', 'approval.cancelled', 'approval.deleted',
  'budget.transaction.created', 'budget.transaction.deleted', 'budget.plan.updated',
  'kanban.created', 'kanban.updated', 'kanban.deleted', 'kanban.moved',
  // Data Master มีข้อมูลอ่อนไหว (เลขบัตรประชาชน) ที่สุดในระบบ — แจ้ง super_admin
  // ทุกครั้งที่มีการแก้ไข/สร้าง/export เพื่อให้ตรวจสอบย้อนหลังได้
  'master_data.created', 'master_data.updated', 'master_data.exported',
])

const ACTION_TITLE: Record<string, string> = {
  task: 'ความเคลื่อนไหวงาน',
  approval: 'ความเคลื่อนไหวเอกสารอนุมัติ',
  budget: 'ความเคลื่อนไหวงบประมาณ',
  kanban: 'ความเคลื่อนไหว Kanban',
  master_data: 'ความเคลื่อนไหว Data Master',
}

export async function logActivity(
  user: User | null,
  action: string,
  detail: string,
  meta?: Record<string, unknown>,
) {
  await supabase.from('activity_log').insert({
    actor_id: user?.id ?? null,
    actor_email: user?.email ?? null,
    action,
    detail,
    meta: meta ?? null,
  })

  if (NOTIFY_SUPER_ADMIN_ACTIONS.has(action)) {
    void notifySuperAdmins(user, action, detail)
  }
}

async function notifySuperAdmins(actor: User | null, action: string, detail: string) {
  try {
    const { data: admins } = await supabase.from('users').select('id').eq('role', 'super_admin').eq('active', true)
    const userIds = (admins ?? []).map(a => a.id).filter(id => id !== actor?.id)
    if (!userIds.length) return
    const prefix = action.split('.')[0]
    await supabase.functions.invoke('send-push', {
      body: {
        userIds,
        title: ACTION_TITLE[prefix] ?? 'ความเคลื่อนไหวในระบบ',
        body: `${actor?.name ?? actor?.email ?? 'ระบบ'}: ${detail}`,
        tag: `activity-${action}`,
      },
    })
  } catch {
    // การแจ้งเตือนเป็นส่วนเสริม — ไม่บล็อกการทำงานหลักถ้าส่งไม่สำเร็จ
  }
}
