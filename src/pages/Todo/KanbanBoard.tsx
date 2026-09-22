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

type Status = KanbanCard['status']
type UserOption = Pick<User, 'id' | 'name' | 'email'>

const COLUMNS: { key: Status; title: string; tone: string; soft: string }[] = [
  { key: 'todo', title: 'To Do', tone: '#64748b', soft: '#f1f5f9' },
  { key: 'in_progress', title: 'In Progress', tone: '#2563eb', soft: '#eff6ff' },
  { key: 'done', title: 'Done', tone: '#059669', soft: '#ecfdf5' },
]

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isOverdue(date?: string | null) {
  return !!date && date < todayKey()
}

function formatDate(date?: string | null) {
  if (!date) return ''
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`))
}

function assigneeLabel(card: KanbanCard) {
  return card.assignee?.name ?? card.assignee_name ?? ''
}

// Typed name matching a known user keeps the real assignee_id link (so it
// still shows up correctly elsewhere); anything else is just stored as text.
function resolveAssignee(typed: string, users: UserOption[]) {
  const name = typed.trim()
  if (!name) return { assignee_id: null as string | null, assignee_name: null as string | null }
  const match = users.find(item => item.name.trim().toLowerCase() === name.toLowerCase())
  return match ? { assignee_id: match.id, assignee_name: match.name } : { assignee_id: null, assignee_name: name }
}

function CardView({ card, tone, canEdit, onEdit, onDelete }: {
  card: KanbanCard
  tone: string
  canEdit: boolean
  onEdit: (card: KanbanCard) => void
  onDelete: (card: KanbanCard) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id, disabled: !canEdit })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10, boxShadow: '0 16px 32px rgba(15,23,42,0.18)' }
    : undefined

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
        cursor: canEdit ? 'grab' : 'pointer',
        ...style,
      }}
      {...listeners}
      {...attributes}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontFamily: FONT, fontSize: 14, color: '#1e293b', wordBreak: 'break-word' }}>{card.title}</div>
        {canEdit && (
          <button
            onPointerDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); onDelete(card) }}
            style={{ flexShrink: 0, border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>
      {card.description && (
        <div style={{ marginTop: 6, fontFamily: FONT, fontSize: 12.5, color: '#64748b', whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{card.description}</div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {card.due_date && (
          <span style={{
            borderRadius: 999,
            padding: '3px 9px',
            background: card.status !== 'done' && isOverdue(card.due_date) ? '#fef2f2' : '#f8fafc',
            color: card.status !== 'done' && isOverdue(card.due_date) ? '#b91c1c' : '#64748b',
            fontFamily: FONT,
            fontSize: 11.5,
          }}>
            📅 {formatDate(card.due_date)}
          </span>
        )}
        {assigneeLabel(card) && (
          <span style={{ borderRadius: 999, padding: '3px 9px', background: '#eff6ff', color: '#1d4ed8', fontFamily: FONT, fontSize: 11.5 }}>
            {assigneeLabel(card)}
          </span>
        )}
      </div>
    </div>
  )
}

function Column({ status, title, tone, soft, cards, canEdit, onEdit, onDelete }: {
  status: Status
  title: string
  tone: string
  soft: string
  cards: KanbanCard[]
  canEdit: boolean
  onEdit: (card: KanbanCard) => void
  onDelete: (card: KanbanCard) => void
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: tone, color: '#fff' }}>
        <h2 style={{ margin: 0, fontFamily: FONT, fontSize: 15.5, fontWeight: 700 }}>{title}</h2>
        <span style={{ minWidth: 26, textAlign: 'center', borderRadius: 999, padding: '3px 8px', background: 'rgba(255,255,255,0.85)', color: tone, fontFamily: FONT, fontSize: 12, fontWeight: 700 }}>{cards.length}</span>
      </div>
      <div style={{ display: 'grid', gap: 10, minHeight: 80, padding: 12 }}>
        {cards.length
          ? cards.map(card => <CardView key={card.id} card={card} tone={tone} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />)
          : <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontFamily: FONT, fontSize: 13 }}>ว่างอยู่</div>}
      </div>
    </div>
  )
}

function EditModal({ card, users, canEdit, onClose, onSave, onDelete }: {
  card: KanbanCard
  users: UserOption[]
  canEdit: boolean
  onClose: () => void
  onSave: (patch: Partial<KanbanCard>) => Promise<void>
  onDelete: (card: KanbanCard) => void
}) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [status, setStatus] = useState<Status>(card.status)
  const [assigneeName, setAssigneeName] = useState(assigneeLabel(card))
  const [dueDate, setDueDate] = useState(card.due_date ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    await onSave({
      title: title.trim(),
      description: description.trim() || null,
      status,
      ...resolveAssignee(assigneeName, users),
      due_date: dueDate || null,
    })
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1a2744,#2d4a8a)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: FONT, flex: 1 }}>{canEdit ? 'แก้ไขงาน' : 'รายละเอียดงาน'}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 30, height: 30, color: '#fff', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontFamily: FONT, fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>หัวข้อ</label>
            <input value={title} onChange={event => setTitle(event.target.value)} disabled={!canEdit} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 14 }} />
          </div>
          <div>
            <label style={{ fontFamily: FONT, fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>รายละเอียด</label>
            <textarea value={description} onChange={event => setDescription(event.target.value)} disabled={!canEdit} rows={4} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 14, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontFamily: FONT, fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>สถานะ</label>
              <select value={status} onChange={event => setStatus(event.target.value as Status)} disabled={!canEdit} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#fff', outline: 'none', fontFamily: FONT, fontSize: 14 }}>
                {COLUMNS.map(column => <option key={column.key} value={column.key}>{column.title}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontFamily: FONT, fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>กำหนดเสร็จ</label>
              <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={!canEdit} style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 14 }} />
            </div>
          </div>
          <div>
            <label style={{ fontFamily: FONT, fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>ผู้รับผิดชอบ</label>
            <input
              value={assigneeName}
              onChange={event => setAssigneeName(event.target.value)}
              disabled={!canEdit}
              list="kanban-assignee-options"
              placeholder="พิมพ์ชื่อผู้รับผิดชอบ..."
              style={{ marginTop: 4, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 14 }}
            />
          </div>
        </div>
        {canEdit && (
          <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <button onClick={() => { onDelete(card); onClose() }} style={{ border: '1.5px solid #fecaca', borderRadius: 10, padding: '9px 14px', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 13 }}>ลบ</button>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [assigneeName, setAssigneeName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('kanban_cards')
      .select('*, assignee:assignee_id(id, name, email)')
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
    supabase.from('users').select('id, name, email').eq('active', true).order('name').then(({ data }) => {
      if (data) setUsers(data as UserOption[])
    })
  }, [])

  const byStatus = useMemo(() => {
    const grouped: Record<Status, KanbanCard[]> = { todo: [], in_progress: [], done: [] }
    for (const card of cards) grouped[card.status].push(card)
    return grouped
  }, [cards])

  const createCard = async () => {
    if (!user || !title.trim() || saving) return
    setSaving(true)
    const payload = {
      title: title.trim(),
      status: 'todo' as Status,
      position: Date.now(),
      ...resolveAssignee(assigneeName, users),
      due_date: dueDate || null,
      created_by: user.id,
      deleted: false,
    }
    const { data, error } = await supabase
      .from('kanban_cards')
      .insert(payload)
      .select('*, assignee:assignee_id(id, name, email)')
      .single()
    if (error) {
      setError(error.message)
    } else if (data) {
      setCards(prev => [...prev, data as KanbanCard])
      setTitle('')
      setAssigneeName('')
      setDueDate('')
      await logActivity(user, 'kanban.created', (data as KanbanCard).title, { kanban_id: (data as KanbanCard).id })
    }
    setSaving(false)
  }

  const updateCard = async (card: KanbanCard, patch: Partial<KanbanCard>) => {
    if (!user) return
    const before = cards
    setCards(prev => prev.map(item => item.id === card.id ? { ...item, ...patch } : item))

    const { data, error } = await supabase
      .from('kanban_cards')
      .update(patch)
      .eq('id', card.id)
      .select('*, assignee:assignee_id(id, name, email)')
      .single()

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
    if (!user || !canEdit) return
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

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <datalist id="kanban-assignee-options">
        {users.map(item => <option key={item.id} value={item.name} />)}
      </datalist>

      {error && <div style={{ padding: 14, borderRadius: 14, background: '#fff7ed', color: '#9a3412', fontFamily: FONT, boxShadow: SHADOW }}>{error}</div>}

      {canEdit && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, padding: 16, background: '#fff', borderRadius: 16, boxShadow: SHADOW }}>
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') createCard() }}
            placeholder="เพิ่มงานใหม่..."
            style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 14 }}
          />
          <input
            value={assigneeName}
            onChange={event => setAssigneeName(event.target.value)}
            list="kanban-assignee-options"
            placeholder="ผู้รับผิดชอบ..."
            style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 14 }}
          />
          <input
            type="date"
            value={dueDate}
            onChange={event => setDueDate(event.target.value)}
            style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 14 }}
          />
          <button
            disabled={saving || !title.trim()}
            onClick={createCard}
            style={{ border: 'none', borderRadius: 12, padding: '10px 16px', background: title.trim() ? '#1a2744' : '#cbd5e1', color: '#fff', cursor: title.trim() ? 'pointer' : 'default', fontFamily: FONT, fontSize: 14 }}
          >
            เพิ่มงาน
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 28, borderRadius: 18, background: '#fff', color: '#94a3b8', textAlign: 'center', fontFamily: FONT, boxShadow: SHADOW }}>กำลังโหลด...</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'clamp(240px, 85vw, 340px)', gap: 14, overflowX: 'auto', paddingBottom: 4 }}>
            {COLUMNS.map(column => (
              <Column
                key={column.key}
                status={column.key}
                title={column.title}
                tone={column.tone}
                soft={column.soft}
                cards={byStatus[column.key]}
                canEdit={canEdit}
                onEdit={setEditingCard}
                onDelete={deleteCard}
              />
            ))}
          </div>
        </DndContext>
      )}

      {editingCard && (
        <EditModal
          card={editingCard}
          users={users}
          canEdit={canEdit}
          onClose={() => setEditingCard(null)}
          onSave={patch => updateCard(editingCard, patch)}
          onDelete={deleteCard}
        />
      )}
    </div>
  )
}
