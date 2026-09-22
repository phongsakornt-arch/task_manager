import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/', { replace: true })
      else navigate('/login?error=link_expired', { replace: true })
    })
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f6fa]">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-[#1a2744] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-500">กำลังเข้าสู่ระบบ...</p>
      </div>
    </div>
  )
}
