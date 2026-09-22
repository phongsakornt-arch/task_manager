import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabase = serviceClient()
    const { approvalId, approverId, token } = await req.json()
    if (!approvalId || !approverId || !token) return jsonResponse({ error: 'Missing approval token data' }, 400)

    const { data: approver, error: approverError } = await supabase
      .from('approval_approvers')
      .select('id, approval_id, order_no, approver_name, approver_email, token, status, acted_at, note')
      .eq('id', approverId)
      .eq('approval_id', approvalId)
      .eq('token', token)
      .single()
    if (approverError || !approver) return jsonResponse({ error: 'Invalid approval token' }, 401)

    const { data: doc, error: docError } = await supabase
      .from('approval_documents')
      .select('id, title, description, file_url, file_name, version, status, deleted, created_at, updated_at')
      .eq('id', approvalId)
      .single()
    if (docError || !doc || doc.deleted) return jsonResponse({ error: 'Approval not found' }, 404)

    const { data: chain } = await supabase
      .from('approval_approvers')
      .select('id, order_no, approver_name, approver_email, status, acted_at, note')
      .eq('approval_id', approvalId)
      .order('order_no')

    const firstWaiting = (chain ?? []).find((item) => item.status === 'waiting')

    return jsonResponse({
      success: true,
      document: doc,
      approver: {
        id: approver.id,
        name: approver.approver_name,
        email: approver.approver_email,
        status: approver.status,
        actedAt: approver.acted_at,
        note: approver.note,
        isCurrent: firstWaiting?.id === approver.id,
      },
      chain: chain ?? [],
      canAct: doc.status === 'pending' && approver.status === 'waiting' && firstWaiting?.id === approver.id,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
