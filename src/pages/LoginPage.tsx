import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

type LoginMode = 'password' | 'magic'

function authErrorMessage(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) {
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือยังไม่ได้ตั้งรหัสผ่านในหน้า Users'
  }
  if (normalized.includes('email not confirmed')) {
    return 'อีเมลนี้ยังไม่ได้ยืนยันตัวตน ลองใช้ Magic Link ก่อน'
  }
  return message
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { setSession, fetchUser } = useAuthStore()
  const [mode, setMode] = useState<LoginMode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const normalizedEmail = email.trim().toLowerCase()

  const handlePasswordLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    setLoading(false)
    if (signInError) {
      setError(authErrorMessage(signInError.message))
      return
    }

    setSession(data.session)
    await fetchUser()
    navigate('/', { replace: true })
  }

  const handleMagicLink = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    setLoading(false)
    if (signInError) setError(authErrorMessage(signInError.message))
    else setSent(true)
  }

  const switchMode = (nextMode: LoginMode) => {
    setMode(nextMode)
    setError('')
    setSent(false)
  }

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: '#eef0f7',
      fontFamily: 'Anuphan, sans-serif',
      color: '#172033',
    }}>
      <section style={{
        width: '100%',
        maxWidth: 440,
        borderRadius: 24,
        background: '#ffffff',
        border: '1px solid rgba(226,232,240,0.9)',
        boxShadow: '0 28px 80px rgba(26,39,68,0.16), 0 8px 24px rgba(15,23,42,0.06)',
        overflow: 'hidden',
      }}>
        <div style={{ height: 6, background: 'linear-gradient(90deg, #1a2744, #314675, #c9a84c)' }} />

        <div style={{ padding: '30px 34px 28px' }}>
          <div style={{
            width: 58,
            height: 58,
            borderRadius: 16,
            background: '#1a2744',
            color: '#c9a84c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Anuphan, sans-serif',
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 22,
          }}>
            Y
          </div>

          <div style={{ fontSize: 12, letterSpacing: 2.6, textTransform: 'uppercase', color: '#b48d31', fontWeight: 700, marginBottom: 7 }}>
            Secure Sign In
          </div>

          <h1 style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 27, lineHeight: 1.22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
            เข้าสู่ระบบ
          </h1>

          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#64748b', marginBottom: 20 }}>
            ใช้รหัสผ่านเพื่อเข้าใช้งานทันที หรือส่ง Magic Link สำรองผ่านอีเมล
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            padding: 5,
            borderRadius: 14,
            background: '#f1f5f9',
            marginBottom: 20,
          }}>
            {[
              ['password', 'Password'],
              ['magic', 'Magic Link'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value as LoginMode)}
                style={{
                  height: 38,
                  border: 'none',
                  borderRadius: 10,
                  background: mode === value ? '#1a2744' : 'transparent',
                  color: mode === value ? '#fff' : '#64748b',
                  fontFamily: 'Anuphan, sans-serif',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {sent ? (
            <div>
              <div style={{ borderRadius: 16, background: '#ecfdf5', border: '1px solid #bbf7d0', padding: 16, marginBottom: 16 }}>
                <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 16, fontWeight: 600, color: '#047857', marginBottom: 4 }}>
                  ส่งลิงก์แล้ว
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#065f46' }}>
                  ตรวจสอบอีเมลที่ <strong>{email}</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => switchMode('password')}
                style={{ width: '100%', height: 44, borderRadius: 12, border: '1px solid #dbe3ef', background: '#fff', color: '#1a2744', fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                กลับไปเข้าด้วยรหัสผ่าน
              </button>
            </div>
          ) : (
            <form onSubmit={mode === 'password' ? handlePasswordLogin : handleMagicLink}>
              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ display: 'block', fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="name@thaichamber.org"
                  required
                  autoComplete="email"
                  style={{
                    width: '100%',
                    height: 46,
                    borderRadius: 12,
                    border: '1.5px solid #dbe3ef',
                    background: '#f8fafc',
                    color: '#0f172a',
                    outline: 'none',
                    padding: '0 14px',
                    fontSize: 14.5,
                    fontFamily: 'Anuphan, sans-serif',
                  }}
                  onFocus={event => {
                    event.currentTarget.style.borderColor = '#1a2744'
                    event.currentTarget.style.background = '#fff'
                    event.currentTarget.style.boxShadow = '0 0 0 4px rgba(26,39,68,0.08)'
                  }}
                  onBlur={event => {
                    event.currentTarget.style.borderColor = '#dbe3ef'
                    event.currentTarget.style.background = '#f8fafc'
                    event.currentTarget.style.boxShadow = 'none'
                  }}
                />
              </label>

              {mode === 'password' && (
                <label style={{ display: 'block', marginBottom: 14 }}>
                  <span style={{ display: 'block', fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                    Password
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    placeholder="รหัสผ่าน"
                    required
                    autoComplete="current-password"
                    style={{
                      width: '100%',
                      height: 46,
                      borderRadius: 12,
                      border: '1.5px solid #dbe3ef',
                      background: '#f8fafc',
                      color: '#0f172a',
                      outline: 'none',
                      padding: '0 14px',
                      fontSize: 14.5,
                      fontFamily: 'Anuphan, sans-serif',
                    }}
                    onFocus={event => {
                      event.currentTarget.style.borderColor = '#1a2744'
                      event.currentTarget.style.background = '#fff'
                      event.currentTarget.style.boxShadow = '0 0 0 4px rgba(26,39,68,0.08)'
                    }}
                    onBlur={event => {
                      event.currentTarget.style.borderColor = '#dbe3ef'
                      event.currentTarget.style.background = '#f8fafc'
                      event.currentTarget.style.boxShadow = 'none'
                    }}
                  />
                </label>
              )}

              {error && (
                <div style={{ borderRadius: 12, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 13, lineHeight: 1.6, padding: '10px 12px', marginBottom: 14 }}>
                  {error}
                  {mode === 'password' && (
                    <button
                      type="button"
                      onClick={() => switchMode('magic')}
                      style={{ display: 'block', marginTop: 7, border: 'none', background: 'transparent', color: '#1d4ed8', cursor: 'pointer', padding: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600 }}
                    >
                      ใช้ Magic Link เพื่อเข้าไปตั้งรหัสผ่านใหม่
                    </button>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  height: 46,
                  borderRadius: 12,
                  border: 'none',
                  background: loading ? '#64748b' : '#1a2744',
                  color: '#fff',
                  fontFamily: 'Anuphan, sans-serif',
                  fontSize: 14.5,
                  fontWeight: 600,
                  cursor: loading ? 'default' : 'pointer',
                  boxShadow: loading ? 'none' : '0 12px 24px rgba(26,39,68,0.24)',
                  marginBottom: 14,
                }}
              >
                {loading ? 'กำลังเข้าสู่ระบบ...' : mode === 'password' ? 'เข้าสู่ระบบ' : 'ส่ง Magic Link'}
              </button>

              <div style={{ borderRadius: 14, background: '#f8fafc', border: '1px solid #eef2f7', color: '#64748b', fontSize: 12.5, lineHeight: 1.65, padding: '11px 13px', textAlign: 'center' }}>
                {mode === 'password'
                  ? 'เร็วที่สุด: ตรวจรหัสผ่านแล้วเข้าใช้งานในหน้านี้ทันที'
                  : 'Magic Link ต้องรออีเมลและเปิดลิงก์ยืนยันตัวตน'}
              </div>
            </form>
          )}
        </div>

        <div style={{ borderTop: '1px solid #eef2f7', background: '#fbfcfe', color: '#94a3b8', textAlign: 'center', fontSize: 12, padding: '12px 16px' }}>
          YEC Task Manager · Supabase Auth
        </div>
      </section>
    </main>
  )
}
