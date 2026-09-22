import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabase = serviceClient()
    const { code, memberId, status, attendMode } = await req.json()
    if (!code || !memberId || !status) return jsonResponse({ error: 'Missing check-in data' }, 400)
    if (!['going', 'leave'].includes(status)) return jsonResponse({ error: 'Invalid status' }, 400)
    if (attendMode && !['onsite', 'online'].includes(attendMode)) return jsonResponse({ error: 'Invalid attend mode' }, 400)

    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id')
      .eq('code', code)
      .single()
    if (meetingError || !meeting) return jsonResponse({ error: 'ไม่พบการประชุมนี้' }, 404)

    const { data: invited, error: invitedError } = await supabase
      .from('meeting_members')
      .select('member_id')
      .eq('meeting_id', meeting.id)
      .eq('member_id', memberId)
      .maybeSingle()
    if (invitedError || !invited) return jsonResponse({ error: 'คุณไม่ได้อยู่ในรายชื่อประชุมนี้' }, 403)

    const { error: upsertError } = await supabase
      .from('meeting_responses')
      .upsert(
        { meeting_id: meeting.id, member_id: memberId, status, attend_mode: attendMode ?? null, responded_at: new Date().toISOString() },
        { onConflict: 'meeting_id,member_id' },
      )
    if (upsertError) return jsonResponse({ error: upsertError.message }, 400)

    return jsonResponse({ success: true })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
