import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useTaskStore } from '../stores/taskStore'
import type { Task } from '../types'

export function useRealtimeTasks() {
  const { setTasks } = useTaskStore()

  useEffect(() => {
    const channel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async (payload) => {

        if (payload.eventType === 'INSERT') {
          const incoming = payload.new as Task
          // Deduplicate: skip if already added optimistically by TaskModal
          setTasks(prev => {
            if (prev.some(t => t.id === incoming.id)) return prev
            return [incoming, ...prev]
          })
          // Re-fetch with joins outside state updater (no side effects inside setState)
          supabase
            .from('tasks')
            .select('*, sections(*), task_types(*), task_members(*, members(*), committees(*)), task_staff(*, users(*, members(id, name_th, nickname, email, position_committee, province)))')
            .eq('id', incoming.id)
            .single()
            .then(({ data }) => {
              if (data) setTasks(p => p.map(t => t.id === (data as Task).id ? data as Task : t))
            })
        }

        if (payload.eventType === 'UPDATE') {
          const incoming = payload.new as Task
          setTasks(prev => prev.map(t => {
            if (t.id !== incoming.id) return t
            // Skip if our optimistic write is newer
            if (t._optimistic && incoming.updated_at <= (t.updated_at ?? '')) return t
            // Merge: keep existing joins since realtime payload has no joins
            return {
              ...t,
              ...incoming,
              sections: t.sections,
              task_types: t.task_types,
              task_members: t.task_members,
              task_staff: t.task_staff,
            }
          }))
          // Re-fetch with joins in background to get fresh related data
          supabase
            .from('tasks')
            .select('*, sections(*), task_types(*), task_members(*, members(*), committees(*)), task_staff(*, users(*, members(id, name_th, nickname, email, position_committee, province)))')
            .eq('id', incoming.id)
            .single()
            .then(({ data }) => {
              if (data) setTasks(p => p.map(t => t.id === data.id && !t._optimistic ? data as Task : t))
            })
        }

        if (payload.eventType === 'DELETE') {
          setTasks(prev => prev.filter(t => t.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [setTasks])
}
