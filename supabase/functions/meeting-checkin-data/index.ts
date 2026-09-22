import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabase = serviceClient()
    const { code } = await req.json()
    if (!code) return jsonResponse({ error: 'Missing meeting code' }, 400)

    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id, code, title, tag, date, time, location, format')
      .eq('code', code)
      .single()
    if (meetingError || !meeting) return jsonResponse({ error: 'ไม่พบการประชุมนี้' }, 404)

    const { data: meetingMembers } = await supabase
      .from('meeting_members')
      .select('member_id')
      .eq('meeting_id', meeting.id)

    const memberIds = (meetingMembers ?? []).map((row) => row.member_id)
    const { data: members } = memberIds.length
      ? await supabase
          .from('members')
          .select('id, name_th, nickname')
          .in('id', memberIds)
          .eq('active', true)
          .order('name_th')
      : { data: [] }

    const { data: responses } = await supabase
      .from('meeting_responses')
      .select('member_id, status, attend_mode')
      .eq('meeting_id', meeting.id)

    return jsonResponse({
      success: true,
      meeting,
      members: members ?? [],
      responses: responses ?? [],
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
