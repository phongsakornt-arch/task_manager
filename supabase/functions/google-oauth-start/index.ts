import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser, serviceClient } from '../_shared/auth.ts'

// super_admin กดปุ่ม "เชื่อมต่อ Google Calendar" ในหน้า System → เรียกฟังก์ชันนี้
// เพื่อขอ URL หน้ายินยอมของ Google แล้ว redirect เบราว์เซอร์ไปที่นั่น
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { user } = await requireUser(req)
    if (user.role !== 'super_admin') return jsonResponse({ error: 'Forbidden' }, 403)

    const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!clientId || !supabaseUrl) return jsonResponse({ error: 'Missing GOOGLE_OAUTH_CLIENT_ID configuration' }, 500)

    const state = crypto.randomUUID()
    const supabase = serviceClient()
    const { error } = await supabase
      .from('google_calendar_auth')
      .upsert({ id: 1, pending_state: state, connected_by: user.id }, { onConflict: 'id' })
    if (error) return jsonResponse({ error: error.message }, 400)

    const redirectUri = `${supabaseUrl}/functions/v1/google-oauth-callback`
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar email',
      access_type: 'offline',
      prompt: 'consent',
      state,
    })

    return jsonResponse({ success: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
