import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

const VALID_ROLES = ['super_admin', 'admin', 'editor', 'member']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    if (user.role !== 'super_admin') return jsonResponse({ error: 'Forbidden' }, 403)

    const { email, name, password, role, memberId } = await req.json()
    if (!email || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
      return jsonResponse({ error: 'กรุณาใส่อีเมลให้ถูกต้อง' }, 400)
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return jsonResponse({ error: 'กรุณาใส่ชื่อ' }, 400)
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return jsonResponse({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' }, 400)
    }
    const finalRole = typeof role === 'string' && VALID_ROLES.includes(role) ? role : 'member'

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name.trim() },
    })

    if (createError || !created.user) {
      return jsonResponse({ error: createError?.message ?? 'สร้างผู้ใช้ไม่สำเร็จ' }, 400)
    }

    // The on_auth_user_created trigger creates the public.users profile with
    // role='member'; patch it with the requested role/member binding.
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .update({ role: finalRole, member_id: memberId || null })
      .eq('id', created.user.id)
      .select('*, members(id, name_th, nickname, email, position_committee, province)')
      .single()

    if (profileError) {
      return jsonResponse({ error: profileError.message }, 400)
    }

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: 'user.created',
      detail: `Created user ${email}`,
      meta: { user_id: created.user.id, email, role: finalRole },
    })

    return jsonResponse({ success: true, user: profile })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})
