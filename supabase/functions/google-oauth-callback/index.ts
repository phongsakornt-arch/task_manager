import { corsHeaders } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

function redirectToSystem(siteUrl: string, status: 'connected' | 'error', message?: string) {
  const url = new URL('/system', siteUrl)
  url.searchParams.set('google_calendar', status)
  if (message) url.searchParams.set('message', message)
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url.toString() } })
}

// Google redirect ตรงมาที่นี่หลังผู้ใช้กด "อนุญาต" ในหน้ายินยอม — ไม่มี
// Authorization header ของแอปเรา (เป็น GET จากเบราว์เซอร์ของผู้ใช้ที่ล็อกอิน Google
// ไม่ใช่ล็อกอินระบบเรา) ตรวจสิทธิ์ผ่าน state (CSRF nonce) ที่ฝากไว้ตอน start แทน
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const siteUrl = Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:5173'
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) return redirectToSystem(siteUrl, 'error', oauthError)
  if (!code || !state) return redirectToSystem(siteUrl, 'error', 'missing_code_or_state')

  try {
    const supabase = serviceClient()
    const { data: pending, error: pendingError } = await supabase
      .from('google_calendar_auth')
      .select('pending_state')
      .eq('id', 1)
      .maybeSingle()
    if (pendingError || !pending?.pending_state || pending.pending_state !== state) {
      return redirectToSystem(siteUrl, 'error', 'invalid_state')
    }

    const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
    const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!clientId || !clientSecret || !supabaseUrl) return redirectToSystem(siteUrl, 'error', 'missing_oauth_config')

    const redirectUri = `${supabaseUrl}/functions/v1/google-oauth-callback`
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    })
    const tokenBody = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !tokenBody.refresh_token) {
      // ไม่มี refresh_token มักแปลว่าผู้ใช้เคยกดยินยอมมาก่อนแล้วไม่ได้ prompt=consent ซ้ำ —
      // ผู้ใช้ต้องไปที่ myaccount.google.com/permissions เพิกถอนสิทธิ์แอปนี้ก่อนแล้วลองใหม่
      return redirectToSystem(siteUrl, 'error', tokenBody.error_description || tokenBody.error || 'no_refresh_token')
    }

    let connectedEmail: string | null = null
    try {
      const userinfoRes = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${tokenBody.access_token}` } })
      const userinfo = await userinfoRes.json().catch(() => ({}))
      connectedEmail = userinfo?.email ?? null
    } catch {
      // ไม่ critical — เก็บ token ต่อได้แม้หา email ไม่เจอ
    }

    await supabase.from('google_calendar_auth').upsert({
      id: 1,
      refresh_token: tokenBody.refresh_token,
      connected_email: connectedEmail,
      connected_at: new Date().toISOString(),
      pending_state: null,
    }, { onConflict: 'id' })

    return redirectToSystem(siteUrl, 'connected')
  } catch (error) {
    return redirectToSystem(siteUrl, 'error', error instanceof Error ? error.message : 'unknown_error')
  }
})
