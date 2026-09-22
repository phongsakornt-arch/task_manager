import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

const TABLES = [
  'committees',
  'members',
  'users',
  'sections',
  'task_types',
  'tasks',
  'task_members',
  'approval_documents',
  'approval_approvers',
  'budget_projects',
  'budget_transactions',
  'todo_items',
  'activity_log',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    if (!['admin', 'super_admin'].includes(user.role)) return jsonResponse({ error: 'Forbidden' }, 403)

    const tables = await Promise.all(TABLES.map(async (table) => {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
      return { table, ok: !error, count: count ?? 0, error: error?.message ?? null }
    }))

    const config = {
      resend: Boolean(Deno.env.get('RESEND_API_KEY')),
      taskEmailFrom: Boolean(Deno.env.get('TASK_EMAIL_FROM')),
      googleCalendarId: Boolean(Deno.env.get('GOOGLE_CALENDAR_ID')),
      googleServiceAccount: Boolean(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')),
      publicSiteUrl: Boolean(Deno.env.get('PUBLIC_SITE_URL')),
    }

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: 'system.health.checked',
      detail: 'System health check executed',
      meta: { config },
    })

    return jsonResponse({
      success: true,
      checkedAt: new Date().toISOString(),
      config,
      tables,
      readyForExternalProviders: config.resend && config.googleCalendarId && config.googleServiceAccount,
    })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
