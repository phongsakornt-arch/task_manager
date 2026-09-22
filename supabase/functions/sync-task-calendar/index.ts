import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'
import { getGoogleAccessToken } from '../_shared/googleOAuth.ts'

const YEC_CALENDAR_ID = 'YEC@thaichamber.org'

type TaskRow = {
  id: string
  title: string
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  completed: boolean
  deleted: boolean
  calendar_event_id?: string | null
  calendar_event_url?: string | null
  calendar_last_sync_hash?: string | null
}

type GoogleEvent = {
  id?: string
  htmlLink?: string
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function googleCalendarRequest<T>(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (response.status === 204) return null as T
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body?.error?.message || body?.error || `Google Calendar API failed (${response.status})`
    const error = new Error(message)
    ;(error as Error & { status?: number }).status = response.status
    throw error
  }
  return body as T
}

function calendarPayload(task: TaskRow, attendees: string[] = []) {
  const firstDate = task.start_date || task.end_date
  if (!firstDate) return null
  const hasTime = Boolean(task.start_time || task.end_time)
  const endDate = task.end_date || firstDate

  const base = {
    summary: task.completed ? `[Done] ${task.title}` : task.title,
    description: task.description || '',
    extendedProperties: {
      private: {
        source: 'yec-taskmanager',
        taskId: task.id,
      },
    },
    ...(attendees.length ? { attendees: attendees.map(email => ({ email })) } : {}),
  }

  if (!hasTime) {
    const end = new Date(`${endDate}T00:00:00+07:00`)
    end.setDate(end.getDate() + 1)
    return {
      ...base,
      start: { date: firstDate },
      end: { date: end.toISOString().slice(0, 10) },
    }
  }

  const startTime = (task.start_time || '09:00').slice(0, 5)
  const endTime = (task.end_time || task.start_time || '10:00').slice(0, 5)
  return {
    ...base,
    start: { dateTime: `${firstDate}T${startTime}:00+07:00`, timeZone: 'Asia/Bangkok' },
    end: { dateTime: `${endDate}T${endTime}:00+07:00`, timeZone: 'Asia/Bangkok' },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    const { taskId, force = false, attendees = [], notify = false } = await req.json()
    if (!taskId) return jsonResponse({ error: 'taskId is required' }, 400)
    const attendeeEmails: string[] = Array.isArray(attendees)
      ? Array.from(new Set(attendees.map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean)))
      : []
    const sendUpdates = notify && attendeeEmails.length ? 'all' : 'none'

    const calendarId = (Deno.env.get('GOOGLE_CALENDAR_ID') || YEC_CALENDAR_ID).trim()
    if (calendarId.toLowerCase() !== YEC_CALENDAR_ID.toLowerCase()) {
      return jsonResponse({ error: `Calendar sync is locked to ${YEC_CALENDAR_ID}`, status: 'calendar_not_allowed' }, 403)
    }

    const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).single()
    if (error || !data) return jsonResponse({ error: error?.message || 'Task not found' }, 404)
    const task = data as TaskRow

    let accessToken: string
    try {
      accessToken = await getGoogleAccessToken()
    } catch (tokenError) {
      await supabase.from('tasks').update({
        calendar_sync_status: 'skipped_missing_google_config',
        calendar_last_sync_at: new Date().toISOString(),
      }).eq('id', task.id)
      return jsonResponse({ success: false, status: 'missing_google_config', calendarId, message: tokenError instanceof Error ? tokenError.message : undefined })
    }

    if (task.deleted) {
      if (task.calendar_event_id) {
        await googleCalendarRequest(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(task.calendar_event_id)}?sendUpdates=none`, { method: 'DELETE' })
      }
      await supabase.from('tasks').update({
        calendar_event_id: null,
        calendar_event_url: null,
        calendar_sync_status: 'deleted_from_yec_calendar',
        calendar_last_sync_at: new Date().toISOString(),
      }).eq('id', task.id)
      return jsonResponse({ success: true, status: 'deleted_from_yec_calendar', calendarId })
    }

    const payload = calendarPayload(task, attendeeEmails)
    if (!payload) {
      await supabase.from('tasks').update({
        calendar_sync_status: 'skipped_no_date',
        calendar_last_sync_at: new Date().toISOString(),
      }).eq('id', task.id)
      return jsonResponse({ success: true, status: 'skipped_no_date', calendarId })
    }

    const hash = await sha256(JSON.stringify({ ...payload, completed: task.completed }))
    // A notify=true request is an explicit "send invite" click — always go
    // through to Google even if nothing changed, so attendees actually get emailed.
    if (!force && !notify && hash === task.calendar_last_sync_hash && task.calendar_event_id) {
      await supabase.from('tasks').update({
        calendar_sync_status: 'skipped_no_change',
        calendar_last_sync_at: new Date().toISOString(),
      }).eq('id', task.id)
      return jsonResponse({ success: true, status: 'skipped_no_change', calendarId, eventId: task.calendar_event_id, eventUrl: task.calendar_event_url })
    }

    let event: GoogleEvent | null = null
    if (task.calendar_event_id) {
      try {
        event = await googleCalendarRequest<GoogleEvent>(
          accessToken,
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(task.calendar_event_id)}?sendUpdates=${sendUpdates}`,
          { method: 'PATCH', body: JSON.stringify(payload) },
        )
      } catch (googleError) {
        if ((googleError as Error & { status?: number }).status !== 404) throw googleError
      }
    }

    if (!event) {
      event = await googleCalendarRequest<GoogleEvent>(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
    }

    const syncStatus = sendUpdates === 'all' ? 'invite_sent' : 'synced_yec_calendar'

    await supabase.from('tasks').update({
      calendar_event_id: event?.id ?? task.calendar_event_id ?? null,
      calendar_event_url: event?.htmlLink ?? task.calendar_event_url ?? null,
      calendar_last_sync_hash: hash,
      calendar_sync_status: syncStatus,
      calendar_last_sync_at: new Date().toISOString(),
    }).eq('id', task.id)

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: sendUpdates === 'all' ? 'task.calendar.invite_sent' : 'task.calendar.synced',
      detail: sendUpdates === 'all'
        ? `Sent calendar invite for ${task.title} to ${attendeeEmails.length} attendee(s)`
        : `Synced task to ${YEC_CALENDAR_ID}: ${task.title}`,
      meta: { task_id: task.id, calendar_id: calendarId, event_id: event?.id, force, attendees: attendeeEmails },
    })

    return jsonResponse({ success: true, status: syncStatus, calendarId, eventId: event?.id, eventUrl: event?.htmlLink, attendeeCount: attendeeEmails.length })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
