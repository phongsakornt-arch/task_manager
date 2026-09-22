import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabase = serviceClient()
    const { code, memberId, newName, status, attendMode } = await req.json()
    if (!code || (!memberId && !newName) || !status) return jsonResponse({ error: 'Missing check-in data' }, 400)
    if (!['going', 'leave'].includes(status)) return jsonResponse({ error: 'Invalid status' }, 400)
    if (attendMode && !['onsite', 'online'].includes(attendMode)) return jsonResponse({ error: 'Invalid attend mode' }, 400)

    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id')
      .eq('code', code)
      .single()
    if (meetingError || !meeting) return jsonResponse({ error: 'ไม่พบการประชุมนี้' }, 404)

    let resolvedMemberId = memberId as string | undefined
    if (!resolvedMemberId && newName) {
      const trimmed = String(newName).trim()
      if (!trimmed) return jsonResponse({ error: 'กรุณาระบุชื่อ' }, 400)
      const { data: created, error: createError } = await supabase
        .from('members')
        .insert({ name_th: trimmed, active: true })
        .select('id')
        .single()
      if (createError || !created) return jsonResponse({ error: createError?.message ?? 'เพิ่มชื่อไม่สำเร็จ' }, 400)
      resolvedMemberId = created.id
    }

    // ไม่ได้ถูกเลือกไว้ล่วงหน้า (คนหน้างานที่แอดมินยังไม่ได้เพิ่ม) — เพิ่มเข้ารายชื่อประชุมนี้ให้อัตโนมัติ
    // เพื่อให้ตัวนับ/รายชื่อฝั่งแอดมินรวมคนนี้ด้วย
    await supabase
      .from('meeting_members')
      .upsert({ meeting_id: meeting.id, member_id: resolvedMemberId }, { onConflict: 'meeting_id,member_id' })

    const { error: upsertError } = await supabase
      .from('meeting_responses')
      .upsert(
        { meeting_id: meeting.id, member_id: resolvedMemberId, status, attend_mode: attendMode ?? null, responded_at: new Date().toISOString() },
        { onConflict: 'meeting_id,member_id' },
      )
    if (upsertError) return jsonResponse({ error: upsertError.message }, 400)

    return jsonResponse({ success: true, memberId: resolvedMemberId })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
