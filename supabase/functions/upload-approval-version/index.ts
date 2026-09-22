import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    const { approvalId, fileName, fileUrl, driveFileId, changeNote } = await req.json()
    if (!approvalId) return jsonResponse({ error: 'approvalId is required' }, 400)

    const { data: doc, error: docError } = await supabase
      .from('approval_documents')
      .select('id, title, version, status, deleted')
      .eq('id', approvalId)
      .single()
    if (docError || !doc || doc.deleted) return jsonResponse({ error: 'Approval not found' }, 404)
    if (doc.status !== 'revision_requested' && doc.status !== 'draft') {
      return jsonResponse({ error: 'New version is allowed only for draft or revision_requested documents' }, 409)
    }

    const nextVersion = Number(doc.version || 1) + 1
    const { data: version, error: versionError } = await supabase
      .from('approval_versions')
      .insert({
        approval_id: approvalId,
        version: nextVersion,
        drive_file_id: driveFileId || null,
        file_url: fileUrl || null,
        file_name: fileName || null,
        uploaded_by: user.id,
        change_note: changeNote || null,
      })
      .select('*')
      .single()
    if (versionError) return jsonResponse({ error: versionError.message }, 400)

    await supabase
      .from('approval_documents')
      .update({
        version: nextVersion,
        file_url: fileUrl || null,
        file_name: fileName || null,
        drive_file_id: driveFileId || null,
        status: 'draft',
      })
      .eq('id', approvalId)

    await supabase
      .from('approval_approvers')
      .update({ status: 'waiting', acted_at: null, note: null })
      .eq('approval_id', approvalId)

    await supabase.from('approval_logs').insert({
      approval_id: approvalId,
      action: 'new_version',
      detail: `Uploaded approval version ${nextVersion}`,
      actor_email: user.email,
      meta: { version: nextVersion, file_name: fileName || null, change_note: changeNote || null },
    })

    return jsonResponse({ success: true, approvalId, version })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
