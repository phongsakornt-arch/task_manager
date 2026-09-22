import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTaskStore } from '../stores/taskStore'
import { useAuthStore } from '../stores/authStore'
import { canEditTasks } from '../lib/permissions'
import { logActivity } from '../lib/activityLog'
import type { Task, Section, TaskType } from '../types'

export function useTasks() {
  const { tasks, sections, taskTypes, setTasks, setSections, setTaskTypes, updateTask } = useTaskStore()
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    // Standard fetch-on-mount pattern: reset stale error before kicking off the load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null)
    Promise.all([
      supabase.from('tasks').select('*, sections(*), task_types(*), task_members(*, members(*), committees(*)), task_staff(*, users(*, members(id, name_th, nickname, email, position_committee, province)))').eq('deleted', false).order('created_at', { ascending: false }),
      supabase.from('sections').select('*').eq('active', true).order('sort_order'),
      supabase.from('task_types').select('*'),
    ]).then(([tasksRes, sectionsRes, typesRes]) => {
      if (tasksRes.error) {
        console.error('[useTasks] tasks query error:', tasksRes.error)
        setLoadError(tasksRes.error.message)
      }
      if (tasksRes.data) setTasks(tasksRes.data as Task[])
      if (sectionsRes.data) setSections(sectionsRes.data as Section[])
      if (typesRes.data) setTaskTypes(typesRes.data as TaskType[])
      setLoading(false)
    }).catch(err => {
      console.error('[useTasks] unexpected error:', err)
      setLoadError(String(err?.message ?? err))
      setLoading(false)
    })
  }, [setTasks, setSections, setTaskTypes])

  const completeTask = async (taskId: string, completed: boolean) => {
    if (!canEditTasks(user?.role)) return
    const task = tasks.find(item => item.id === taskId)
    updateTask(taskId, { completed, completed_at: completed ? new Date().toISOString() : undefined, _optimistic: true })
    const { error } = await supabase.from('tasks').update({
      completed,
      completed_at: completed ? new Date().toISOString() : null
    }).eq('id', taskId)
    if (error) updateTask(taskId, { completed: !completed, _optimistic: false })
    else {
      updateTask(taskId, { _optimistic: false })
      void supabase.functions.invoke('sync-task-calendar', { body: { taskId } }).catch(() => undefined)
      await logActivity(
        user,
        completed ? 'task.completed' : 'task.reopened',
        `${completed ? 'Completed' : 'Reopened'} task: ${task?.title ?? taskId}`,
        { task_id: taskId, completed },
      )
    }
  }

  const deleteTask = async (taskId: string) => {
    if (!canEditTasks(user?.role)) return
    const task = tasks.find(item => item.id === taskId)
    updateTask(taskId, { deleted: true, _optimistic: true })
    const { error } = await supabase.from('tasks').update({
      deleted: true,
      deleted_at: new Date().toISOString()
    }).eq('id', taskId)
    if (error) updateTask(taskId, { deleted: false, _optimistic: false })
    else {
      void supabase.functions.invoke('sync-task-calendar', { body: { taskId } }).catch(() => undefined)
      await logActivity(user, 'task.deleted', `Deleted task: ${task?.title ?? taskId}`, { task_id: taskId })
    }
  }

  return { tasks, sections, taskTypes, loading, loadError, completeTask, deleteTask }
}
