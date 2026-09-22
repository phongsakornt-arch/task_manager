import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    if (!['admin', 'super_admin'].includes(user.role)) return jsonResponse({ error: 'Forbidden' }, 403)

    const body = await req.json().catch(() => ({}))
    const limit = Math.min(Number(body.limit ?? 20), 100)
    const { data, error } = await supabase
      .from('activity_log')
      .select('id, actor_email, detail, meta, created_at')
      .eq('action', 'backup.snapshot.preview')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return jsonResponse({ error: error.message }, 400)

    return jsonResponse({
      success: true,
      status: 'activity_log_manifest_only',
      backups: (data ?? []).map((item) => ({
        id: item.id,
        createdAt: item.created_at,
        createdBy: item.actor_email,
        detail: item.detail,
        manifest: item.meta,
      })),
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
