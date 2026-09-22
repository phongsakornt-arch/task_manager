import { serviceClient } from './auth.ts'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// mint ใหม่ทุกครั้ง (access_token อายุ ~1 ชม. แค่นี้เรียกไม่บ่อยพอไม่ต้อง cache)
export async function getGoogleAccessToken(): Promise<string> {
  const supabase = serviceClient()
  const { data, error } = await supabase.from('google_calendar_auth').select('refresh_token').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.refresh_token) throw new Error('ยังไม่ได้เชื่อมต่อ Google Calendar — ไปที่หน้า System เพื่อเชื่อมต่อ')

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID/SECRET configuration')

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: data.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || 'Google token refresh failed')
  }
  return body.access_token as string
}

export async function isGoogleCalendarConnected(): Promise<{ connected: boolean; connectedEmail: string | null }> {
  const supabase = serviceClient()
  const { data } = await supabase.from('google_calendar_auth').select('refresh_token, connected_email').eq('id', 1).maybeSingle()
  return { connected: !!data?.refresh_token, connectedEmail: data?.connected_email ?? null }
}
