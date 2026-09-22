import { useRef, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { supabase } from '../../lib/supabase'
import { useTasks } from '../../hooks/useTasks'
import { useRealtimeTasks } from '../../hooks/useRealtimeTasks'
import { useTaskStore } from '../../stores/taskStore'
import { useAuthStore } from '../../stores/authStore'
import { canEditTasks, canDeleteTasks } from '../../lib/permissions'
import { logActivity } from '../../lib/activityLog'
import TaskCard from '../../components/TaskCard'
import TaskModal from '../../components/TaskModal'
import type { Section, Task } from '../../types'

type SortMode = 'default' | 'dateAsc' | 'dateDesc' | 'name' | 'done'

const FALLBACK_COLORS = ['#6366f1', '#f59e0b', '#8b5cf6', '#10b981', '#0891b2', '#be123c']

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace('#', '')
  const value = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const num = Number.parseInt(value, 16)
  if (Number.isNaN(num)) return `rgba(100,116,139,${alpha})`
  return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`
}

function sectionColor(section: Section, index: number) {
  return section.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

function sortTasks(items: Task[], mode: SortMode) {
  const next = [...items]
  if (mode === 'default' || mode === 'dateAsc') {
    next.sort((a, b) => String(a.start_date || a.end_date || '9999-12-31').localeCompare(String(b.start_date || b.end_date || '9999-12-31')) || a.title.localeCompare(b.title, 'th'))
  } else if (mode === 'dateDesc') {
    next.sort((a, b) => String(b.start_date || b.end_date || '').localeCompare(String(a.start_date || a.end_date || '')) || a.title.localeCompare(b.title, 'th'))
  } else if (mode === 'name') {
    next.sort((a, b) => a.title.localeCompare(b.title, 'th'))
  } else if (mode === 'done') {
    next.sort((a, b) => Number(a.completed) - Number(b.completed))
  }
  return next
}

function BoardColumn({
  section,
  sectionIndex,
  tasks,
  sortMode,
  onSortChange,
  onComplete,
  onCardClick,
  onAddTask,
  canEdit,
}: {
  section: Section
  sectionIndex: number
  tasks: Task[]
  sortMode: SortMode
  onSortChange: (sectionId: string, sortMode: SortMode) => void
  onComplete: (id: string, done: boolean) => void
  onCardClick: (task: Task) => void
  onAddTask: (sectionId: string) => void
  canEdit: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: section.id })
  const color = sectionColor(section, sectionIndex)
  const parents = tasks.filter(task => !task.parent_task_id)
  const active = sortTasks(parents.filter(task => !task.completed), sortMode)
  const done = sortTasks(parents.filter(task => task.completed), sortMode)
  const subtasksByParent = tasks.reduce<Record<string, Task[]>>((acc, task) => {
    if (task.parent_task_id) {
      acc[task.parent_task_id] = acc[task.parent_task_id] ?? []
      acc[task.parent_task_id].push(task)
    }
    return acc
  }, {})

  return (
    <div style={{ width: 'clamp(280px, 85vw, 430px)', maxWidth: 430, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        background: '#fff',
        border: `1.5px solid ${color}`,
        overflow: 'hidden',
        boxShadow: isOver ? `0 0 0 3px ${hexToRgba(color, 0.18)}, 0 14px 32px rgba(15,23,42,0.14)` : '0 6px 22px rgba(15,23,42,0.07)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          background: color,
          color: '#fff',
          minHeight: 52,
        }}>
          <span style={{ width: 8, height: 24, borderRadius: 999, background: 'rgba(255,255,255,0.86)', flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {section.title}
            </div>
            <div style={{ fontSize: 11, opacity: 0.82, fontWeight: 700 }}>
              ค้าง {active.length} งาน / ทั้งหมด {parents.length}
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 900, padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.94)', color }}>
            {active.length}/{parents.length}
          </span>
          <select
            value={sortMode}
            onChange={event => onSortChange(section.id, event.target.value as SortMode)}
            style={{
              width: 112,
              border: '1px solid rgba(255,255,255,0.65)',
              borderRadius: 7,
              padding: '5px 6px',
              background: 'rgba(255,255,255,0.94)',
              color: '#475569',
              fontSize: 12,
              outline: 'none',
            }}
          >
            <option value="default">เรียง: ปกติ</option>
            <option value="dateAsc">วันที่ขึ้นก่อน</option>
            <option value="dateDesc">วันที่หลังขึ้นก่อน</option>
            <option value="name">ชื่อ A-Z</option>
            <option value="done">ยังไม่เสร็จก่อน</option>
          </select>
          {canEdit && (
            <button
              onClick={() => onAddTask(section.id)}
              title="เพิ่มงานในคอลัมน์นี้"
              style={{
                width: 30,
                height: 30,
                borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.65)',
                background: 'rgba(255,255,255,0.94)',
                color,
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                fontWeight: 700,
              }}
            >
              +
            </button>
          )}
        </div>

        <div
          ref={setNodeRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            background: isOver ? hexToRgba(color, 0.1) : '#f8fafc',
          }}
        >
          <SortableContext items={canEdit ? active.map(task => task.id) : []} strategy={verticalListSortingStrategy}>
            {active.map(task => (
              <div key={task.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <TaskCard task={task} subtasks={subtasksByParent[task.id] ?? []} onComplete={onComplete} onClick={onCardClick} canEdit={canEdit} />
                {(subtasksByParent[task.id] ?? []).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginLeft: 16, paddingLeft: 12, borderLeft: '2px solid #d1d5db' }}>
                    {(subtasksByParent[task.id] ?? []).map(subtask => (
                      <TaskCard key={subtask.id} task={subtask} onComplete={onComplete} onClick={onCardClick} canEdit={canEdit} compact />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </SortableContext>

          {canEdit && active.length === 0 && (
            <button
              onClick={() => onAddTask(section.id)}
              style={{
                minHeight: 96,
                border: `2px dashed ${hexToRgba(color, 0.34)}`,
                borderRadius: 10,
                background: '#fff',
                color: '#64748b',
                cursor: 'pointer',
                fontFamily: 'Anuphan, sans-serif',
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              + เพิ่มงานใหม่
            </button>
          )}

          {done.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 13, color: '#64748b', cursor: 'pointer', padding: '6px 8px', userSelect: 'none', listStyle: 'none', fontWeight: 800 }}>
                เสร็จแล้ว ({done.length})
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, opacity: 0.68 }}>
                {done.map(task => (
                  <TaskCard key={task.id} task={task} subtasks={subtasksByParent[task.id] ?? []} onComplete={onComplete} onClick={onCardClick} canEdit={canEdit} />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

export default function BoardPage() {
  const { tasks, sections, loading, loadError, completeTask } = useTasks()
  const { updateTask, addTask, setSections } = useTaskStore()
  const { user } = useAuthStore()
  const canEdit = canEditTasks(user?.role)
  const canDelete = canDeleteTasks(user?.role)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [defaultSectionId, setDefaultSectionId] = useState<string | undefined>()
  const [defaultParentTaskId, setDefaultParentTaskId] = useState<string | undefined>()
  const [sectionToolsOpen, setSectionToolsOpen] = useState(false)
  const [sectionSort, setSectionSort] = useState<Record<string, SortMode>>({})
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [sectionSaving, setSectionSaving] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [deletedTasks, setDeletedTasks] = useState<Task[]>([])
  const [trashLoading, setTrashLoading] = useState(false)

  // AI Task Parse
  const [aiOpen, setAiOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiDefaults, setAiDefaults] = useState<{title?:string;description?:string;start_date?:string;end_date?:string;start_time?:string;end_time?:string;tags?:string[]} | undefined>()
  const aiInputRef = useRef<HTMLTextAreaElement>(null)

  useRealtimeTasks()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const activeTasks = tasks.filter(task => !task.deleted)
  const pendingCount = activeTasks.filter(task => !task.completed).length
  const completedCount = activeTasks.filter(task => task.completed).length
  const subtaskCount = activeTasks.filter(task => task.parent_task_id).length
  const q = search.trim().toLowerCase()

  const taskMatches = (task: Task) => {
    if (!q) return true
    const assignees = task.task_members
      ?.map(tm => `${tm.members?.name_th ?? ''} ${tm.members?.nickname ?? ''} ${tm.members?.email ?? ''} ${tm.committees?.name ?? ''}`)
      .join(' ') ?? ''
    return [
      task.code,
      task.title,
      task.description,
      task.task_types?.name,
      task.sections?.title,
      ...(task.tags ?? []),
      assignees,
    ].some(value => (value ?? '').toLowerCase().includes(q))
  }

  const matchedIds = new Set(q ? activeTasks.filter(taskMatches).map(task => task.id) : [])
  if (q) {
    activeTasks.forEach(task => {
      if (task.parent_task_id && matchedIds.has(task.id)) matchedIds.add(task.parent_task_id)
    })
  }
  const filtered = q
    ? activeTasks.filter(task => matchedIds.has(task.id) || (task.parent_task_id && matchedIds.has(task.parent_task_id)))
    : activeTasks

  const visibleSections = q
    ? sections.filter(section => filtered.some(task => task.section_id === section.id))
    : sections
  const searchParentCount = q ? filtered.filter(task => !task.parent_task_id).length : 0

  const openAiParse = async () => {
    const text = aiText.trim()
    if (!text || aiLoading) return
    setAiLoading(true); setAiError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const sectionHints = sections.map(s => ({ id: s.id, title: s.title }))
      const { data, error } = await supabase.functions.invoke('ai-task-parse', {
        body: { text, today, sections: sectionHints },
      })
      if (error) { setAiError(error.message); setAiLoading(false); return }
      if (data?.error) { setAiError(data.error); setAiLoading(false); return }
      // ใช้ defaultValues + defaultSectionId เพื่อ pre-fill TaskModal ใน create mode
      setAiOpen(false)
      setAiText('')
      setAiLoading(false)
      setEditTask(null)
      setDefaultParentTaskId(undefined)
      setDefaultSectionId(data.section_id ?? undefined)
      setAiDefaults({
        title:       data.title ?? '',
        description: data.description ?? undefined,
        start_date:  data.start_date ?? undefined,
        end_date:    data.end_date ?? undefined,
        start_time:  data.start_time ?? undefined,
        end_time:    data.end_time ?? undefined,
        tags:        Array.isArray(data.tags) ? data.tags : [],
      })
      setModalOpen(true)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
      setAiLoading(false)
    }
  }

  const openCreateTask = (sectionId?: string, parentTask?: Task) => {
    setEditTask(null)
    setDefaultSectionId(sectionId ?? parentTask?.section_id)
    setDefaultParentTaskId(parentTask?.id)
    setModalOpen(true)
  }

  const openEditTask = (task: Task) => {
    setEditTask(task)
    setDefaultSectionId(undefined)
    setDefaultParentTaskId(undefined)
    setModalOpen(true)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canEdit) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const task = tasks.find(item => item.id === active.id)
    if (!task) return
    const newSectionId = sections.find(section => section.id === over.id)?.id
      ?? tasks.find(item => item.id === over.id)?.section_id
    if (!newSectionId || newSectionId === task.section_id) return

    const oldSectionId = task.section_id
    const childTasks = tasks.filter(item => item.parent_task_id === task.id)
    updateTask(task.id, { section_id: newSectionId, _optimistic: true })
    childTasks.forEach(child => updateTask(child.id, { section_id: newSectionId, _optimistic: true }))

    const { error } = await supabase.from('tasks').update({ section_id: newSectionId }).eq('id', task.id)
    if (error) {
      updateTask(task.id, { section_id: oldSectionId, _optimistic: false })
      childTasks.forEach(child => updateTask(child.id, { section_id: oldSectionId, _optimistic: false }))
      return
    }

    if (childTasks.length > 0) {
      const { error: childError } = await supabase.from('tasks').update({ section_id: newSectionId }).eq('parent_task_id', task.id)
      childTasks.forEach(child => updateTask(child.id, { section_id: childError ? oldSectionId : newSectionId, _optimistic: false }))
    }
    updateTask(task.id, { _optimistic: false })
    await logActivity(user, 'task.moved', `Moved task: ${task.title}`, { task_id: task.id, from_section_id: oldSectionId, to_section_id: newSectionId, moved_subtasks: childTasks.length })
  }

  const loadDeletedTasks = async () => {
    setTrashLoading(true)
    const { data } = await supabase
      .from('tasks')
      .select('*, sections(*), task_types(*), task_members(*, members(*), committees(*)), task_staff(*, users(*, members(id, name_th, nickname, email, position_committee, province)))')
      .eq('deleted', true)
      .order('deleted_at', { ascending: false, nullsFirst: false })
      .limit(80)
    setDeletedTasks((data ?? []) as Task[])
    setTrashLoading(false)
  }

  const openTrash = async () => {
    const next = !trashOpen
    setTrashOpen(next)
    if (next) await loadDeletedTasks()
  }

  const restoreTask = async (task: Task) => {
    if (!canEdit) return
    const { error } = await supabase.from('tasks').update({ deleted: false, deleted_at: null, deleted_by: null }).eq('id', task.id)
    if (error) return
    setDeletedTasks(prev => prev.filter(item => item.id !== task.id))
    addTask({ ...task, deleted: false, deleted_at: undefined })
    void supabase.functions.invoke('sync-task-calendar', { body: { taskId: task.id } }).catch(() => undefined)
    await logActivity(user, 'task.restored', `Restored task: ${task.title}`, { task_id: task.id })
  }

  const createSection = async () => {
    if (!user || !canEdit || !newSectionTitle.trim() || sectionSaving) return
    setSectionSaving(true)
    const nextSortOrder = Math.max(0, ...sections.map(section => Number(section.sort_order ?? 0))) + 10
    const { data, error } = await supabase.from('sections').insert({ title: newSectionTitle.trim(), sort_order: nextSortOrder, active: true }).select('*').single()
    if (!error && data) {
      const nextSections = [...sections, data as Section].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
      setSections(nextSections)
      setNewSectionTitle('')
      await logActivity(user, 'section.created', `Created section: ${(data as Section).title}`, { section_id: (data as Section).id })
    }
    setSectionSaving(false)
  }

  const moveSection = async (sectionId: string, direction: -1 | 1) => {
    if (!user || !canEdit || sectionSaving) return
    const ordered = [...sections].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    const index = ordered.findIndex(section => section.id === sectionId)
    const swapIndex = index + direction
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) return
    const current = ordered[index]
    const other = ordered[swapIndex]
    const currentOrder = Number(current.sort_order ?? index * 10)
    const otherOrder = Number(other.sort_order ?? swapIndex * 10)
    const nextSections = ordered.map(section => {
      if (section.id === current.id) return { ...section, sort_order: otherOrder }
      if (section.id === other.id) return { ...section, sort_order: currentOrder }
      return section
    }).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))

    setSectionSaving(true)
    setSections(nextSections)
    const [currentRes, otherRes] = await Promise.all([
      supabase.from('sections').update({ sort_order: otherOrder }).eq('id', current.id),
      supabase.from('sections').update({ sort_order: currentOrder }).eq('id', other.id),
    ])
    if (currentRes.error || otherRes.error) setSections(ordered)
    else await logActivity(user, 'section.reordered', `Reordered section: ${current.title}`, { section_id: current.id, direction })
    setSectionSaving(false)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTopColor: '#1a2744', borderRadius: '50%', animation: 'spin 0.75s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 32 }}>
        <div style={{ maxWidth: 540, background: '#fff', borderRadius: 18, border: '1.5px solid #fca5a5', padding: 28, boxShadow: '0 10px 36px rgba(220,38,38,0.08)' }}>
          <div style={{ color: '#b91c1c', fontWeight: 900, fontSize: 17, marginBottom: 10, fontFamily: 'Anuphan, sans-serif' }}>โหลดข้อมูลไม่สำเร็จ</div>
          <div style={{ color: '#475569', fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>{loadError}</div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            หากข้อความระบุ "task_staff" กรุณารัน: <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>supabase db push --linked</code>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#eef3fa' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', background: 'rgba(255,255,255,0.86)', borderBottom: '1px solid #dde6f2', flexShrink: 0, boxShadow: '0 8px 22px rgba(15,23,42,0.05)' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontFamily: 'Anuphan, sans-serif', fontWeight: 800, fontSize: 20, color: '#13244a', lineHeight: 1.2 }}>Task Board</h1>
          <p style={{ fontSize: 12.5, color: '#64748b', marginTop: 2, fontWeight: 700 }}>
            ค้าง {pendingCount} งาน · เสร็จแล้ว {completedCount} งาน · Subtask {subtaskCount}
          </p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input
            type="text"
            placeholder="ค้นหางาน, tag, ผู้รับผิดชอบ..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            style={{ padding: '9px 12px', fontSize: 14, border: '1.5px solid #dbe4ee', borderRadius: 8, background: '#fff', color: '#0f172a', outline: 'none', flex: '0 1 270px', minWidth: 0 }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ border: 'none', borderRadius: 8, padding: '9px 11px', background: '#fff7ed', color: '#c2410c', cursor: 'pointer', fontWeight: 800 }}>
              ล้างค้นหา
            </button>
          )}
          {canEdit && (
            <button onClick={() => setSectionToolsOpen(prev => !prev)} style={{ border: 'none', borderRadius: 8, padding: '9px 12px', background: sectionToolsOpen ? '#e0f2fe' : '#f1f5f9', color: sectionToolsOpen ? '#0369a1' : '#475569', cursor: 'pointer', fontWeight: 800 }}>
              จัดการ Section
            </button>
          )}
          {canEdit && (
            <button onClick={openTrash} style={{ border: 'none', borderRadius: 8, padding: '9px 12px', background: trashOpen ? '#fee2e2' : '#f1f5f9', color: trashOpen ? '#b91c1c' : '#475569', cursor: 'pointer', fontWeight: 800 }}>
              ถังงาน {deletedTasks.length > 0 ? `(${deletedTasks.length})` : ''}
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => { setAiOpen(true); setAiError(null); setTimeout(() => aiInputRef.current?.focus(), 80) }}
              style={{ border: 'none', borderRadius: 8, padding: '9px 14px', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', cursor: 'pointer', fontWeight: 900, boxShadow: '0 4px 14px rgba(124,58,237,0.30)', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              ✨ AI สร้างงาน
            </button>
          )}
          <button disabled={!canEdit} onClick={() => canEdit && openCreateTask()} style={{ border: 'none', borderRadius: 8, padding: '9px 16px', background: canEdit ? 'linear-gradient(135deg,#1b2a52,#2f5ea8 70%,#c28a16)' : '#cbd5e1', color: '#fff', cursor: canEdit ? 'pointer' : 'not-allowed', fontWeight: 900, boxShadow: canEdit ? '0 8px 18px rgba(27,42,82,0.22)' : 'none' }}>
            + เพิ่มงาน
          </button>
        </div>
      </div>

      {q && !trashOpen && (
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '6px 20px', fontSize: 12.5, color: '#92400e', fontWeight: 800 }}>
          ค้นหา "{search.trim()}" พบ {searchParentCount} งาน ใน {visibleSections.length} section
        </div>
      )}

      {sectionToolsOpen && canEdit && (
        <div style={{ padding: '10px 20px', background: '#fff', borderBottom: '1px solid #dde6f2', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input value={newSectionTitle} onChange={event => setNewSectionTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') createSection() }} placeholder="ชื่อ Section ใหม่" style={{ width: 220, padding: '8px 10px', borderRadius: 8, border: '1.5px solid #dbe4ee', outline: 'none' }} />
          <button disabled={sectionSaving || !newSectionTitle.trim()} onClick={createSection} style={{ border: 'none', borderRadius: 8, padding: '8px 12px', background: newSectionTitle.trim() ? '#1a2744' : '#cbd5e1', color: '#fff', cursor: newSectionTitle.trim() ? 'pointer' : 'default', fontWeight: 800 }}>เพิ่ม Section</button>
          {sections.map((section, index) => (
            <div key={section.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 12.5, color: '#334155', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>{section.title}</span>
              <button disabled={index === 0 || sectionSaving} onClick={() => moveSection(section.id, -1)} style={{ width: 25, height: 25, border: 'none', borderRadius: 6, background: index === 0 ? '#e2e8f0' : '#eff6ff', color: index === 0 ? '#94a3b8' : '#1d4ed8', cursor: index === 0 ? 'default' : 'pointer' }}>‹</button>
              <button disabled={index === sections.length - 1 || sectionSaving} onClick={() => moveSection(section.id, 1)} style={{ width: 25, height: 25, border: 'none', borderRadius: 6, background: index === sections.length - 1 ? '#e2e8f0' : '#eff6ff', color: index === sections.length - 1 ? '#94a3b8' : '#1d4ed8', cursor: index === sections.length - 1 ? 'default' : 'pointer' }}>›</button>
            </div>
          ))}
        </div>
      )}

      {trashOpen ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <div style={{ borderRadius: 12, background: '#fff', boxShadow: '0 10px 30px rgba(15,23,42,0.08)', border: '1px solid #dde6f2', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', background: '#f8fafc', borderBottom: '1px solid #dde6f2' }}>
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontWeight: 800, color: '#1e293b' }}>ถังงานที่ลบแล้ว</div>
              <button onClick={loadDeletedTasks} style={{ border: 'none', borderRadius: 8, padding: '7px 10px', background: '#eef2ff', color: '#1d4ed8', cursor: 'pointer', fontWeight: 800 }}>Refresh</button>
            </div>
            {trashLoading && <div style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>กำลังโหลด...</div>}
            {!trashLoading && deletedTasks.map(task => (
              <div key={task.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 150px 110px', gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</div>
                  <div style={{ color: '#64748b', fontSize: 12.5 }}>{task.sections?.title || '-'} · {task.deleted_at ? new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(task.deleted_at)) : '-'}</div>
                </div>
                <button onClick={() => openEditTask(task)} style={{ border: 'none', borderRadius: 8, padding: '8px 10px', background: '#f1f5f9', color: '#334155', cursor: 'pointer', fontWeight: 800 }}>ดูรายละเอียด</button>
                <button onClick={() => restoreTask(task)} style={{ border: 'none', borderRadius: 8, padding: '8px 10px', background: '#ecfdf5', color: '#047857', cursor: 'pointer', fontWeight: 800 }}>กู้คืน</button>
              </div>
            ))}
            {!trashLoading && deletedTasks.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>ไม่มีงานที่ลบแล้ว</div>}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div style={{ display: 'flex', gap: 14, padding: '14px 18px 18px', height: '100%', width: 'max-content', alignItems: 'stretch' }}>
              {visibleSections.map((section, index) => (
                <BoardColumn
                  key={section.id}
                  section={section}
                  sectionIndex={index}
                  tasks={filtered.filter(task => task.section_id === section.id)}
                  sortMode={sectionSort[section.id] ?? 'default'}
                  onSortChange={(sectionId, sortMode) => setSectionSort(prev => ({ ...prev, [sectionId]: sortMode }))}
                  onComplete={completeTask}
                  onCardClick={openEditTask}
                  onAddTask={sectionId => openCreateTask(sectionId)}
                  canEdit={canEdit}
                />
              ))}
            </div>
          </DndContext>
        </div>
      )}

      {/* AI TASK PARSE POPUP */}
      {aiOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) { setAiOpen(false); setAiText('') } }}
        >
          <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 520, boxShadow: '0 24px 64px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>✨</span>
              <div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 16, fontFamily: 'Anuphan, sans-serif' }}>AI สร้างงานอัตโนมัติ</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: 'Anuphan, sans-serif' }}>พิมพ์บอก AI แล้วระบบจะกรอกแบบฟอร์มให้อัตโนมัติ</div>
              </div>
              <button onClick={() => { setAiOpen(false); setAiText('') }} style={{ marginLeft: 'auto', border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 32, height: 32, color: '#fff', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            <div style={{ padding: '20px 20px 24px', fontFamily: 'Anuphan, sans-serif' }}>
              {/* Example chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {[
                  'นัดประชุมทีมวันศุกร์หน้า 10:00-12:00',
                  'ส่งรายงาน YEC Forum ภายใน 20 มิ.ย.',
                  'เตรียมงานอีเวนต์ 15-16 กรกฎาคม',
                  'ติดตามงบประมาณไตรมาส 3',
                ].map(ex => (
                  <button
                    key={ex}
                    onClick={() => setAiText(ex)}
                    style={{ border: '1.5px solid #e9d5ff', borderRadius: 20, padding: '4px 11px', background: '#faf5ff', color: '#7c3aed', fontSize: 12, cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 600 }}
                  >
                    {ex}
                  </button>
                ))}
              </div>

              <textarea
                ref={aiInputRef}
                value={aiText}
                onChange={e => setAiText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) openAiParse() }}
                placeholder="เช่น &quot;นัดประชุมทีม 5 คน วันศุกร์หน้า เวลา 14:00&quot; หรือ &quot;ส่งรายงานสรุปงาน ภายใน 30 มิ.ย.&quot;"
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '11px 14px',
                  borderRadius: 12, border: '1.5px solid #e9d5ff',
                  fontFamily: 'Anuphan, sans-serif', fontSize: 14.5,
                  resize: 'none', outline: 'none', lineHeight: 1.65,
                  color: '#1e293b', background: '#faf5ff',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.background = '#fff' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e9d5ff'; e.currentTarget.style.background = '#faf5ff' }}
              />

              {aiError && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 9, background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: 13 }}>
                  ⚠️ {aiError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
                <span style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>Ctrl+Enter เพื่อส่ง</span>
                <button onClick={() => { setAiOpen(false); setAiText('') }} style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '10px 18px', background: '#fff', color: '#64748b', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 14 }}>
                  ยกเลิก
                </button>
                <button
                  onClick={openAiParse}
                  disabled={!aiText.trim() || aiLoading}
                  style={{
                    border: 'none', borderRadius: 10, padding: '10px 22px',
                    background: aiText.trim() && !aiLoading ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#e9d5ff',
                    color: aiText.trim() && !aiLoading ? '#fff' : '#a78bfa',
                    cursor: aiText.trim() && !aiLoading ? 'pointer' : 'default',
                    fontFamily: 'Anuphan, sans-serif', fontWeight: 800, fontSize: 14,
                    boxShadow: aiText.trim() && !aiLoading ? '0 4px 12px rgba(124,58,237,0.30)' : 'none',
                    display: 'flex', alignItems: 'center', gap: 7,
                    transition: 'background 0.15s',
                  }}
                >
                  {aiLoading ? (
                    <>
                      <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                      กำลังวิเคราะห์...
                    </>
                  ) : (
                    <>✨ สร้างงาน</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <TaskModal
          key={editTask?.id ?? `new-${defaultSectionId ?? ''}-${defaultParentTaskId ?? ''}-${aiDefaults ? 'ai' : ''}`}
          task={editTask}
          defaultSectionId={defaultSectionId}
          defaultParentTaskId={defaultParentTaskId}
          defaultValues={aiDefaults}
          canEdit={canEdit}
          canDelete={canDelete}
          onCreateSubtask={task => openCreateTask(task.section_id, task)}
          onOpenTask={task => {
            setEditTask(task)
            setDefaultSectionId(undefined)
            setDefaultParentTaskId(undefined)
          }}
          onClose={() => { setModalOpen(false); setEditTask(null); setDefaultSectionId(undefined); setDefaultParentTaskId(undefined); setAiDefaults(undefined) }}
        />
      )}
    </div>
  )
}
