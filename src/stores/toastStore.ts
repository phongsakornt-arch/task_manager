import { create } from 'zustand'

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ToastState {
  toasts: Toast[]
  push: (kind: ToastKind, text: string) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (kind, text) => {
    const id = nextId++
    // keep at most 3 on screen so a burst of actions can't bury the page
    set({ toasts: [...get().toasts.slice(-2), { id, kind, text }] })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6500 : 3200)
  },

  dismiss: (id) => set({ toasts: get().toasts.filter(t => t.id !== id) }),
}))

export const toast = {
  success: (text: string) => useToastStore.getState().push('success', text),
  error: (text: string) => useToastStore.getState().push('error', text),
}
