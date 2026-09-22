import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activityLog'
import { canViewTodoDashboard } from '../../lib/permissions'
import { useAuthStore } from '../../stores/authStore'
import KanbanBoard from './KanbanBoard'
import type { TodoItem } from '../../types'

type TodoMode = 'mine' | 'kanban' | 'dashboard'
type TodoBucket = 'today' | 'next' | 'free' | 'done'

type TodoOwnerSummary = {
  email: string
  name: string
  total: number
  open: number
  done: number
  today: number
  overdue: number
  todos: TodoItem[]
}

const SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'

const BUCKETS: { key: TodoBucket; title: string; tone: string; soft: string }[] = [
  { key: 'today', title: 'วันนี้ / เกินกำหนด', tone: '#b45309', soft: '#fffbeb' },
  { key: 'next', title: 'กำลังจะถึง', tone: '#1d4ed8', soft: '#eff6ff' },
  { key: 'free', title: 'ไม่มีวันกำหนด', tone: '#64748b', soft: '#f8fafc' },
  { key: 'done', title: 'เสร็จแล้ว', tone: '#047857', soft: '#ecfdf5' },
]

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isToday(date?: string | null) {
  return !!date && date === todayKey()
}

function isOverdue(date?: string | null) {
  return !!date && date < todayKey()
}

function normalizeTimeInput(value: string) {
  const raw = value.trim().replace('.', ':')
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2})(?::?(\d{1,2}))?$/)
  if (!match) return raw
  const hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  if (hour > 23 || minute > 59) return raw
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatDate(date?: string | null) {
  if (!date) return ''
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00`))
}

function formatTime(time?: string | null) {
  if (!time) return ''
  return time.slice(0, 5)
}

function sortOpenTodos(a: TodoItem, b: TodoItem) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  const ad = a.due_date || '9999-99-99'
  const bd = b.due_date || '9999-99-99'
  if (ad !== bd) return ad.localeCompare(bd)
  return Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
}

function sortDoneTodos(a: TodoItem, b: TodoItem) {
  return String(b.completed_at || b.updated_at || b.created_at).localeCompare(String(a.completed_at || a.updated_at || a.created_at))
}

function dueLabel(todo: TodoItem) {
  if (!todo.due_date) return ''
  const date = formatDate(todo.due_date)
  const time = formatTime(todo.due_time)
  return time ? `${date} ${time}` : date
}

function bucketTodos(todos: TodoItem[]) {
  const visible = todos.filter(todo => !todo.deleted)
  const open = visible.filter(todo => todo.status !== 'done').sort(sortOpenTodos)
  const done = visible.filter(todo => todo.status === 'done').sort(sortDoneTodos).slice(0, 20)

  return {
    today: open.filter(todo => todo.pinned || isToday(todo.due_date) || isOverdue(todo.due_date)),
    next: open.filter(todo => !todo.pinned && !!todo.due_date && !isToday(todo.due_date) && !isOverdue(todo.due_date)),
    free: open.filter(todo => !todo.pinned && !todo.due_date),
    done,
  }
}

function buildDashboard(todos: TodoItem[]) {
  const owners = new Map<string, TodoOwnerSummary>()
  const totals = { total: 0, open: 0, done: 0, today: 0, overdue: 0 }

  todos.filter(todo => !todo.deleted).forEach(todo => {
    const email = (todo.owner_email || todo.created_by_email || '').toLowerCase()
    if (!email) return

    const owner = owners.get(email) ?? {
      email,
      name: todo.owner_name || email,
      total: 0,
      open: 0,
      done: 0,
      today: 0,
      overdue: 0,
      todos: [],
    }

    const done = todo.status === 'done'
    owner.total += 1
    totals.total += 1
    if (done) {
      owner.done += 1
      totals.done += 1
    } else {
      owner.open += 1
      totals.open += 1
      if (isToday(todo.due_date)) {
        owner.today += 1
        totals.today += 1
      } else if (isOverdue(todo.due_date)) {
        owner.overdue += 1
        totals.overdue += 1
      }
    }

    owner.todos.push(todo)
    owners.set(email, owner)
  })

  const ownerList = [...owners.values()]
    .map(owner => ({
      ...owner,
      todos: owner.todos
        .sort((a, b) => {
          if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1
          return sortOpenTodos(a, b)
        })
        .slice(0, 12),
    }))
    .sort((a, b) => {
      if (b.open !== a.open) return b.open - a.open
      return a.name.localeCompare(b.name)
    })

  return { totals, owners: ownerList }
}

function TodoDetailModal({ todo, onClose, onSave, onDelete, onSplit }: {
  todo: TodoItem
  onClose: () => void
  onSave: (patch: Partial<TodoItem>) => Promise<void>
  onDelete: (todo: TodoItem) => void
  onSplit: (todo: TodoItem) => void
}) {
  const [title, setTitle] = useState(todo.title)
  const [note, setNote] = useState(todo.note ?? '')
  const [status, setStatus] = useState<TodoItem['status']>(todo.status)
  const [priority, setPriority] = useState(todo.priority)
  const [pinned, setPinned] = useState(todo.pinned)
  const [dueDate, setDueDate] = useState(todo.due_date ?? '')
  const [dueTime, setDueTime] = useState(todo.due_time ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    await onSave({
      title: title.trim(),
      note: note.trim() || null,
      status,
      priority,
      pinned,
      due_date: dueDate || null,
      due_time: dueTime ? normalizeTimeInput(dueTime) : null,
      completed_at: status === 'done' && todo.status !== 'done' ? new Date().toISOString() : undefined,
    })
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1a2744,#2d4a8a)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: 'Anuphan, sans-serif', flex: 1 }}>แก้ไข Todo</div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 30, height: 30, color: '#fff', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>หัวข้อ</label>
            <input value={title} onChange={event => setTitle(event.target.value)} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
          </div>
          <div>
            <label style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>โน้ต</label>
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>สถานะ</label>
              <select value={status} onChange={event => setStatus(event.target.value as TodoItem['status'])} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#fff', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }}>
                <option value="open">เปิด</option>
                <option value="done">เสร็จแล้ว</option>
              </select>
            </div>
            <div>
              <label style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>ความสำคัญ</label>
              <select value={priority} onChange={event => setPriority(event.target.value as 'normal' | 'high')} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#fff', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }}>
                <option value="normal">ปกติ</option>
                <option value="high">สำคัญ</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>วันครบกำหนด</label>
              <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
            </div>
            <div>
              <label style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>เวลา</label>
              <input value={dueTime} onChange={event => setDueTime(event.target.value)} onBlur={event => setDueTime(normalizeTimeInput(event.target.value))} inputMode="numeric" placeholder="09:00" style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#334155', cursor: 'pointer' }}>
            <input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} style={{ accentColor: '#a16207' }} />
            ปักหมุด
          </label>
          <button onClick={() => onSplit(todo)} style={{ justifySelf: 'start', border: 'none', borderRadius: 10, padding: '9px 14px', background: '#faf5ff', color: '#7c3aed', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 13 }}>
            ✨ แบ่งเป็น Subtask ด้วย AI
          </button>
        </div>
        <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button onClick={() => { onDelete(todo); onClose() }} style={{ border: '1.5px solid #fecaca', borderRadius: 10, padding: '9px 14px', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 13 }}>ลบ</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 16px', background: '#fff', color: '#64748b', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 13 }}>ยกเลิก</button>
            <button onClick={save} disabled={saving || !title.trim()} style={{ border: 'none', borderRadius: 10, padding: '9px 18px', background: '#1a2744', color: '#fff', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 800, fontSize: 13 }}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TodoPage() {
  const { user } = useAuthStore()
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [allTodos, setAllTodos] = useState<TodoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<TodoMode>('kanban')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState<'normal' | 'high'>('normal')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')

  // AI Split
  const [splitTodo, setSplitTodo] = useState<TodoItem | null>(null)
  const [splitLoading, setSplitLoading] = useState(false)
  const [splitResult, setSplitResult] = useState<{ title: string; due_date?: string | null; note?: string | null }[]>([])
  const [splitSelected, setSplitSelected] = useState<Set<number>>(new Set())
  const [splitError, setSplitError] = useState<string | null>(null)
  const [splitSaving, setSplitSaving] = useState(false)
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null)

  const showDashboard = canViewTodoDashboard(user?.role)
  const activeMode: TodoMode = mode === 'dashboard' && showDashboard ? 'dashboard' : mode === 'kanban' ? 'kanban' : 'mine'

  useEffect(() => {
    let active = true

    const loadTodos = async () => {
      if (!user || activeMode === 'kanban') {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const query = supabase
        .from('todo_items')
        .select('*')
        .eq('deleted', false)
        .order('pinned', { ascending: false })
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: false })

      const { data, error } = activeMode === 'dashboard'
        ? await query
        : await query.eq('owner_id', user.id)

      if (!active) return

      if (error) {
        setError(error.message)
        if (activeMode === 'dashboard') setAllTodos([])
        else setTodos([])
      } else if (activeMode === 'dashboard') {
        setAllTodos((data ?? []) as TodoItem[])
      } else {
        setTodos((data ?? []) as TodoItem[])
      }

      setLoading(false)
    }

    loadTodos()
    return () => {
      active = false
    }
  }, [activeMode, user])

  const buckets = useMemo(() => bucketTodos(todos), [todos])
  const openCount = useMemo(() => todos.filter(todo => !todo.deleted && todo.status !== 'done').length, [todos])
  const dashboard = useMemo(() => buildDashboard(allTodos), [allTodos])

  const createTodo = async () => {
    if (!user || !title.trim()) return
    setSaving(true)
    setError(null)

    const payload = {
      title: title.trim(),
      note: note.trim() || null,
      owner_id: user.id,
      owner_email: user.email,
      owner_name: user.name,
      created_by: user.id,
      created_by_email: user.email,
      status: 'open',
      priority,
      due_date: dueDate || null,
      due_time: dueTime ? normalizeTimeInput(dueTime) : null,
      pinned: false,
      sort_order: Date.now(),
      deleted: false,
    }

    const { data, error } = await supabase
      .from('todo_items')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      setError(error.message)
    } else if (data) {
      const created = data as TodoItem
      setTodos(prev => [created, ...prev])
      setTitle('')
      setNote('')
      setPriority('normal')
      setDueDate('')
      setDueTime('')
      await logActivity(user, 'todo.created', created.title, { todo_id: created.id })
    }

    setSaving(false)
  }

  const patchTodo = async (todo: TodoItem, patch: Partial<TodoItem>) => {
    if (!user || todo.owner_id !== user.id) return
    const before = todo
    setTodos(prev => prev.map(item => item.id === todo.id ? { ...item, ...patch } : item))

    const { error } = await supabase
      .from('todo_items')
      .update(patch)
      .eq('id', todo.id)

    if (error) {
      setTodos(prev => prev.map(item => item.id === todo.id ? before : item))
      setError(error.message)
    }
  }

  const toggleDone = async (todo: TodoItem) => {
    const done = todo.status !== 'done'
    await patchTodo(todo, {
      status: done ? 'done' : 'open',
      completed_at: done ? new Date().toISOString() : undefined,
    })
    if (user) await logActivity(user, done ? 'todo.completed' : 'todo.reopened', todo.title, { todo_id: todo.id })
  }

  const deleteTodo = async (todo: TodoItem) => {
    if (!user || todo.owner_id !== user.id) return
    const before = todos
    setTodos(prev => prev.filter(item => item.id !== todo.id))

    const { error } = await supabase
      .from('todo_items')
      .update({ deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', todo.id)

    if (error) {
      setTodos(before)
      setError(error.message)
    } else {
      await logActivity(user, 'todo.deleted', todo.title, { todo_id: todo.id })
    }
  }

  const openSplit = async (todo: TodoItem) => {
    setSplitTodo(todo); setSplitResult([]); setSplitSelected(new Set()); setSplitError(null); setSplitLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase.functions.invoke('ai-todo-split', {
      body: { title: todo.title, note: todo.note ?? null, today },
    })
    setSplitLoading(false)
    if (error || data?.error) { setSplitError(error?.message ?? data?.error); return }
    const subtasks: { title: string; due_date?: string | null; note?: string | null }[] = data?.subtasks ?? []
    setSplitResult(subtasks)
    setSplitSelected(new Set(subtasks.map((_, i) => i)))
  }

  const createSplitTodos = async () => {
    if (!user || !splitTodo || splitSaving) return
    const selected = splitResult.filter((_, i) => splitSelected.has(i))
    if (!selected.length) return
    setSplitSaving(true)
    const rows = selected.map(s => ({
      title: s.title,
      note: s.note || null,
      owner_id: user.id,
      owner_email: user.email,
      owner_name: user.name,
      created_by: user.id,
      created_by_email: user.email,
      status: 'open',
      priority: 'normal',
      due_date: s.due_date || null,
      pinned: false,
      sort_order: Date.now(),
      deleted: false,
    }))
    const { data, error } = await supabase.from('todo_items').insert(rows).select('*')
    if (!error && data) {
      setTodos(prev => [...(data as TodoItem[]), ...prev])
      await logActivity(user, 'todo.ai_split', `แบ่ง Todo: ${splitTodo.title} เป็น ${selected.length} รายการ`, { todo_id: splitTodo.id })
    }
    setSplitSaving(false)
    setSplitTodo(null)
  }

  const renderTodoCard = (todo: TodoItem, compact = false, tone?: string) => {
    const done = todo.status === 'done'
    const overdue = !done && isOverdue(todo.due_date)

    return (
      <div
        key={todo.id}
        onClick={() => { if (!compact) setEditingTodo(todo) }}
        style={{ padding: compact ? 12 : '12px 12px 12px 14px', borderRadius: 14, background: done ? '#f8fafc' : '#fff', border: overdue ? '1px solid #fecaca' : '1px solid rgba(15,23,42,0.06)', borderLeft: tone ? `4px solid ${tone}` : undefined, boxShadow: compact ? 'none' : SHADOW, opacity: done ? 0.72 : 1, cursor: compact ? 'default' : 'pointer' }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {!compact && (
            <button
              onClick={event => { event.stopPropagation(); toggleDone(todo) }}
              style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 999, border: done ? 'none' : '1.5px solid #cbd5e1', background: done ? '#10b981' : '#fff', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
            >
              {done ? '✓' : ''}
            </button>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: compact ? 13.5 : 15, color: done ? '#64748b' : '#1e293b', textDecoration: done ? 'line-through' : 'none', wordBreak: 'break-word' }}>{todo.title}</div>
            {todo.note && !compact && <div style={{ marginTop: 6, fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{todo.note}</div>}
          </div>
          {!compact && (
            <button
              onClick={event => { event.stopPropagation(); deleteTodo(todo) }}
              style={{ flexShrink: 0, border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: compact ? 6 : 9 }}>
          {dueLabel(todo) && <span style={{ borderRadius: 999, padding: '3px 9px', background: overdue ? '#fef2f2' : '#eff6ff', color: overdue ? '#b91c1c' : '#1d4ed8', fontFamily: 'Anuphan, sans-serif', fontSize: 11.5 }}>📅 {dueLabel(todo)}</span>}
          {todo.priority === 'high' && <span style={{ borderRadius: 999, padding: '3px 9px', background: '#fff7ed', color: '#c2410c', fontFamily: 'Anuphan, sans-serif', fontSize: 11.5 }}>สำคัญ</span>}
          {todo.pinned && <span style={{ borderRadius: 999, padding: '3px 9px', background: '#fefce8', color: '#a16207', fontFamily: 'Anuphan, sans-serif', fontSize: 11.5 }}>ปักหมุด</span>}
          {compact && <span style={{ borderRadius: 999, padding: '3px 9px', background: done ? '#ecfdf5' : '#f8fafc', color: done ? '#047857' : '#64748b', fontFamily: 'Anuphan, sans-serif', fontSize: 11.5 }}>{done ? 'เสร็จ' : 'เปิด'}</span>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#eef0f7' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: '16px 24px', background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)', borderBottom: '1px solid #e4e8f2', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', flexShrink: 0 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, boxShadow: '0 4px 14px rgba(26,39,68,0.28)' }}>K</div>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 20, lineHeight: 1.2, color: '#1e293b' }}>Kanban</h1>
          <p style={{ margin: '2px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#94a3b8' }}>
            {activeMode === 'dashboard' ? `${dashboard.totals.open} งานเปิดในทีม` : activeMode === 'kanban' ? 'Kanban กลางของทีม' : `${openCount} งานที่ยังไม่เสร็จ`}
          </p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', padding: 4, borderRadius: 12, background: '#e2e8f0' }}>
          {(['kanban', 'mine', ...(showDashboard ? ['dashboard'] as TodoMode[] : [])] as TodoMode[]).map(item => (
            <button key={item} onClick={() => setMode(item)} style={{ border: 'none', borderRadius: 9, padding: '8px 12px', background: mode === item ? '#fff' : 'transparent', color: mode === item ? '#1e293b' : '#64748b', boxShadow: mode === item ? '0 2px 8px rgba(15,23,42,0.08)' : 'none', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5 }}>
              {item === 'mine' ? 'รายการของฉัน' : item === 'kanban' ? 'Kanban กลาง' : 'Dashboard'}
            </button>
          ))}
        </div>
      </div>

      {activeMode === 'mine' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, padding: 16, background: '#fff', borderBottom: '1px solid #e4e8f2' }}>
          <input value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') createTodo() }} placeholder="เพิ่ม Todo..." style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
          <input value={note} onChange={event => setNote(event.target.value)} placeholder="โน้ต" style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
          <select value={priority} onChange={event => setPriority(event.target.value as 'normal' | 'high')} style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#fff', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }}>
            <option value="normal">ปกติ</option>
            <option value="high">สำคัญ</option>
          </select>
          <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
          <input value={dueTime} onChange={event => setDueTime(event.target.value)} onBlur={event => setDueTime(normalizeTimeInput(event.target.value))} inputMode="numeric" placeholder="09:00" style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
          <button disabled={saving || !title.trim()} onClick={createTodo} style={{ gridColumn: '1 / -1', justifySelf: 'end', border: 'none', borderRadius: 12, padding: '10px 16px', background: title.trim() ? '#1a2744' : '#cbd5e1', color: '#fff', cursor: title.trim() ? 'pointer' : 'default', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }}>เพิ่ม Todo</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
        {activeMode !== 'kanban' && error && <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: '#fff7ed', color: '#9a3412', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>{error}</div>}

        {activeMode === 'kanban' && <KanbanBoard />}

        {activeMode !== 'kanban' && loading && <div style={{ padding: 28, borderRadius: 18, background: '#fff', color: '#94a3b8', textAlign: 'center', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>กำลังโหลด Todo...</div>}

        {!loading && activeMode === 'mine' && (
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'clamp(220px, 85vw, 320px)', gap: 14, alignItems: 'start', overflowX: 'auto', paddingBottom: 4 }}>
            {BUCKETS.map(bucket => (
              <section key={bucket.key} style={{ borderRadius: 18, background: bucket.soft, border: '1px solid rgba(15,23,42,0.06)', overflow: 'hidden', boxShadow: SHADOW }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: bucket.tone, color: '#fff' }}>
                  <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 15.5, fontWeight: 700 }}>{bucket.title}</h2>
                  <span style={{ minWidth: 26, textAlign: 'center', borderRadius: 999, padding: '3px 8px', background: 'rgba(255,255,255,0.85)', color: bucket.tone, fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 700 }}>{buckets[bucket.key].length}</span>
                </div>
                <div style={{ display: 'grid', gap: 10, padding: 12, minHeight: 80 }}>
                  {buckets[bucket.key].length ? buckets[bucket.key].map(todo => renderTodoCard(todo, false, bucket.tone)) : <div style={{ padding: 22, textAlign: 'center', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>ว่างอยู่</div>}
                </div>
              </section>
            ))}
          </div>
        )}

        {!loading && activeMode === 'dashboard' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))', gap: 12 }}>
              {[
                { n: dashboard.totals.open, label: 'ยังไม่เสร็จ', color: '#1d4ed8' },
                { n: dashboard.totals.today, label: 'วันนี้', color: '#b45309' },
                { n: dashboard.totals.overdue, label: 'เกินกำหนด', color: '#b91c1c' },
                { n: dashboard.totals.done, label: 'เสร็จแล้ว', color: '#047857' },
              ].map(card => (
                <div key={card.label} style={{ borderRadius: 16, background: '#fff', padding: 16, boxShadow: SHADOW }}>
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 26, color: card.color, fontWeight: 700 }}>{card.n}</div>
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#64748b' }}>{card.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              {dashboard.owners.length ? dashboard.owners.map(owner => (
                <section key={owner.email} style={{ borderRadius: 18, background: '#fff', padding: 16, boxShadow: SHADOW, border: '1px solid rgba(15,23,42,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 15.5, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{owner.name}</div>
                      <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{owner.email}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <span style={{ borderRadius: 999, padding: '4px 8px', background: '#eff6ff', color: '#1d4ed8', fontFamily: 'Anuphan, sans-serif', fontSize: 12 }}>เปิด {owner.open}</span>
                      <span style={{ borderRadius: 999, padding: '4px 8px', background: '#fef2f2', color: '#b91c1c', fontFamily: 'Anuphan, sans-serif', fontSize: 12 }}>เกิน {owner.overdue}</span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {owner.todos.length ? owner.todos.map(todo => renderTodoCard(todo, true)) : <div style={{ padding: 18, color: '#94a3b8', textAlign: 'center', fontFamily: 'Anuphan, sans-serif' }}>ว่างอยู่</div>}
                  </div>
                </section>
              )) : <div style={{ padding: 28, borderRadius: 18, background: '#fff', color: '#94a3b8', textAlign: 'center', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>ยังไม่มี Todo ของทีม</div>}
            </div>
          </div>
        )}
      </div>

      {editingTodo && (
        <TodoDetailModal
          todo={editingTodo}
          onClose={() => setEditingTodo(null)}
          onSave={async patch => { await patchTodo(editingTodo, patch); setEditingTodo(null) }}
          onDelete={deleteTodo}
          onSplit={target => { setEditingTodo(null); openSplit(target) }}
        />
      )}

      {/* AI SPLIT MODAL */}
      {splitTodo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setSplitTodo(null) }}>
          <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 20 }}>✨</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: 'Anuphan, sans-serif' }}>AI แบ่ง Todo เป็น Subtask</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: 'Anuphan, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{splitTodo.title}</div>
              </div>
              <button onClick={() => setSplitTodo(null)} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 30, height: 30, color: '#fff', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
              {splitLoading && (
                <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontFamily: 'Anuphan, sans-serif' }}>
                  <div style={{ width: 32, height: 32, border: '3px solid #e9d5ff', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
                  AI กำลังวิเคราะห์...
                </div>
              )}
              {splitError && <div style={{ padding: '10px 14px', borderRadius: 9, background: '#fef2f2', color: '#b91c1c', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>⚠️ {splitError}</div>}
              {!splitLoading && splitResult.length > 0 && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', marginBottom: 4 }}>
                    เลือก Subtask ที่ต้องการสร้าง ({splitSelected.size}/{splitResult.length})
                  </div>
                  {splitResult.map((s, i) => (
                    <label key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 12, background: splitSelected.has(i) ? '#faf5ff' : '#f8fafc', border: `1.5px solid ${splitSelected.has(i) ? '#c4b5fd' : '#e2e8f0'}`, cursor: 'pointer', alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={splitSelected.has(i)} onChange={() => setSplitSelected(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n })} style={{ marginTop: 2, accentColor: '#7c3aed', flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 14, color: '#1e293b' }}>{s.title}</div>
                        {s.note && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.note}</div>}
                        {s.due_date && <div style={{ marginTop: 4, fontSize: 12, color: '#1d4ed8', background: '#eff6ff', borderRadius: 6, padding: '2px 8px', display: 'inline-block' }}>📅 {s.due_date}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {!splitLoading && splitResult.length > 0 && (
              <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setSplitTodo(null)} style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 16px', background: '#fff', color: '#64748b', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 13 }}>ยกเลิก</button>
                <button onClick={createSplitTodos} disabled={splitSaving || splitSelected.size === 0} style={{ border: 'none', borderRadius: 10, padding: '9px 18px', background: splitSelected.size > 0 ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#e9d5ff', color: splitSelected.size > 0 ? '#fff' : '#a78bfa', cursor: splitSelected.size > 0 ? 'pointer' : 'default', fontFamily: 'Anuphan, sans-serif', fontWeight: 800, fontSize: 13 }}>
                  {splitSaving ? 'กำลังสร้าง...' : `✅ สร้าง ${splitSelected.size} รายการ`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
