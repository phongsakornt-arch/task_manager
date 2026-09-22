import { create } from 'zustand'
import type { Task, Section, TaskType } from '../types'

interface TaskState {
  tasks: Task[]
  sections: Section[]
  taskTypes: TaskType[]
  setTasks: (fn: Task[] | ((prev: Task[]) => Task[])) => void
  setSections: (sections: Section[]) => void
  setTaskTypes: (types: TaskType[]) => void
  updateTask: (id: string, data: Partial<Task>) => void
  removeTask: (id: string) => void
  addTask: (task: Task) => void
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  sections: [],
  taskTypes: [],

  setTasks: (fn) => set((state) => ({
    tasks: typeof fn === 'function' ? fn(state.tasks) : fn
  })),

  setSections: (sections) => set({ sections }),
  setTaskTypes: (taskTypes) => set({ taskTypes }),

  updateTask: (id, data) => set((state) => ({
    tasks: state.tasks.map(t => t.id === id ? { ...t, ...data } : t)
  })),

  removeTask: (id) => set((state) => ({
    tasks: state.tasks.filter(t => t.id !== id)
  })),

  addTask: (task) => set((state) => ({
    tasks: [task, ...state.tasks]
  })),
}))
