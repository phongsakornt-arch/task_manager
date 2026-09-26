import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser, serviceClient } from '../_shared/auth.ts'
import { sendWebPush, WebPushError } from '../_shared/webpush.ts'

// เรียกได้จาก edge function อื่น (service role, ข้าม auth check เพราะไม่มี Authorization header)
// หรือจาก frontend ของผู้ใช้ที่ login แล้ว (เช่น แจ้งเตือนตอนมอบหมายงาน)
// body: { userIds?: string[], toRole?: 'super_admin', title: string, body: string, url?: string, tag?: string }
// toRole resolves recipients here with the service client: the users table's RLS
// only lets non-admins read their own row, so a browser-side lookup of
// "all super_admins" silently returns nothing for editors/members.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const isServiceRole = !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`
    const caller = isServiceRole ? null : (await requireUser(req)).user

    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
    if (!publicKey || !privateKey) return jsonResponse({ error: 'Missing VAPID configuration' }, 500)

    const { userIds: rawUserIds, toRole, title, body, url, tag } = await req.json()
    if (!title) return jsonResponse({ error: 'Missing title' }, 400)

    // Only in-app paths — a notification tap must never open an external site.
    const safeUrl = typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/'

    const supabase = serviceClient()
    let userIds: string[] = Array.isArray(rawUserIds) ? rawUserIds : []
    if (toRole === 'super_admin') {
      const { data: admins, error: adminError } = await supabase
        .from('users').select('id').eq('role', 'super_admin').eq('active', true)
      if (adminError) return jsonResponse({ error: adminError.message }, 400)
      userIds = (admins ?? []).map((a) => a.id).filter((id) => id !== caller?.id)
    }
    if (userIds.length === 0) return jsonResponse({ success: true, sent: 0, total: 0, removedStale: 0 })

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)
    if (error) return jsonResponse({ error: error.message }, 400)

    const payload = JSON.stringify({ title, body: body ?? '', url: safeUrl, tag })
    let sent = 0
    const staleIds: string[] = []

    await Promise.all((subs ?? []).map(async (sub) => {
      try {
        await sendWebPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          { publicKey, privateKey, subject },
          payload,
        )
        sent++
      } catch (err) {
        // 404/410 = subscription หมดอายุ/ถูกเพิกถอนแล้ว — ลบทิ้งกันฐานข้อมูลรก
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          staleIds.push(sub.id)
        }
      }
    }))

    if (staleIds.length) {
      await supabase.from('push_subscriptions').delete().in('id', staleIds)
    }

    return jsonResponse({ success: true, sent, total: subs?.length ?? 0, removedStale: staleIds.length })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
