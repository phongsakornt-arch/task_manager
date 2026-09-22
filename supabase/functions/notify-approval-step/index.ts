import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser, serviceClient } from '../_shared/auth.ts'

// เรียกหลัง submit เอกสาร หรือหลังผู้อนุมัติกดอนุมัติ/ขอแก้ไข (จากฝั่ง app ที่ login แล้ว)
// เช็คสถานะล่าสุดเองแล้วตัดสินใจว่าจะแจ้งใคร — ไม่ต้องส่ง action มาบอก กันข้อมูลไม่ตรงกับ DB จริง
// body: { approvalId: string }
async function sendPush(supabaseUrl: string, serviceRoleKey: string, userIds: string[], title: string, body: string, url: string, tag: string) {
  if (!userIds.length) return 0
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ userIds, title, body, url, tag }),
    })
    const json = await res.json().catch(() => null)
    return json?.sent ?? 0
  } catch {
    return 0
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const serviceRoleKeyHeader = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const isServiceRole = !!serviceRoleKeyHeader && authHeader === `Bearer ${serviceRoleKeyHeader}`
    if (!isServiceRole) await requireUser(req)

    const supabase = serviceClient()
    const { approvalId } = await req.json()
    if (!approvalId) return jsonResponse({ error: 'Missing approvalId' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Missing service configuration' }, 500)

    const { data: doc, error: docError } = await supabase
      .from('approval_documents')
      .select('id, title, status, created_by')
      .eq('id', approvalId)
      .single()
    if (docError || !doc) return jsonResponse({ error: 'Approval not found' }, 404)

    let sent = 0

    if (doc.status === 'approved' || doc.status === 'revision_requested') {
      if (doc.created_by) {
        sent += await sendPush(
          supabaseUrl, serviceRoleKey, [doc.created_by],
          doc.status === 'approved' ? 'เอกสารอนุมัติแล้ว' : 'เอกสารถูกขอแก้ไข',
          doc.title,
          '/approval',
          `approval-${doc.id}-${doc.status}`,
        )
      }
    } else if (doc.status === 'pending') {
      const { data: chain } = await supabase
        .from('approval_approvers')
        .select('order_no, approver_email, status')
        .eq('approval_id', approvalId)
        .order('order_no')
      const nextApprover = (chain ?? []).find((item) => item.status === 'waiting')
      if (nextApprover?.approver_email) {
        const { data: matchedUser } = await supabase
          .from('users')
          .select('id')
          .eq('email', nextApprover.approver_email)
          .eq('active', true)
          .maybeSingle()
        if (matchedUser) {
          sent += await sendPush(
            supabaseUrl, serviceRoleKey, [matchedUser.id],
            'มีเอกสารรออนุมัติ',
            doc.title,
            '/approval',
            `approval-${doc.id}-pending`,
          )
        }
      }
    }

    return jsonResponse({ success: true, sent })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
