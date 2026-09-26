import { useEffect, useMemo, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activityLog'
import { useAuthStore } from '../../stores/authStore'
import { canEditTasks } from '../../lib/permissions'
import type { KanbanCard, User } from '../../types'

const SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'
const FONT = 'Anuphan, sans-serif'
const INPUT_STYLE = { padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 14, background: '#fff', minWidth: 0 } as const

type Status = KanbanCard['status']
type UserOption = Pick<User, 'id' | 'name' | 'email'>
type CommitteeOption = { id: string; name: string; code: string | null; color: string | null }
type Assignment = Pick<KanbanCard, 'assignee_ids' | 'assignee_names' | 'committee_ids'>
type DueFilter = 'all' | 'overdue' | 'week' | 'nodate'

const EMPTY_ASSIGNMENT: Assignment = { assignee_ids: [], assignee_names: [], committee_ids: [] }
const NO_COMMITTEE = '__none__'

const COLUMNS: { key: Status; title: string; tone: string; soft: string }[] = [
  { key: 'todo', title: 'To Do', tone: '#64748b', soft: '#f1f5f9' },
  { key: 'in_progress', title: 'In Progress', tone: '#2563eb', soft: '#eff6ff' },
  { key: 'done', title: 'Done', tone: '#059669', soft: '#ecfdf5' },
]

function dateKey(offsetDays = 0) {
  const now = new Date()
  now.setDate(now.getDate() + offsetDays)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isOverdue(date?: string | null) {
  return !!date && date < dateKey()
}

function formatDate(date?: string | null) {
  if (!date) return ''
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`))
}

// Picker for people AND whole committees in one field: a typed/picked value
// matching a user or committee name becomes a real link; anything else is kept
// as a free-typed name.
function AssigneePicker({ value, onChange, users, committees, disabled }: {
  value: Assignment
  onChange: (next: Assignment) => void
  users: UserOption[]
  committees: CommitteeOption[]
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const committeeById = useMemo(() => new Map(committees.map(c => [c.id, c])), [committees])

  const add = (raw: string) => {
    const name = raw.trim()
    if (!name) return
    const lower = name.toLowerCase()
    const committee = committees.find(c => c.name.trim().toLowerCase() === lower)
    const user = users.find(u => u.name.trim().toLowerCase() === lower)
    if (committee) {
      if (!value.committee_ids.includes(committee.id)) onChange({ ...value, committee_ids: [...value.committee_ids, committee.id] })
    } else if (user) {
      if (!value.assignee_ids.includes(user.id)) onChange({ ...value, assignee_ids: [...value.assignee_ids, user.id] })
    } else if (!value.assignee_names.some(n => n.toLowerCase() === lower)) {
      onChange({ ...value, assignee_names: [...value.assignee_names, name] })
    }
    setText('')
  }

  const isKnown = (raw: string) => {
    const lower = raw.trim().toLowerCase()
    return !!lower && (committees.some(c => c.name.trim().toLowerCase() === lower) || users.some(u => u.name.trim().toLowerCase() === lower))
  }

  const chipBase = { display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '4px 6px 4px 10px', fontFamily: FONT, fontSize: 12.5, fontWeight: 600 } as const
  const removeButton = (onClick: () => void) => !disabled && (
    <button type="button" onClick={onClick} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>×</button>
  )

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {(value.committee_ids.length + value.assignee_ids.length + value.assignee_names.length) > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {value.committee_ids.map(id => {
            const c = committeeById.get(id)
            const color = c?.color ?? '#6366f1'
            return (
              <span key={id} style={{ ...chipBase, background: `${color}1a`, color, border: `1px solid ${color}55` }}>
                👥 {c?.name ?? 'คณะกรรมการ'}
                {removeButton(() => onChange({ ...value, committee_ids: value.committee_ids.filter(x => x !== id) }))}
              </span>
            )
          })}
          {value.assignee_ids.map(id => (
            <span key={id} style={{ ...chipBase, background: '#eff6ff', color: '#1d4ed8' }}>
              {userById.get(id)?.name ?? 'ผู้ใช้'}
              {removeButton(() => onChange({ ...value, assignee_ids: value.assignee_ids.filter(x => x !== id) }))}
            </span>
          ))}
          {value.assignee_names.map(name => (
            <span key={name} style={{ ...chipBase, background: '#f1f5f9', color: '#475569' }}>
              {name}
              {removeButton(() => onChange({ ...value, assignee_names: value.assignee_names.filter(x => x !== name) }))}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={text}
            onChange={event => {
              const next = event.target.value
              // picking an option from the list adds it right away
              if (isKnown(next)) add(next)
              else setText(next)
            }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(text) } }}
            list="kanban-assignee-options"
            placeholder="พิมพ์ชื่อคน หรือชื่อคณะกรรมการ..."
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button type="button" onClick={() => add(text)} disabled={!text.trim()} style={{ border: 'none', borderRadius: 12, padding: '0 14px', background: text.trim() ? '#1a2744' : '#cbd5e1', color: '#fff', cursor: text.trim() ? 'pointer' : 'default', fontFamily: FONT, fontSize: 13, fontWeight: 700 }}>
            เพิ่ม
          </button>
        </div>
      )}
    </div>
  )
}

function CardView({ card, tone, users, committees, canDrag, canDelete, onEdit, onDelete }: {
  card: KanbanCard
  tone: string
  users: Map<string, UserOption>
  committees: Map<string, CommitteeOption>
  canDrag: boolean
  canDelete: boolean
  onEdit: (card: KanbanCard) => void
  onDelete: (card: KanbanCard) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id, disabled: !canDrag })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10, boxShadow: '0 16px 32px rgba(15,23,42,0.18)' }
    : undefined
  const chip = { borderRadius: 999, padding: '3px 9px', fontFamily: FONT, fontSize: 11.5 } as const

  return (
    <div
      ref={setNodeRef}
      onClick={() => onEdit(card)}
      style={{
        padding: '12px 12px 12px 14px',
        borderRadius: 14,
        background: '#fff',
        border: '1px solid rgba(15,23,42,0.06)',
        borderLeft: `4px solid ${tone}`,
        boxShadow: isDragging ? '0 16px 32px rgba(15,23,42,0.18)' : SHADOW,
        opacity: isDragging ? 0.6 : 1,
        cursor: canDrag ? 'grab' : 'pointer',
        ...style,
      }}
      {...listeners}
      {...attributes}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontFamily: FONT, fontSize: 14, lineHeight: 1.5, color: '#1e293b', wordBreak: 'break-word' }}>{card.title}</div>
        {canDelete && (
          <button
            onPointerDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); onDelete(card) }}
            title="ลบการ์ด"
            style={{ flexShrink: 0, border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>
      {card.description && (
        <div style={{ marginTop: 6, fontFamily: FONT, fontSize: 12.5, lineHeight: 1.5, color: '#64748b', whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{card.description}</div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {card.due_date && (
          <span style={{
            ...chip,
            background: card.status !== 'done' && isOverdue(card.due_date) ? '#fef2f2' : '#f8fafc',
            color: card.status !== 'done' && isOverdue(card.due_date) ? '#b91c1c' : '#64748b',
          }}>
            📅 {formatDate(card.due_date)}
          </span>
        )}
        {card.committee_ids.map(id => {
          const c = committees.get(id)
          const color = c?.color ?? '#6366f1'
          return <span key={id} style={{ ...chip, background: `${color}1a`, color, border: `1px solid ${color}40` }}>👥 {c?.name ?? 'คณะกรรมการ'}</span>
        })}
        {card.assignee_ids.map(id => (
          <span key={id} style={{ ...chip, background: '#eff6ff', color: '#1d4ed8' }}>{users.get(id)?.name ?? 'ผู้ใช้'}</span>
        ))}
        {card.assignee_names.map(name => (
          <span key={name} style={{ ...chip, background: '#f1f5f9', color: '#475569' }}>{name}</span>
        ))}
      </div>
    </div>
  )
}

function Column({ status, title, tone, soft, groups, total, children }: {
  status: Status
  title: string
  tone: string
  soft: string
  groups: number
  total: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      style={{
        borderRadius: 18,
        background: isOver ? soft : '#f8fafc',
        border: isOver ? `1.5px solid ${tone}` : '1px solid rgba(15,23,42,0.06)',
        minHeight: 320,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: SHADOW,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: tone, color: '#fff', flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontFamily: FONT, fontSize: 15.5, lineHeight: 1.5, fontWeight: 700 }}>{title}</h2>
        <span style={{ minWidth: 26, textAlign: 'center', borderRadius: 999, padding: '3px 8px', background: 'rgba(255,255,255,0.85)', color: tone, fontFamily: FONT, fontSize: 12, fontWeight: 700 }}>{total}</span>
      </div>
      <div style={{ display: 'grid', gap: 10, minHeight: 80, padding: 12 }}>
        {groups > 0 ? children : <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontFamily: FONT, fontSize: 13 }}>ว่างอยู่</div>}
      </div>
    </div>
  )
}

function EditModal({ card, users, committees, canEdit, canDelete, onClose, onSave, onDelete }: {
  card: KanbanCard
  users: UserOption[]
  committees: CommitteeOption[]
  canEdit: boolean
  canDelete: boolean
  onClose: () => void
  onSave: (patch: Partial<KanbanCard>) => Promise<void>
  onDelete: (card: KanbanCard) => void
}) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [status, setStatus] = useState<Status>(card.status)
  const [assignment, setAssignment] = useState<Assignment>({ assignee_ids: card.assignee_ids, assignee_names: card.assignee_names, committee_ids: card.committee_ids })
  const [dueDate, setDueDate] = useState(card.due_date ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    await onSave({
      title: title.trim(),
      description: description.trim() || null,
      status,
      ...assignment,
      due_date: dueDate || null,
    })
    setSaving(false)
  }

  const label = { fontFamily: FONT, fontSize: 12.5, color: '#64748b', fontWeight: 700 } as const

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1a2744,#2d4a8a)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: FONT, flex: 1 }}>{canEdit ? 'แก้ไขงาน' : 'รายละเอียดงาน'}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 30, height: 30, color: '#fff', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18, display: 'grid', gap: 12 }}>
          <div>
            <label style={label}>หัวข้อ</label>
            <input value={title} onChange={event => setTitle(event.target.value)} disabled={!canEdit} style={{ ...INPUT_STYLE, marginTop: 4, width: '100%' }} />
          </div>
          <div>
            <label style={label}>รายละเอียด</label>
            <textarea value={description} onChange={event => setDescription(event.target.value)} disabled={!canEdit} rows={4} style={{ ...INPUT_STYLE, marginTop: 4, width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={label}>สถานะ</label>
              <select value={status} onChange={event => setStatus(event.target.value as Status)} disabled={!canEdit} style={{ ...INPUT_STYLE, marginTop: 4, width: '100%' }}>
                {COLUMNS.map(column => <option key={column.key} value={column.key}>{column.title}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>กำหนดเสร็จ</label>
              <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={!canEdit} style={{ ...INPUT_STYLE, marginTop: 4, width: '100%' }} />
            </div>
          </div>
          <div>
            <label style={label}>ผู้รับผิดชอบ (คน หรือ คณะกรรมการ)</label>
            <div style={{ marginTop: 4 }}>
              <AssigneePicker value={assignment} onChange={setAssignment} users={users} committees={committees} disabled={!canEdit} />
            </div>
          </div>
        </div>
        {canEdit && (
          <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            {canDelete ? (
              <button onClick={() => { onDelete(card); onClose() }} style={{ border: '1.5px solid #fecaca', borderRadius: 10, padding: '9px 14px', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 13 }}>ลบ</button>
            ) : (
              <span style={{ fontFamily: FONT, fontSize: 12, color: '#94a3b8' }}>{card.status === 'done' ? 'การ์ดใน Done ลบได้เฉพาะ Super Admin' : ''}</span>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 16px', background: '#fff', color: '#64748b', cursor: 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 13 }}>ยกเลิก</button>
              <button onClick={save} disabled={saving || !title.trim()} style={{ border: 'none', borderRadius: 10, padding: '9px 18px', background: '#1a2744', color: '#fff', cursor: 'pointer', fontFamily: FONT, fontWeight: 800, fontSize: 13 }}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function KanbanBoard() {
  const { user } = useAuthStore()
  const canEdit = canEditTasks(user?.role)
  const [cards, setCards] = useState<KanbanCard[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [committees, setCommittees] = useState<CommitteeOption[]>([])
  const [myCommitteeId, setMyCommitteeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [newAssignment, setNewAssignment] = useState<Assignment>(EMPTY_ASSIGNMENT)
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null)
  const [formOpen, setFormOpen] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768)

  const [search, setSearch] = useState('')
  const [committeeFilter, setCommitteeFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [dueFilter, setDueFilter] = useState<DueFilter>('all')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const canDeleteCard = (card: KanbanCard) => canEdit && (card.status !== 'done' || user?.role === 'super_admin')

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('kanban_cards')
      .select('*')
      .eq('deleted', false)
      .order('position', { ascending: true })
    if (error) {
      setError(error.message)
      setCards([])
    } else {
      setCards((data ?? []) as KanbanCard[])
    }
    setLoading(false)
  }

  useEffect(() => {
    // Standard fetch-on-mount pattern; load() sets loading/error state internally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    supabase.rpc('list_assignable_users').then(({ data }) => {
      if (data) setUsers(data as UserOption[])
    })
    // same order as the ทำเนียบ (Directory) page
    supabase.from('committees').select('id, name, code, color').eq('active', true).order('code', { ascending: true }).then(({ data }) => {
      if (data) setCommittees(data as CommitteeOption[])
    })
  }, [])

  useEffect(() => {
    if (!user?.member_id) return
    supabase.from('members').select('committee_id').eq('id', user.member_id).maybeSingle().then(({ data }) => {
      setMyCommitteeId((data?.committee_id as string | null) ?? null)
    })
  }, [user?.member_id])

  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const committeeById = useMemo(() => new Map(committees.map(c => [c.id, c])), [committees])
  const committeeRank = useMemo(() => new Map(committees.map((c, index) => [c.id, index])), [committees])

  const filteredCards = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const today = dateKey()
    const weekEnd = dateKey(7)
    return cards.filter(card => {
      if (committeeFilter === NO_COMMITTEE && card.committee_ids.length > 0) return false
      if (committeeFilter !== 'all' && committeeFilter !== NO_COMMITTEE && !card.committee_ids.includes(committeeFilter)) return false
      if (assigneeFilter === 'mine') {
        const mine = !!user && (card.assignee_ids.includes(user.id) || (!!myCommitteeId && card.committee_ids.includes(myCommitteeId)))
        if (!mine) return false
      } else if (assigneeFilter !== 'all' && !card.assignee_ids.includes(assigneeFilter)) return false
      if (dueFilter === 'overdue' && !(card.status !== 'done' && isOverdue(card.due_date))) return false
      if (dueFilter === 'week' && !(card.due_date && card.due_date >= today && card.due_date <= weekEnd)) return false
      if (dueFilter === 'nodate' && card.due_date) return false
      if (keyword) {
        const haystack = [
          card.title, card.description,
          ...card.assignee_ids.map(id => userById.get(id)?.name),
          ...card.assignee_names,
          ...card.committee_ids.map(id => committeeById.get(id)?.name),
        ].join(' ').toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
  }, [cards, search, committeeFilter, assigneeFilter, dueFilter, user, myCommitteeId, userById, committeeById])

  // Within each column, cards are grouped under their committee in ทำเนียบ order;
  // a card tagged with several committees sits under the first one in that order.
  const grouped = useMemo(() => {
    const result: Record<Status, { key: string; committee: CommitteeOption | null; cards: KanbanCard[] }[]> = { todo: [], in_progress: [], done: [] }
    for (const column of COLUMNS) {
      const buckets = new Map<string, KanbanCard[]>()
      for (const card of filteredCards) {
        if (card.status !== column.key) continue
        const primary = [...card.committee_ids]
          .filter(id => committeeRank.has(id))
          .sort((a, b) => (committeeRank.get(a) ?? 0) - (committeeRank.get(b) ?? 0))[0] ?? NO_COMMITTEE
        buckets.set(primary, [...(buckets.get(primary) ?? []), card])
      }
      result[column.key] = [...buckets.entries()]
        .sort(([a], [b]) => (a === NO_COMMITTEE ? Infinity : committeeRank.get(a) ?? 0) - (b === NO_COMMITTEE ? Infinity : committeeRank.get(b) ?? 0))
        .map(([key, list]) => ({ key, committee: key === NO_COMMITTEE ? null : committeeById.get(key) ?? null, cards: list }))
    }
    return result
  }, [filteredCards, committeeRank, committeeById])

  const activeFilterCount = [search.trim(), committeeFilter !== 'all', assigneeFilter !== 'all', dueFilter !== 'all'].filter(Boolean).length

  const createCard = async () => {
    if (!user || !title.trim() || saving) return
    setSaving(true)
    const payload = {
      title: title.trim(),
      status: 'todo' as Status,
      position: Date.now(),
      ...newAssignment,
      due_date: dueDate || null,
      created_by: user.id,
      deleted: false,
    }
    const { data, error } = await supabase.from('kanban_cards').insert(payload).select('*').single()
    if (error) {
      setError(error.message)
    } else if (data) {
      setCards(prev => [...prev, data as KanbanCard])
      setTitle('')
      setNewAssignment(EMPTY_ASSIGNMENT)
      setDueDate('')
      await logActivity(user, 'kanban.created', (data as KanbanCard).title, { kanban_id: (data as KanbanCard).id })
    }
    setSaving(false)
  }

  const updateCard = async (card: KanbanCard, patch: Partial<KanbanCard>) => {
    if (!user) return
    const before = cards
    setCards(prev => prev.map(item => item.id === card.id ? { ...item, ...patch } : item))

    const { data, error } = await supabase.from('kanban_cards').update(patch).eq('id', card.id).select('*').single()

    if (error) {
      setCards(before)
      setError(error.message)
      return
    }
    if (data) setCards(prev => prev.map(item => item.id === card.id ? (data as KanbanCard) : item))
    setEditingCard(null)
    await logActivity(user, 'kanban.updated', card.title, { kanban_id: card.id })
  }

  const deleteCard = async (card: KanbanCard) => {
    if (!user || !canDeleteCard(card)) return
    const before = cards
    setCards(prev => prev.filter(item => item.id !== card.id))
    const { error } = await supabase.from('kanban_cards').update({ deleted: true }).eq('id', card.id)
    if (error) {
      setCards(before)
      setError(error.message)
    } else {
      await logActivity(user, 'kanban.deleted', card.title, { kanban_id: card.id })
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canEdit || !user) return
    const { active, over } = event
    if (!over) return
    const card = cards.find(item => item.id === active.id)
    if (!card) return
    const newStatus = over.id as Status
    if (!COLUMNS.some(column => column.key === newStatus) || newStatus === card.status) return

    const oldStatus = card.status
    setCards(prev => prev.map(item => item.id === card.id ? { ...item, status: newStatus } : item))

    const { error } = await supabase.from('kanban_cards').update({ status: newStatus, position: Date.now() }).eq('id', card.id)
    if (error) {
      setCards(prev => prev.map(item => item.id === card.id ? { ...item, status: oldStatus } : item))
      setError(error.message)
    } else {
      await logActivity(user, 'kanban.moved', card.title, { kanban_id: card.id, from: oldStatus, to: newStatus })
    }
  }

  const resetFilters = () => {
    setSearch('')
    setCommitteeFilter('all')
    setAssigneeFilter('all')
    setDueFilter('all')
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <datalist id="kanban-assignee-options">
        {committees.map(c => <option key={`c-${c.id}`} value={c.name} />)}
        {users.map(item => <option key={`u-${item.id}`} value={item.name} />)}
      </datalist>

      {error && <div style={{ padding: 14, borderRadius: 14, background: '#fff7ed', color: '#9a3412', fontFamily: FONT, boxShadow: SHADOW }}>{error}</div>}

      {canEdit && (
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: SHADOW, overflow: 'hidden' }}>
          <button
            onClick={() => setFormOpen(prev => !prev)}
            className="md:hidden"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 'none', background: 'transparent', padding: '12px 16px', cursor: 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: 700, color: '#1a2744' }}
          >
            + เพิ่มงานใหม่
            <span style={{ fontSize: 12, color: '#64748b' }}>{formOpen ? 'ซ่อน ▲' : 'แสดง ▼'}</span>
          </button>
          <div className={`${formOpen ? 'grid' : 'hidden'} md:grid pt-0 md:pt-4`} style={{ gap: 10, paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto]" style={{ gap: 10 }}>
              <input
                value={title}
                onChange={event => setTitle(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') createCard() }}
                placeholder="เพิ่มงานใหม่..."
                style={INPUT_STYLE}
              />
              <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} style={INPUT_STYLE} />
              <button
                disabled={saving || !title.trim()}
                onClick={createCard}
                style={{ border: 'none', borderRadius: 12, padding: '10px 16px', background: title.trim() ? '#1a2744' : '#cbd5e1', color: '#fff', cursor: title.trim() ? 'pointer' : 'default', fontFamily: FONT, fontSize: 14 }}
              >
                เพิ่มงาน
              </button>
            </div>
            <AssigneePicker value={newAssignment} onChange={setNewAssignment} users={users} committees={committees} />
          </div>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 16, boxShadow: SHADOW, overflow: 'hidden' }}>
        <button
          onClick={() => setFiltersOpen(prev => !prev)}
          className="md:hidden"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 'none', background: 'transparent', padding: '12px 16px', cursor: 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: 700, color: '#1a2744' }}
        >
          🔍 ตัวกรอง{activeFilterCount ? ` (${activeFilterCount})` : ''}
          <span style={{ fontSize: 12, color: '#64748b' }}>{filtersOpen ? 'ซ่อน ▲' : 'แสดง ▼'}</span>
        </button>
        <div className={`${filtersOpen ? 'grid' : 'hidden'} md:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] pt-0 md:pt-4`} style={{ gap: 10, paddingLeft: 16, paddingRight: 16, paddingBottom: 16, alignItems: 'center' }}>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหาชื่องาน คน หรือคณะ..." style={INPUT_STYLE} />
          <select value={committeeFilter} onChange={event => setCommitteeFilter(event.target.value)} style={INPUT_STYLE}>
            <option value="all">ทุกคณะกรรมการ</option>
            {committees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NO_COMMITTEE}>ไม่ระบุคณะ</option>
          </select>
          <select value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)} style={INPUT_STYLE}>
            <option value="all">ทุกคน</option>
            <option value="mine">งานของฉัน / คณะของฉัน</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={dueFilter} onChange={event => setDueFilter(event.target.value as DueFilter)} style={INPUT_STYLE}>
            <option value="all">ทุกกำหนดเสร็จ</option>
            <option value="overdue">เกินกำหนด</option>
            <option value="week">ภายใน 7 วัน</option>
            <option value="nodate">ไม่มีกำหนด</option>
          </select>
          {activeFilterCount > 0 ? (
            <button onClick={resetFilters} style={{ border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '10px 14px', background: '#fff', color: '#64748b', cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
              ล้างตัวกรอง
            </button>
          ) : <span />}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 28, borderRadius: 18, background: '#fff', color: '#94a3b8', textAlign: 'center', fontFamily: FONT, boxShadow: SHADOW }}>กำลังโหลด...</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'clamp(240px, 85vw, 340px)', gap: 14, overflowX: 'auto', paddingBottom: 4 }}>
            {COLUMNS.map(column => {
              const groups = grouped[column.key]
              return (
                <Column
                  key={column.key}
                  status={column.key}
                  title={column.title}
                  tone={column.tone}
                  soft={column.soft}
                  groups={groups.length}
                  total={groups.reduce((sum, g) => sum + g.cards.length, 0)}
                >
                  {groups.map(group => {
                    const color = group.committee?.color ?? '#94a3b8'
                    return (
                      <div key={group.key} style={{ display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT, fontSize: 12, lineHeight: 1.5, fontWeight: 700, color }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.committee?.name ?? 'ไม่ระบุคณะ'}</span>
                          <span style={{ color: '#94a3b8', fontWeight: 600 }}>({group.cards.length})</span>
                        </div>
                        {group.cards.map(card => (
                          <CardView
                            key={card.id}
                            card={card}
                            tone={column.tone}
                            users={userById}
                            committees={committeeById}
                            canDrag={canEdit}
                            canDelete={canDeleteCard(card)}
                            onEdit={setEditingCard}
                            onDelete={deleteCard}
                          />
                        ))}
                      </div>
                    )
                  })}
                </Column>
              )
            })}
          </div>
        </DndContext>
      )}

      {editingCard && (
        <EditModal
          card={editingCard}
          users={users}
          committees={committees}
          canEdit={canEdit}
          canDelete={canDeleteCard(editingCard)}
          onClose={() => setEditingCard(null)}
          onSave={patch => updateCard(editingCard, patch)}
          onDelete={deleteCard}
        />
      )}
    </div>
  )
}
