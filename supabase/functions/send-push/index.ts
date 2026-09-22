import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireUser, serviceClient } from '../_shared/auth.ts'
import { sendWebPush, WebPushError } from '../_shared/webpush.ts'

// เรียกได้จาก edge function อื่น (service role, ข้าม auth check เพราะไม่มี Authorization header)
// หรือจาก frontend ของผู้ใช้ที่ login แล้ว (เช่น แจ้งเตือนตอนมอบหมายงาน)
// body: { userIds: string[], title: string, body: string, url?: string, tag?: string }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const isServiceRole = !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`
    if (!isServiceRole) await requireUser(req)

    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
    if (!publicKey || !privateKey) return jsonResponse({ error: 'Missing VAPID configuration' }, 500)

    const { userIds, title, body, url, tag } = await req.json()
    if (!Array.isArray(userIds) || userIds.length === 0 || !title) {
      return jsonResponse({ error: 'Missing userIds or title' }, 400)
    }

    const supabase = serviceClient()
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)
    if (error) return jsonResponse({ error: error.message }, 400)

    const payload = JSON.stringify({ title, body: body ?? '', url: url ?? '/', tag })
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
