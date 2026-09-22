import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

const BACKUP_TABLES = [
  'committees',
  'members',
  'users',
  'sections',
  'task_types',
  'tasks',
  'task_members',
  'approval_documents',
  'approval_approvers',
  'approval_versions',
  'approval_logs',
  'budget_categories',
  'budget_projects',
  'budget_plans',
  'budget_transactions',
  'todo_items',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { supabase, user } = await requireEditor(req)
    if (!['admin', 'super_admin'].includes(user.role)) return jsonResponse({ error: 'Forbidden' }, 403)

    const snapshot: Record<string, unknown[]> = {}
    for (const table of BACKUP_TABLES) {
      const { data, error } = await supabase.from(table).select('*').limit(1000)
      if (error) return jsonResponse({ error: `Backup failed at ${table}: ${error.message}` }, 400)
      snapshot[table] = data ?? []
    }

    const createdAt = new Date().toISOString()
    const manifest = {
      createdAt,
      createdBy: user.email,
      tableCount: BACKUP_TABLES.length,
      rowCounts: Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, rows.length])),
    }

    await supabase.from('activity_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action: 'backup.snapshot.preview',
      detail: 'Backup snapshot generated in response',
      meta: manifest,
    })

    return jsonResponse({ success: true, status: 'generated_in_response_not_stored', manifest, snapshot })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
