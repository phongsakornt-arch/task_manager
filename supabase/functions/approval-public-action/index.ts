import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'

type ApproverStatus = 'approved' | 'revision_requested'

function computeDocStatus(approvers: { status: string }[]) {
  if (approvers.some((item) => item.status === 'revision_requested')) return 'revision_requested'
  if (approvers.length > 0 && approvers.every((item) => item.status === 'approved')) return 'approved'
  return 'pending'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabase = serviceClient()
    const { approvalId, approverId, token, action, note } = await req.json()
    if (!approvalId || !approverId || !token) return jsonResponse({ error: 'Missing approval token data' }, 400)
    if (!['approved', 'revision_requested'].includes(action)) return jsonResponse({ error: 'Invalid action' }, 400)

    const { data: doc, error: docError } = await supabase
      .from('approval_documents')
      .select('id, title, status, deleted')
      .eq('id', approvalId)
      .single()
    if (docError || !doc || doc.deleted) return jsonResponse({ error: 'Approval not found' }, 404)
    if (['approved', 'cancelled'].includes(doc.status)) return jsonResponse({ error: 'Approval is closed' }, 409)

    const { data: approver, error: approverError } = await supabase
      .from('approval_approvers')
      .select('*')
      .eq('id', approverId)
      .eq('approval_id', approvalId)
      .eq('token', token)
      .single()
    if (approverError || !approver) return jsonResponse({ error: 'Invalid approval token' }, 401)
    if (approver.status !== 'waiting') return jsonResponse({ error: 'Approver already acted' }, 409)

    const { data: chain, error: chainError } = await supabase
      .from('approval_approvers')
      .select('id, order_no, status')
      .eq('approval_id', approvalId)
      .order('order_no')
    if (chainError || !chain) return jsonResponse({ error: chainError?.message || 'Chain not found' }, 400)

    const firstWaiting = chain.find((item) => item.status === 'waiting')
    if (firstWaiting?.id !== approverId) return jsonResponse({ error: 'Not current approver' }, 409)

    const nextStatus = action as ApproverStatus
    const actedAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('approval_approvers')
      .update({ status: nextStatus, note: String(note || '').trim() || null, acted_at: actedAt })
      .eq('id', approverId)
    if (updateError) return jsonResponse({ error: updateError.message }, 400)

    const updatedChain = chain.map((item) => item.id === approverId ? { ...item, status: nextStatus } : item)
    const docStatus = computeDocStatus(updatedChain)
    await supabase.from('approval_documents').update({ status: docStatus }).eq('id', approvalId)
    await supabase.from('approval_logs').insert({
      approval_id: approvalId,
      approver_id: approverId,
      action: nextStatus,
      detail: nextStatus === 'approved' ? 'Public approver approved' : 'Public approver requested revision',
      actor_email: approver.approver_email,
      meta: { public_action: true, note: String(note || '').trim() || null },
    })

    return jsonResponse({ success: true, approvalId, approverId, action: nextStatus, documentStatus: docStatus })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
