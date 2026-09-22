import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    if (user.role !== 'super_admin') return jsonResponse({ error: 'Forbidden' }, 403)

    const { userId, password } = await req.json()
    if (!userId || typeof userId !== 'string') return jsonResponse({ error: 'userId is required' }, 400)
    if (!password || typeof password !== 'string') return jsonResponse({ error: 'password is required' }, 400)
    if (password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400)

    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id, email, name, active')
      .eq('id', userId)
      .single()

    if (targetError || !target) return jsonResponse({ error: 'User profile not found' }, 404)

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    })

    if (updateError) return jsonResponse({ error: updateError.message }, 400)

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: 'user.password.set',
      detail: `Password updated for ${target.email}`,
      meta: { user_id: userId, target_email: target.email },
    })

    return jsonResponse({
      success: true,
      userId,
      email: target.email,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})
