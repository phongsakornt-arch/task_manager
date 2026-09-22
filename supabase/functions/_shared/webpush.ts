// Web Push encryption (RFC 8291 aes128gcm) + VAPID (RFC 8292) implemented
// directly on Deno's native Web Crypto API. We tried npm:web-push first, but
// under Deno's npm compat layer it corrupted any non-ASCII (Thai) payload
// text while leaving ASCII intact — a classic buffer/encoding mismatch deep
// inside that library's Node-specific code. Native Web Crypto sidesteps the
// whole compat layer, so there's nothing to be uncertain about.

function base64UrlToBytes(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) { result.set(a, offset); offset += a.length }
  return result
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data)
  return new Uint8Array(sig)
}

// HKDF-expand for a single block (<=32 bytes output) — sufficient for the
// fixed-length keys/nonces this scheme derives (16, 12, 32 bytes).
async function hkdfExpandOneBlock(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const t = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])))
  return t.slice(0, length)
}

async function importVapidSigningKey(privateKeyB64: string, publicKeyB64: string): Promise<CryptoKey> {
  const pub = base64UrlToBytes(publicKeyB64) // 65 bytes, uncompressed point (0x04 || x || y)
  const d = base64UrlToBytes(privateKeyB64) // 32 bytes
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: bytesToBase64Url(pub.slice(1, 33)),
    y: bytesToBase64Url(pub.slice(33, 65)),
    d: bytesToBase64Url(d),
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

async function buildVapidAuthHeader(endpoint: string, subject: string, publicKeyB64: string, privateKeyB64: string): Promise<string> {
  const url = new URL(endpoint)
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = { aud: `${url.protocol}//${url.host}`, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }
  const encHeader = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)))
  const encPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${encHeader}.${encPayload}`

  const signingKey = await importVapidSigningKey(privateKeyB64, publicKeyB64)
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(signingInput))
  const jwt = `${signingInput}.${bytesToBase64Url(new Uint8Array(sigBuf))}`

  return `vapid t=${jwt}, k=${publicKeyB64}`
}

export class WebPushError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
  }
}

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  vapid: { publicKey: string; privateKey: string; subject: string },
  payload: string,
): Promise<void> {
  const payloadBytes = new TextEncoder().encode(payload)
  const subscriberPublicKeyBytes = base64UrlToBytes(subscription.p256dh)
  const authSecret = base64UrlToBytes(subscription.auth)

  const localKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const localPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey))

  const subscriberPublicKey = await crypto.subtle.importKey('raw', subscriberPublicKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: subscriberPublicKey } as EcdhKeyDeriveParams, localKeyPair.privateKey, 256),
  )

  // RFC 8291 §3.4 — derive the "input keying material" from the ECDH shared
  // secret, bound to both parties' public keys via the auth secret.
  const prk = await hmacSha256(authSecret, sharedSecret)
  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info\0'), subscriberPublicKeyBytes, localPublicKeyBytes)
  const ikm = await hkdfExpandOneBlock(prk, keyInfo, 32)

  // RFC 8188 §2.1 — derive the content-encryption key and nonce for this record.
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const prk2 = await hmacSha256(salt, ikm)
  const cekBytes = await hkdfExpandOneBlock(prk2, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfExpandOneBlock(prk2, new TextEncoder().encode('Content-Encoding: nonce\0'), 12)

  const cek = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const plaintext = concatBytes(payloadBytes, new Uint8Array([2])) // 0x02 = end-of-record delimiter, no padding
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cek, plaintext))

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, 4096, false)
  const header = concatBytes(salt, recordSize, new Uint8Array([localPublicKeyBytes.length]), localPublicKeyBytes)
  const body = concatBytes(header, ciphertext)

  const authorization = await buildVapidAuthHeader(subscription.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey)

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Authorization: authorization,
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new WebPushError(`Push service responded ${res.status}: ${text}`, res.status)
  }
}
