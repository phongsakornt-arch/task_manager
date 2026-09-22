import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

function calendarPayload(task: Record<string, string | boolean | null>) {
  const firstDate = task.start_date || task.end_date
  if (!firstDate || typeof firstDate !== 'string') return null
  const hasTime = Boolean(task.start_time || task.end_time)
  const endDate = typeof task.end_date === 'string' ? task.end_date : firstDate

  if (!hasTime) {
    const end = new Date(`${endDate}T00:00:00`)
    end.setDate(end.getDate() + 1)
    return { summary: task.title, start: { date: firstDate }, end: { date: end.toISOString().slice(0, 10) } }
  }

  const startTime = typeof task.start_time === 'string' ? task.start_time.slice(0, 5) : '09:00'
  const endTime = typeof task.end_time === 'string' ? task.end_time.slice(0, 5) : '10:00'
  return {
    summary: task.title,
    description: task.description || '',
    start: { dateTime: `${firstDate}T${startTime}:00+07:00`, timeZone: 'Asia/Bangkok' },
    end: { dateTime: `${endDate}T${endTime}:00+07:00`, timeZone: 'Asia/Bangkok' },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    if (!['admin', 'super_admin'].includes(user.role)) return jsonResponse({ error: 'Forbidden' }, 403)

    const body = await req.json().catch(() => ({}))
    const limit = Math.min(Number(body.limit ?? 200), 500)
    const dryRun = body.dryRun !== false

    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, description, start_date, end_date, start_time, end_time, completed, deleted')
      .eq('deleted', false)
      .or('start_date.not.is.null,end_date.not.is.null')
      .limit(limit)

    if (error) return jsonResponse({ error: error.message }, 400)

    const payloads = (data ?? []).map((task) => ({ taskId: task.id, payload: calendarPayload(task) }))
    if (!dryRun) {
      await supabase
        .from('tasks')
        .update({
          calendar_sync_status: 'queued_for_calendar_sync',
          calendar_last_sync_at: new Date().toISOString(),
        })
        .in('id', payloads.map((item) => item.taskId))
    }

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: 'task.calendar.resync.preview',
      detail: `Calendar resync prepared ${payloads.length} task(s)`,
      meta: { dry_run: dryRun, count: payloads.length },
    })

    return jsonResponse({
      success: true,
      status: dryRun ? 'dry_run' : 'queued_without_external_write',
      count: payloads.length,
      payloads,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
