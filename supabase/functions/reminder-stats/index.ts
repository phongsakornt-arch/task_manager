import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

function bangkokDate(offsetDays = 0) {
  const now = new Date()
  const bangkok = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  bangkok.setDate(bangkok.getDate() + offsetDays)
  return `${bangkok.getFullYear()}-${String(bangkok.getMonth() + 1).padStart(2, '0')}-${String(bangkok.getDate()).padStart(2, '0')}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase } = await requireEditor(req)
    const body = await req.json().catch(() => ({}))
    const targetDate = body.date || bangkokDate(1)

    const { data: tasks, error: taskError } = await supabase
      .from('tasks')
      .select('id, title, start_date, completed, task_members(members(email))')
      .eq('deleted', false)
      .eq('completed', false)
      .eq('start_date', targetDate)
    if (taskError) return jsonResponse({ error: taskError.message }, 400)

    const { data: logs, error: logError } = await supabase
      .from('activity_log')
      .select('id, action, meta, created_at')
      .in('action', ['task.reminder.sent', 'task.reminder.preview', 'task.reminder.skipped'])
      .gte('created_at', `${targetDate}T00:00:00+07:00`)
      .lt('created_at', `${targetDate}T23:59:59+07:00`)
    if (logError) return jsonResponse({ error: logError.message }, 400)

    const candidateTasks = tasks ?? []
    const sentTaskIds = new Set((logs ?? [])
      .flatMap((log) => {
        const meta = log.meta as { task_id?: string; previews?: { taskId?: string }[] } | null
        if (meta?.task_id) return [meta.task_id]
        return (meta?.previews ?? []).map((item) => item.taskId).filter(Boolean) as string[]
      }))

    return jsonResponse({
      success: true,
      targetDate,
      candidates: candidateTasks.length,
      sentOrPreviewed: sentTaskIds.size,
      pending: candidateTasks.filter((task) => !sentTaskIds.has(task.id)).length,
      tasks: candidateTasks.map((task) => ({
        id: task.id,
        title: task.title,
        assigneeEmails: (task.task_members ?? []).map((item) => item.members?.email).filter(Boolean),
        alreadyHandled: sentTaskIds.has(task.id),
      })),
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
