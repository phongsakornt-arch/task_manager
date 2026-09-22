self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', event => {
  if (!event.data) return
  // event.data.json()/.text() do their own UTF-8 decoding internally, and on
  // iOS Safari that path mangles any non-ASCII (Thai) text while leaving
  // ASCII intact. Decoding the raw bytes ourselves with TextDecoder — a
  // separate, much more widely used API — avoids whatever bug that is.
  let payload = {}
  try {
    const text = new TextDecoder('utf-8').decode(event.data.arrayBuffer())
    payload = JSON.parse(text)
  } catch {
    payload = { title: 'YEC Task Manager', body: '' }
  }

  const title = payload.title || 'YEC Task Manager'
  const options = {
    body: payload.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: payload.url || '/' },
    tag: payload.tag,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})
