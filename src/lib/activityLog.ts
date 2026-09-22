import { supabase } from './supabase'
import type { User } from '../types'

export async function logActivity(
  user: User | null,
  action: string,
  detail: string,
  meta?: Record<string, unknown>,
) {
  await supabase.from('activity_log').insert({
    actor_id: user?.id ?? null,
    actor_email: user?.email ?? null,
    action,
    detail,
    meta: meta ?? null,
  })
}
