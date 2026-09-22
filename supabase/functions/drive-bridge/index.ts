import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireEditor } from '../_shared/auth.ts'

type BridgeFile = {
  name: string
  mimeType: string
  dataUrl: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const { user } = await requireEditor(req)
    const bridgeUrl = Deno.env.get('DRIVE_BRIDGE_URL')
    const bridgeSecret = Deno.env.get('DRIVE_BRIDGE_SECRET')
    if (!bridgeUrl || !bridgeSecret) {
      return jsonResponse({ error: 'Drive bridge is not configured', status: 'missing_drive_bridge_config' }, 503)
    }

    const body = await req.json()
    const action = String(body.action || '')
    if (!['createTaskFolder', 'uploadTaskFiles'].includes(action)) {
      return jsonResponse({ error: 'Unsupported drive action' }, 400)
    }

    const payload = {
      secret: bridgeSecret,
      action,
      actorEmail: user.email,
      taskId: body.taskId,
      title: body.title,
      driveFolderUrl: body.driveFolderUrl,
      files: Array.isArray(body.files) ? body.files as BridgeFile[] : [],
    }

    const response = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text)
    } catch {
      data = { success: false, error: text || 'Invalid Drive bridge response' }
    }

    if (!response.ok || data.success === false) {
      return jsonResponse({ ...data, status: 'drive_bridge_failed' }, response.ok ? 400 : response.status)
    }

    return jsonResponse({ success: true, ...data })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400)
  }
})
