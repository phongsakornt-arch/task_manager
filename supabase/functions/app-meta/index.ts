import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  return jsonResponse({
    success: true,
    app: 'YEC Task Manager',
    env: Deno.env.get('APP_ENV') || 'production',
    timezone: 'Asia/Bangkok',
    generatedAt: new Date().toISOString(),
    externalProviders: {
      email: Deno.env.get('RESEND_API_KEY') ? 'configured' : 'not_configured',
      calendar: Deno.env.get('GOOGLE_CALENDAR_ID') && Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ? 'configured' : 'not_configured',
      publicSite: Deno.env.get('PUBLIC_SITE_URL') || null,
    },
  })
})
