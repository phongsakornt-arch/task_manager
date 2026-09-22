import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    if (user.role !== 'super_admin') return jsonResponse({ error: 'Forbidden' }, 403)

    const { userId } = await req.json()
    if (!userId || typeof userId !== 'string') return jsonResponse({ error: 'userId is required' }, 400)
    if (userId === user.id) return jsonResponse({ error: 'ลบบัญชีตัวเองไม่ได้' }, 400)

    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', userId)
      .single()
    if (targetError || !target) return jsonResponse({ error: 'ไม่พบผู้ใช้นี้' }, 404)

    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)
    if (deleteError) {
      // Most FK links from tasks/approvals/budget/activity_log to this user
      // are NO ACTION (protective) — a user who has created or touched any
      // record can't be hard-deleted. Surface that clearly instead of a raw DB error.
      const blocked = /foreign key|violates/i.test(deleteError.message)
      return jsonResponse({
        error: blocked
          ? 'ลบไม่ได้ เพราะผู้ใช้นี้มีข้อมูลผูกอยู่ในระบบ (task, เอกสาร, ธุรกรรม ฯลฯ) แนะนำให้ปิดการใช้งาน (Inactive) แทน'
          : deleteError.message,
      }, 400)
    }

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: 'user.deleted',
      detail: `Deleted user ${target.email}`,
      meta: { user_id: userId, email: target.email },
    })

    return jsonResponse({ success: true, userId })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})
