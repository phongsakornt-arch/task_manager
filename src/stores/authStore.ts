import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { User } from '../types'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  setSession: (session: Session | null) => void
  fetchUser: () => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,

  setSession: (session) => {
    // Only update session + clear user on sign-out.
    // fetchUser() is called explicitly in App.tsx on startup and when session changes.
    if (session) {
      set({ session })
      get().fetchUser()
    } else {
      set({ session: null, user: null, loading: false })
    }
  },

  fetchUser: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { set({ loading: false }); return }

    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single()

    set({ user: data, session, loading: false })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null })
  },
}))
