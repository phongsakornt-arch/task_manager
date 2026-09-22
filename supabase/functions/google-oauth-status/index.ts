import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'
import { isGoogleCalendarConnected } from '../_shared/googleOAuth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    await requireUser(req)
    const status = await isGoogleCalendarConnected()
    return jsonResponse({ success: true, ...status })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
