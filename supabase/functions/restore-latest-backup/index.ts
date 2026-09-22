import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    if (!['admin', 'super_admin'].includes(user.role)) return jsonResponse({ error: 'Forbidden' }, 403)

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: 'backup.restore.requested',
      detail: 'Restore latest backup requested but restore execution is not enabled',
      meta: { status: 'restore_not_enabled' },
    })

    return jsonResponse({
      success: false,
      status: 'restore_not_enabled',
      message: 'Restore is intentionally disabled until durable snapshot storage and operator confirmation are implemented.',
    }, 409)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
