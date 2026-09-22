import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return jsonResponse({ error: 'Invalid cron secret' }, 401)
  }

  try {
    const supabase = serviceClient()

    const { data: pending, error: pendingError } = await supabase
      .from('pending_tasks')
      .select('id, title, due_status')
      .in('due_status', ['overdue', 'today'])
    if (pendingError) return jsonResponse({ error: pendingError.message }, 400)

    const overdueCount = (pending ?? []).filter((t) => t.due_status === 'overdue').length
    const todayCount = (pending ?? []).filter((t) => t.due_status === 'today').length

    if (overdueCount === 0 && todayCount === 0) {
      return jsonResponse({ success: true, status: 'nothing_due', pushSent: 0 })
    }

    // แจ้งเตือนสรุปรายวันให้เฉพาะ admin/super_admin เท่านั้น (ตามที่ตกลงกันไว้)
    const { data: admins, error: adminError } = await supabase
      .from('users')
      .select('id')
      .in('role', ['admin', 'super_admin'])
      .eq('active', true)
    if (adminError) return jsonResponse({ error: adminError.message }, 400)

    const userIds = (admins ?? []).map((u) => u.id)
    let pushSent = 0

    if (userIds.length) {
      const parts: string[] = []
      if (overdueCount > 0) parts.push(`เกินกำหนด ${overdueCount} งาน`)
      if (todayCount > 0) parts.push(`ครบกำหนดวันนี้ ${todayCount} งาน`)

      const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      if (publicKey && serviceRoleKey && supabaseUrl) {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({
              userIds,
              title: 'สรุปงานค้างประจำวัน',
              body: parts.join(' · '),
              url: '/pending',
              tag: 'daily-task-reminder',
            }),
          })
          const json = await res.json().catch(() => null)
          if (json?.sent) pushSent = json.sent
        } catch {
          // ไม่ทำให้ทั้ง request ล้มเหลวถ้าส่ง push ไม่สำเร็จ
        }
      }
    }

    await supabase.from('activity_log').insert({
      action: 'task.reminder.sent',
      detail: `Daily reminder: ${overdueCount} overdue, ${todayCount} due today`,
      meta: { overdue_count: overdueCount, today_count: todayCount, admin_count: userIds.length, push_sent: pushSent },
    })

    return jsonResponse({ success: true, overdueCount, todayCount, adminCount: userIds.length, pushSent })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
