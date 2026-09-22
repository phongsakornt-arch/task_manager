import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

type TaskRow = {
  id: string
  title: string
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  sections?: { title?: string | null } | null
  task_types?: { name?: string | null } | null
  task_members?: { members?: { name_th?: string | null; email?: string | null } | null }[]
}

function formatDate(date?: string | null) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`))
}

function formatTime(time?: string | null) {
  return time ? time.slice(0, 5) : ''
}

function googleCalendarTemplateLink(task: TaskRow) {
  const firstDate = task.start_date || task.end_date
  if (!firstDate) return null
  const start = `${firstDate.replaceAll('-', '')}T${(task.start_time || '0900').replace(':', '').slice(0, 4)}00`
  const endDate = task.end_date || firstDate
  const end = `${endDate.replaceAll('-', '')}T${(task.end_time || task.start_time || '1000').replace(':', '').slice(0, 4)}00`
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    details: task.description || '',
    dates: `${start}/${end}`,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function buildHtml(task: TaskRow, calendarLink: string | null) {
  const dateLine = `${formatDate(task.start_date || task.end_date)} ${formatTime(task.start_time)}${task.end_time ? ` - ${formatTime(task.end_time)}` : ''}`.trim()
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
      <h2 style="margin:0 0 10px">${task.title}</h2>
      <p><strong>วันเวลา:</strong> ${dateLine}</p>
      <p><strong>สถานะ:</strong> ${task.sections?.title || '-'}</p>
      <p><strong>ประเภท:</strong> ${task.task_types?.name || '-'}</p>
      ${task.description ? `<p>${task.description.replaceAll('\n', '<br>')}</p>` : ''}
      ${calendarLink ? `<p><a href="${calendarLink}" target="_blank">เพิ่มใน Google Calendar</a></p>` : ''}
    </div>
  `
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    const { taskId, to } = await req.json()
    if (!taskId) return jsonResponse({ error: 'taskId is required' }, 400)

    const { data, error } = await supabase
      .from('tasks')
      .select('*, sections(title), task_types(name), task_members(members(name_th, email))')
      .eq('id', taskId)
      .single()
    if (error || !data) return jsonResponse({ error: error?.message || 'Task not found' }, 404)

    const task = data as TaskRow
    const recipients = Array.from(new Set(
      (Array.isArray(to) && to.length ? to : (task.task_members ?? []).map(item => item.members?.email))
        .map((email: string | null | undefined) => (email ?? '').trim().toLowerCase())
        .filter(Boolean),
    ))

    if (!recipients.length) return jsonResponse({ error: 'No assignee email found' }, 400)

    const calendarLink = googleCalendarTemplateLink(task)
    const html = buildHtml(task, calendarLink)
    const apiKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('TASK_EMAIL_FROM') || 'YEC Task Manager <onboarding@resend.dev>'

    if (!apiKey) {
      await supabase.from('activity_log').insert({
        actor_id: user.id,
        actor_email: user.email,
        action: 'task.email.preview',
        detail: `Email preview generated for task: ${task.title}`,
        meta: { task_id: task.id, recipients, missing_config: 'RESEND_API_KEY' },
      })
      return jsonResponse({ success: false, status: 'missing_resend_config', recipients, subject: `[YEC Task] ${task.title}`, html })
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject: `[YEC Task] ${task.title}`, html }),
    })
    const resendBody = await resendRes.json().catch(() => ({}))

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: resendRes.ok ? 'task.email.sent' : 'task.email.error',
      detail: resendRes.ok ? `Sent task email: ${task.title}` : `Task email failed: ${task.title}`,
      meta: { task_id: task.id, recipients, provider: 'resend', provider_response: resendBody },
    })

    if (!resendRes.ok) return jsonResponse({ success: false, status: 'provider_error', provider: resendBody }, 502)
    return jsonResponse({ success: true, recipients, provider: resendBody })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
