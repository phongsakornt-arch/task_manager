import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { Attachment, ChecklistItem, Task } from '../types'

function toArray<T>(value: T[] | Record<string, T> | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function getDueStatus(date?: string, completed?: boolean) {
  if (!date || completed) return null
  const diff = differenceInCalendarDays(parseISO(date), new Date())
  if (diff < 0) return { label: `เลยกำหนด ${Math.abs(diff)} วัน`, color: '#ef4444' }
  if (diff === 0) return { label: 'วันนี้', color: '#f59e0b' }
  if (diff === 1) return { label: 'พรุ่งนี้', color: '#2563eb' }
  if (diff <= 7) return { label: 'สัปดาห์นี้', color: '#059669' }
  return null
}

function asDate(date?: string) {
  if (!date) return null
  return new Date(`${date.slice(0, 10)}T00:00:00`)
}

function formatThaiDate(date?: string) {
  const value = asDate(date)
  if (!value) return ''
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  }).format(value)
}

function formatTaskDateRange(startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return ''
  if (!startDate) return formatThaiDate(endDate)
  if (!endDate || startDate === endDate) return formatThaiDate(startDate)

  const start = asDate(startDate)
  const end = asDate(endDate)
  if (!start || !end) return ''

  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  if (sameMonth) {
    const endText = new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit' }).format(end)
    return `${start.getDate()}-${end.getDate()} ${endText}`
  }
  return `${formatThaiDate(startDate)} - ${formatThaiDate(endDate)}`
}

function formatTimeRange(startTime?: string, endTime?: string) {
  const start = startTime?.slice(0, 5)
  const end = endTime?.slice(0, 5)
  if (start && end) return `${start} - ${end} น.`
  if (start) return `${start} น.`
  if (end) return `${end} น.`
  return ''
}

function initials(name?: string) {
  return (name ?? '').trim().charAt(0) || '?'
}

interface Props {
  task: Task
  onComplete: (id: string, completed: boolean) => void
  onClick: (task: Task) => void
  canEdit?: boolean
  subtasks?: Task[]
  compact?: boolean
}

type PersonAvatar = {
  id: string
  title: string
  label: string
  photoUrl?: string
  isStaff?: boolean
}

export default function TaskCard({ task, onComplete, onClick, canEdit = true, subtasks = [], compact = false }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit || compact,
  })

  const dueDate = task.end_date || task.start_date
  const dueStatus = getDueStatus(dueDate, task.completed)
  const dateRange = formatTaskDateRange(task.start_date, task.end_date)
  const timeRange = formatTimeRange(task.start_time, task.end_time)
  const checklist = toArray(task.checklist as ChecklistItem[] | Record<string, ChecklistItem>)
  const attachments = toArray(task.attachments as Attachment[] | Record<string, Attachment>)
  const checkDone = checklist.filter(item => item.done).length
  const checkTotal = checklist.length
  const subDone = subtasks.filter(item => item.completed).length
  const members = task.task_members ?? []
  const assigneeMembers = members.filter(item => item.member_id)
  const committeeAssignees = Array.from(
    new Map(
      members
        .filter(item => !item.member_id && item.committee_id && item.committees)
        .map(item => [item.committee_id as string, item]),
    ).values(),
  )
  const staff = task.task_staff ?? []
  const calendarReady = task.calendar_event_url || task.calendar_sync_status === 'synced'
  const done = task.completed

  const staffAvatars: PersonAvatar[] = staff.map(item => {
    const label = item.users?.members?.nickname || item.users?.members?.name_th || item.users?.name || item.users?.email
    return {
      id: `staff-${item.id}`,
      title: item.users?.members?.name_th || item.users?.name || item.users?.email || '',
      label: initials(label),
      isStaff: true,
    }
  })
  const memberAvatars: PersonAvatar[] = assigneeMembers.map(item => ({
    id: item.id,
    title: item.members?.name_th || item.members?.email || '',
    label: initials(item.members?.nickname || item.members?.name_th || item.members?.email),
    photoUrl: item.members?.photo_url,
  }))
  const peopleAvatars = [...staffAvatars, ...memberAvatars]
  const committeeLimit = compact ? 1 : 2

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        background: done ? '#f8fafc' : '#fff',
        borderRadius: compact ? 10 : 14,
        border: done ? '1px solid #dbe4ee' : '1.5px solid #dbeafe',
        boxShadow: isDragging ? '0 18px 44px rgba(15,23,42,0.2)' : '0 8px 24px rgba(30,64,175,0.08)',
        padding: compact ? '12px 13px' : '18px 20px',
        cursor: 'pointer',
        position: 'relative',
        userSelect: 'none',
      }}
      className="task-card"
      onClick={() => onClick(task)}
      {...attributes}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{
            margin: 0,
            color: done ? '#94a3b8' : '#0f172a',
            fontFamily: 'Anuphan, sans-serif',
            fontSize: compact ? 15 : 21,
            fontWeight: 800,
            lineHeight: 1.25,
            textDecoration: done ? 'line-through' : 'none',
            overflowWrap: 'anywhere',
          }}>
            {task.title || 'ไม่มีชื่องาน'}
          </h3>

          {(dateRange || timeRange) && (
            <div style={{
              marginTop: 9,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              color: '#667085',
              fontFamily: 'Anuphan, sans-serif',
              fontSize: compact ? 12.5 : 16,
              fontWeight: 800,
            }}>
              {dateRange && <span>📅 {dateRange}</span>}
              {timeRange && <span>⏰ {timeRange}</span>}
            </div>
          )}
        </div>

        <button
          disabled={!canEdit}
          title={done ? 'ทำเครื่องหมายว่ายังไม่เสร็จ' : 'ทำเครื่องหมายว่าเสร็จ'}
          onClick={event => {
            event.stopPropagation()
            if (canEdit) onComplete(task.id, !done)
          }}
          style={{
            flexShrink: 0,
            height: 32,
            minWidth: 32,
            borderRadius: 999,
            border: done ? '1px solid #10b981' : '1px solid #d7deeb',
            background: done ? '#10b981' : '#fff',
            color: done ? '#fff' : '#94a3b8',
            cursor: canEdit ? 'pointer' : 'not-allowed',
            fontWeight: 900,
            fontSize: 15,
            boxShadow: done ? '0 8px 18px rgba(16,185,129,0.2)' : 'none',
          }}
        >
          {done ? '✓' : ''}
        </button>
      </div>

      {task.description && !compact && (
        <p style={{
          margin: '10px 0 0',
          fontSize: 14.5,
          color: '#667085',
          lineHeight: 1.55,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {task.description}
        </p>
      )}

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {task.task_types && (
          <span style={{
            fontSize: compact ? 11.5 : 13,
            padding: '4px 10px',
            borderRadius: 999,
            fontWeight: 900,
            background: `${task.task_types.color}18`,
            color: task.task_types.color,
          }}>
            {task.task_types.name}
          </span>
        )}
        {committeeAssignees.slice(0, committeeLimit).map(item => (
          <span key={item.id} title={item.committees?.name} style={{
            fontSize: compact ? 11 : 12.5,
            padding: '4px 10px',
            borderRadius: 999,
            fontWeight: 800,
            background: `${item.committees?.color || '#64748b'}18`,
            color: item.committees?.color || '#475569',
          }}>
            🏛 {item.committees?.code || item.committees?.name}
          </span>
        ))}
        {committeeAssignees.length > committeeLimit && (
          <span style={{
            fontSize: compact ? 11 : 12.5,
            padding: '4px 10px',
            borderRadius: 999,
            fontWeight: 800,
            background: '#f1f5f9',
            color: '#64748b',
          }}>
            +{committeeAssignees.length - committeeLimit} คกก.
          </span>
        )}
        {dueStatus && (
          <span style={{
            fontSize: compact ? 11.5 : 13,
            padding: '4px 10px',
            borderRadius: 999,
            fontWeight: 900,
            background: `${dueStatus.color}16`,
            color: dueStatus.color,
          }}>
            {dueStatus.label}
          </span>
        )}
        {task.code && !compact && (
          <span style={{
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 999,
            fontWeight: 800,
            background: '#f1f5f9',
            color: '#64748b',
          }}>
            {task.code}
          </span>
        )}
      </div>

      {checkTotal > 0 && !compact && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ flex: 1, height: 7, borderRadius: 999, background: '#e7edf6', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, width: `${(checkDone / checkTotal) * 100}%`, background: checkDone === checkTotal ? '#10b981' : '#c9a84c' }} />
            </div>
            <span style={{ fontSize: 12, color: '#667085', fontWeight: 800 }}>
              {checkDone}/{checkTotal}
            </span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          {attachments.length > 0 && (
            <span style={pillStyle}>🔗 {attachments.length}</span>
          )}
          {task.drive_folder_url && (
            <a href={task.drive_folder_url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} style={{ ...pillStyle, background: '#dcfce7', color: '#047857', textDecoration: 'none' }}>
              📁 Drive
            </a>
          )}
          {(calendarReady || task.calendar_sync_status) && (
            <span style={{ ...pillStyle, background: calendarReady ? '#dcfce7' : '#f1f5f9', color: calendarReady ? '#047857' : '#64748b' }}>
              Calendar: {calendarReady ? 'Up-to-date' : task.calendar_sync_status}
            </span>
          )}
          {subtasks.length > 0 && !compact && (
            <span style={{ ...pillStyle, background: '#eef2ff', color: '#4f46e5' }}>
              Subtask {subDone}/{subtasks.length}
            </span>
          )}
        </div>

        {peopleAvatars.length > 0 && (
          <div style={{ display: 'flex', flexShrink: 0 }}>
            {peopleAvatars.slice(0, 4).map((person, index) => (
              <div key={person.id} title={person.isStaff ? `เจ้าหน้าที่: ${person.title}` : person.title} style={{
                width: compact ? 22 : 26,
                height: compact ? 22 : 26,
                borderRadius: '50%',
                border: person.isStaff ? '2px solid #c9a84c' : '2px solid #fff',
                marginLeft: index === 0 ? 0 : -8,
                background: '#1a2744',
                color: '#c9a84c',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontFamily: 'Anuphan, sans-serif',
                fontWeight: 900,
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(15,23,42,0.16)',
              }}>
                {person.photoUrl ? <img src={person.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : person.label}
              </div>
            ))}
            {peopleAvatars.length > 4 && (
              <div style={{ width: compact ? 22 : 26, height: compact ? 22 : 26, borderRadius: '50%', border: '2px solid #fff', marginLeft: -8, background: '#f1f5f9', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 900 }}>
                +{peopleAvatars.length - 4}
              </div>
            )}
          </div>
        )}
      </div>

      {!compact && (
        <div
          {...(canEdit ? listeners : {})}
          onClick={event => event.stopPropagation()}
          className="drag-handle"
          title="ลากเพื่อย้ายคอลัมน์"
          style={{
            position: 'absolute',
            top: 10,
            right: 11,
            color: '#94a3b8',
            cursor: canEdit ? 'grab' : 'default',
            opacity: 0,
            transition: 'opacity 0.15s',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ::
        </div>
      )}
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 999,
  background: '#f8fafc',
  color: '#667085',
  border: '1px solid #e2e8f0',
  fontWeight: 800,
  lineHeight: 1.2,
}
