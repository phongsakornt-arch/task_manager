import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    // Auth + parse body พร้อมกัน
    const [{ supabase, user }, body] = await Promise.all([
      requireEditor(req.clone()),
      req.json(),
    ])
    const { approvalId } = body
    if (!approvalId) return jsonResponse({ error: 'approvalId is required' }, 400)

    // ดึง doc + approvers พร้อมกัน
    const [docRes, approversRes] = await Promise.all([
      supabase.from('approval_documents').select('id, title, status, deleted').eq('id', approvalId).single(),
      supabase.from('approval_approvers').select('id, approver_name, approver_email, token, status, order_no').eq('approval_id', approvalId).order('order_no'),
    ])

    if (docRes.error || !docRes.data || docRes.data.deleted)
      return jsonResponse({ error: 'Approval not found' }, 404)
    if (approversRes.error)
      return jsonResponse({ error: approversRes.error.message }, 400)

    const baseUrl = Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:5173'
    const links = (approversRes.data ?? []).map((approver) => ({
      approverId: approver.id,
      name: approver.approver_name,
      email: approver.approver_email,
      status: approver.status,
      url: `${baseUrl}/approval/public?approvalId=${approvalId}&approverId=${approver.id}&token=${approver.token}`,
    }))

    // Log แบบ fire-and-forget ไม่ต้อง await
    supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: 'approval.links.generated',
      detail: `Generated approval links: ${docRes.data.title}`,
      meta: { approval_id: approvalId, link_count: links.length },
    })

    return jsonResponse({ success: true, approvalId, title: docRes.data.title, links })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
