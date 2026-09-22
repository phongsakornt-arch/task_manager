import { serviceClient } from './auth.ts'

// แจ้งเตือน super_admin ทุกคน (ยกเว้นคนที่ทำ action เอง) ผ่าน send-push
// ใช้ในจุดที่ logActivity ฝั่ง client เอื้อมไม่ถึง (เช่น edge function สร้าง/ลบผู้ใช้)
export async function notifySuperAdmins(excludeUserId: string | null, title: string, body: string, tag?: string) {
  try {
    const supabase = serviceClient()
    const { data: admins } = await supabase.from('users').select('id').eq('role', 'super_admin').eq('active', true)
    const userIds = (admins ?? []).map((a) => a.id).filter((id) => id !== excludeUserId)
    if (!userIds.length) return

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) return

    await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ userIds, title, body, tag }),
    }).catch(() => {})
  } catch {
    // การแจ้งเตือนเป็นส่วนเสริม — ไม่บล็อก action หลักถ้าส่งไม่สำเร็จ
  }
}
