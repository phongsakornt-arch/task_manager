import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3'

export type AppUser = {
  id: string
  email: string
  name: string
  role: 'super_admin' | 'admin' | 'editor' | 'member'
  active: boolean
}

export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing Supabase service configuration')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function requireEditor(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('Missing authorization token')

  const supabase = serviceClient()
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) throw new Error('Invalid authorization token')

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, email, name, role, active')
    .eq('id', authData.user.id)
    .single()

  if (profileError || !profile) throw new Error('User profile not found')
  const user = profile as AppUser
  if (!user.active) throw new Error('User is inactive')
  if (!['editor', 'admin', 'super_admin'].includes(user.role)) throw new Error('Forbidden')

  return { supabase, user }
}
