import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'

function bangkokDate(offsetDays = 0) {
  const now = new Date()
  const bangkok = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  bangkok.setDate(bangkok.getDate() + offsetDays)
  return `${bangkok.getFullYear()}-${String(bangkok.getMonth() + 1).padStart(2, '0')}-${String(bangkok.getDate()).padStart(2, '0')}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return jsonResponse({ error: 'Invalid cron secret' }, 401)
  }

  try {
    const supabase = serviceClient()
    const body = await req.json().catch(() => ({}))
    const targetDate = body.date || bangkokDate(1)

    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, description, start_date, end_date, start_time, end_time, task_members(members(name_th, email))')
      .eq('deleted', false)
      .eq('completed', false)
      .or(`start_date.eq.${targetDate},end_date.eq.${targetDate}`)

    if (error) return jsonResponse({ error: error.message }, 400)

    const tasks = data ?? []
    const previews = tasks.map((task) => {
      const recipients = Array.from(new Set((task.task_members ?? [])
        .map((item) => item.members?.email)
        .filter(Boolean)))
      return { taskId: task.id, title: task.title, recipients }
    })

    await supabase.from('activity_log').insert({
      action: 'task.reminder.preview',
      detail: `Daily reminder preview for ${targetDate}`,
      meta: { target_date: targetDate, task_count: tasks.length, previews },
    })

    return jsonResponse({
      success: true,
      status: Deno.env.get('RESEND_API_KEY') ? 'ready_to_send_not_enabled' : 'missing_resend_config',
      targetDate,
      taskCount: tasks.length,
      previews,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
