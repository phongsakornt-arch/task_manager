import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import TaskModal from '../../components/TaskModal'
import { useAuthStore } from '../../stores/authStore'
import { canEditTasks, canDeleteTasks } from '../../lib/permissions'
import type { Task } from '../../types'

type DueStatus = 'overdue' | 'today' | 'soon' | 'scheduled' | 'unscheduled'
type FilterKey = DueStatus | 'all'
type DateFilterKey = 'all' | 'today' | 'week' | 'month'

interface PendingTask {
  id: string
  title: string
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  due_date?: string | null
  due_status: DueStatus
  days_until_due?: number | null
  section_title?: string | null
  task_type_name?: string | null
  task_type_color?: string | null
  staff_count: number
  staff_names: string[]
  committee_count: number
  committee_names: string[]
  participant_count: number
  participant_names: string[]
  assignee_count: number
  assignee_names: string[]
  created_at: string
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'overdue', label: 'เกินกำหนด' },
  { key: 'today', label: 'ครบวันนี้' },
  { key: 'soon', label: 'ใกล้ครบกำหนด' },
  { key: 'unscheduled', label: 'ยังไม่ระบุวัน' },
]

const DATE_FILTERS: { key: DateFilterKey; label: string }[] = [
  { key: 'all', label: 'ทุกช่วงเวลา' },
  { key: 'today', label: 'วันนี้' },
  { key: 'week', label: 'สัปดาห์นี้' },
  { key: 'month', label: 'เดือนนี้' },
]

const STATUS_META: Record<DueStatus, { label: string; color: string; bg: string; soft: string }> = {
  overdue: { label: 'เกินกำหนด', color: '#b91c1c', bg: '#fef2f2', soft: '#fff1f2' },
  today: { label: 'ครบกำหนดวันนี้', color: '#b45309', bg: '#fffbeb', soft: '#fff7ed' },
  soon: { label: 'ใกล้ครบกำหนด', color: '#047857', bg: '#ecfdf5', soft: '#f0fdf4' },
  scheduled: { label: 'มีกำหนด', color: '#1d4ed8', bg: '#eff6ff', soft: '#f8fbff' },
  unscheduled: { label: 'ยังไม่ระบุวัน', color: '#64748b', bg: '#f8fafc', soft: '#f8fafc' },
}

const FONT = 'Anuphan, sans-serif'
const SHADOW = '0 14px 36px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function formatDate(value?: string | null) {
  if (!value) return 'ยังไม่ระบุ'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function dueText(task: PendingTask) {
  if (task.days_until_due == null) return 'ยังไม่ระบุวัน'
  if (task.days_until_due < 0) return `เกิน ${Math.abs(task.days_until_due)} วัน`
  if (task.days_until_due === 0) return 'วันนี้'
  return `เหลือ ${task.days_until_due} วัน`
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function dateRangeLabel(filter: DateFilterKey) {
  const today = new Date()
  if (filter === 'today') return formatDate(dateKey(today))
  if (filter === 'week') {
    const day = today.getDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    const start = addDays(today, mondayOffset)
    const end = addDays(start, 6)
    return `${formatDate(dateKey(start))} - ${formatDate(dateKey(end))}`
  }
  if (filter === 'month') {
    return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(today)
  }
  return 'ทุกช่วงเวลา'
}

function matchesDateFilter(date: string | null | undefined, filter: DateFilterKey) {
  if (filter === 'all') return true
  if (!date) return false

  const today = new Date()
  const target = new Date(`${date}T00:00:00`)

  if (filter === 'today') return date === dateKey(today)
  if (filter === 'week') {
    const day = today.getDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    const start = new Date(`${dateKey(addDays(today, mondayOffset))}T00:00:00`)
    const end = new Date(`${dateKey(addDays(start, 6))}T23:59:59`)
    return target >= start && target <= end
  }
  if (filter === 'month') {
    return target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth()
  }
  return true
}

function listText(items?: string[] | null, empty = 'ยังไม่ระบุ') {
  const clean = Array.from(new Set((items ?? []).map(item => item?.trim()).filter(Boolean)))
  return clean.length ? clean.join(', ') : empty
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function printHtml(title: string, body: string) {
  const win = window.open('', '_blank', 'width=1200,height=860')
  if (!win) return
  win.document.write(`<!doctype html>
    <html lang="th">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #eef2f8;
            color: #102039;
            font-family: Anuphan, Arial, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .page {
            width: 100%;
            min-height: 100vh;
            padding: 28px;
            background:
              radial-gradient(circle at top right, rgba(201,168,76,0.16), transparent 32%),
              linear-gradient(135deg, #f8fbff 0%, #eef3fa 100%);
          }
          .cover {
            border-radius: 24px;
            padding: 24px 26px;
            background: linear-gradient(135deg, #142348 0%, #203e77 64%, #c79a2b 100%);
            color: white;
            box-shadow: 0 20px 60px rgba(20,35,72,0.20);
          }
          .eyebrow { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.75; font-weight: 800; }
          h1 { margin: 8px 0 0; font-size: 27px; line-height: 1.2; }
          .subtitle { margin-top: 8px; color: rgba(255,255,255,0.75); font-size: 14px; }
          .metric { display: none; }
          .task-list { display: grid; gap: 10px; margin-top: 16px; }
          .task {
            break-inside: avoid;
            position: relative;
            border-radius: 18px;
            background: white;
            border: 1px solid #dbe4ee;
            padding: 16px 114px 16px 18px;
            box-shadow: 0 10px 28px rgba(15,23,42,0.06);
          }
          .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
          .chip { border-radius: 999px; padding: 4px 9px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 800; }
          .task-title { margin: 0; font-size: 17px; line-height: 1.35; color: #0f172a; font-weight: 900; }
          .people { margin-top: 10px; color: #475569; font-size: 12px; line-height: 1.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .people b { color: #142348; }
          .due {
            position: absolute;
            top: 16px;
            right: 16px;
            max-width: 92px;
            border-radius: 999px;
            display: grid;
            place-items: center;
            padding: 6px 10px;
            text-align: center;
            font-weight: 900;
            font-size: 11px;
            line-height: 1.2;
          }
          .footer {
            margin-top: 18px;
            color: #64748b;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
          }
          @page { size: A4 portrait; margin: 10mm; }
          @media print {
            body { background: white; }
            .page { min-height: auto; padding: 0; background: white; }
            .cover, .task { box-shadow: none; }
          }
        </style>
      </head>
      <body>${body}</body>
    </html>
  `)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}

export default function PendingPage() {
  const [tasks, setTasks] = useState<PendingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [dateFilter, setDateFilter] = useState<DateFilterKey>('all')
  const [search, setSearch] = useState('')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null)
  const { user } = useAuthStore()
  const canEdit = canEditTasks(user?.role)
  const canDelete = canDeleteTasks(user?.role)

  const loadPendingTasks = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('pending_tasks')
      .select('*')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      setTasks([])
    } else {
      setTasks((data ?? []) as PendingTask[])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    // Standard fetch-on-mount pattern; loadPendingTasks sets loading/error state internally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPendingTasks()
  }, [loadPendingTasks])

  const openTask = async (id: string) => {
    setTaskLoadError(null)
    const { data, error } = await supabase.from('tasks').select('*').eq('id', id).maybeSingle()
    if (error || !data) {
      setTaskLoadError(error?.message ?? 'ไม่พบข้อมูลงานนี้')
      return
    }
    setSelectedTask(data as Task)
  }

  const closeTask = () => {
    setSelectedTask(null)
    loadPendingTasks()
  }

  const counts = useMemo(() => {
    return tasks.reduce<Record<FilterKey, number>>((acc, task) => {
      acc.all += 1
      acc[task.due_status] += 1
      return acc
    }, {
      all: 0,
      overdue: 0,
      today: 0,
      soon: 0,
      scheduled: 0,
      unscheduled: 0,
    })
  }, [tasks])

  const dateCounts = useMemo(() => {
    return DATE_FILTERS.reduce<Record<DateFilterKey, number>>((acc, item) => {
      acc[item.key] = tasks.filter(task => matchesDateFilter(task.due_date, item.key)).length
      return acc
    }, {
      all: 0,
      today: 0,
      week: 0,
      month: 0,
    })
  }, [tasks])

  const filteredTasks = useMemo(() => {
    const keyword = normalize(search)

    return tasks.filter(task => {
      const matchesFilter = filter === 'all' || task.due_status === filter
      const matchesDate = matchesDateFilter(task.due_date, dateFilter)
      const haystack = [
        task.title,
        task.section_title,
        task.task_type_name,
        ...(task.staff_names ?? []),
        ...(task.committee_names ?? []),
        ...(task.participant_names ?? []),
      ].map(normalize).join(' ')

      return matchesFilter && matchesDate && (!keyword || haystack.includes(keyword))
    })
  }, [dateFilter, filter, search, tasks])

  const exportPendingCsv = () => {
    downloadCsv(`pending-tasks-${dateFilter}.csv`, [
      ['title', 'due_date', 'due_status', 'days_until_due', 'section', 'task_type', 'staff', 'committees', 'participants'],
      ...filteredTasks.map(task => [
        task.title,
        task.due_date,
        STATUS_META[task.due_status].label,
        task.days_until_due,
        task.section_title,
        task.task_type_name,
        listText(task.staff_names, ''),
        listText(task.committee_names, ''),
        listText(task.participant_names, ''),
      ]),
    ])
  }

  const printPending = () => {
    const generatedAt = new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: false,
    }).format(new Date())
    const rangeText = dateRangeLabel(dateFilter)
    const rows = filteredTasks.map(task => {
      const meta = STATUS_META[task.due_status]
      const taskType = task.task_type_name ? `<span class="chip">${escapeHtml(task.task_type_name)}</span>` : ''
      const section = task.section_title ? `<span class="chip">${escapeHtml(task.section_title)}</span>` : ''
      return `
        <article class="task">
          <div>
            <div class="chips">
              <span class="chip" style="background:${meta.bg};color:${meta.color}">${escapeHtml(meta.label)}</span>
              ${taskType}
              ${section}
            </div>
            <h2 class="task-title">${escapeHtml(task.title)}</h2>
            <div class="people">
              <b>กำหนด:</b> ${escapeHtml(formatDate(task.due_date))}
              &nbsp; · &nbsp; <b>เจ้าหน้าที่ที่ดูแล:</b> ${escapeHtml(listText(task.staff_names))}
              &nbsp; · &nbsp; <b>กรรมการที่ได้รับมอบหมาย/เข้าร่วม:</b> ${escapeHtml(listText([...(task.committee_names ?? []), ...(task.participant_names ?? [])]))}
            </div>
          </div>
          <div class="due" style="background:${meta.soft};color:${meta.color}">
            ${escapeHtml(dueText(task))}
          </div>
        </article>
      `
    }).join('')

    printHtml('รายงานงานค้าง YEC Task Manager', `
      <main class="page">
        <section class="cover">
          <div>
            <div class="eyebrow">YEC Task Manager</div>
            <h1>รายงานงานค้าง</h1>
            <div class="subtitle">สรุปงานที่ยังไม่เสร็จสำหรับผู้บริหาร · ช่วงเวลา ${escapeHtml(rangeText)} · สร้างเมื่อ ${escapeHtml(generatedAt)}</div>
          </div>
          <div class="metric">
            <strong>${filteredTasks.length}</strong>
            <span>รายการที่แสดง</span>
          </div>
        </section>

        <section class="task-list">${rows}</section>
        <footer class="footer">
          <span>YEC Task Manager · หอการค้าไทย</span>
          <span>เอกสารสำหรับติดตามงานภายใน</span>
        </footer>
      </main>
    `)
  }

  return (
    <div style={pageStyle}>
      <div style={toolbarStyle}>
        <div style={pageIconStyle}>P</div>
        <div>
          <h1 style={headingStyle}>งานค้าง</h1>
          <p style={subheadingStyle}>{filteredTasks.length} จาก {tasks.length} งานที่ยังไม่เสร็จ</p>
        </div>

        <div style={{ marginLeft: 'auto', flex: '1 1 220px', minWidth: 0 }}>
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="ค้นหางาน เจ้าหน้าที่ กรรมการ ประเภท..."
            style={searchStyle}
          />
        </div>
        <button onClick={exportPendingCsv} style={lightButtonStyle}>CSV</button>
        <button onClick={printPending} style={darkButtonStyle}>PDF</button>
      </div>

      <div style={contentStyle}>
        <div style={dateFilterBarStyle}>
          <div style={{ color: '#64748b', fontSize: 13, fontWeight: 900 }}>ช่วงเวลาสำหรับ Export</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {DATE_FILTERS.map(item => {
              const isActive = dateFilter === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => setDateFilter(item.key)}
                  style={{
                    ...dateFilterButtonStyle,
                    background: isActive ? '#1a2744' : '#fff',
                    borderColor: isActive ? '#1a2744' : '#dbe4ee',
                    color: isActive ? '#fff' : '#475569',
                  }}
                >
                  {item.label}
                  <span style={{ opacity: 0.72, marginLeft: 6 }}>{dateCounts[item.key]}</span>
                </button>
              )
            })}
          </div>
          <div style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12.5, fontWeight: 800 }}>{dateRangeLabel(dateFilter)}</div>
        </div>

        <div style={filterGridStyle}>
          {FILTERS.map(item => {
            const isActive = filter === item.key
            const meta = item.key === 'all'
              ? { color: '#1a2744', bg: '#fff' }
              : STATUS_META[item.key]

            return (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                style={{
                  ...filterCardStyle,
                  border: isActive ? `1.5px solid ${meta.color}` : '1px solid rgba(15,23,42,0.06)',
                  background: isActive ? meta.bg : '#fff',
                }}
              >
                <div style={{ color: meta.color, fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{counts[item.key]}</div>
                <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>{item.label}</div>
              </button>
            )
          })}
        </div>

        {loading && (
          <div style={{ display: 'grid', gap: 12 }}>
            {Array.from({ length: 5 }).map((_, index) => <div key={index} style={skeletonStyle} />)}
          </div>
        )}

        {!loading && error && <div style={errorStyle}>โหลดงานค้างไม่สำเร็จ: {error}</div>}
        {taskLoadError && <div style={errorStyle}>เปิดรายละเอียดงานไม่สำเร็จ: {taskLoadError}</div>}

        {!loading && !error && filteredTasks.length === 0 && <div style={emptyStyle}>ไม่พบงานค้างตามเงื่อนไขที่เลือก</div>}

        {!loading && !error && filteredTasks.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {filteredTasks.map(task => {
              const meta = STATUS_META[task.due_status]
              const committeeText = listText([...(task.committee_names ?? []), ...(task.participant_names ?? [])])

              return (
                <article
                  key={task.id}
                  style={{ ...taskCardStyle, cursor: 'pointer' }}
                  onClick={() => openTask(task.id)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <span style={{ ...pillStyle, background: meta.bg, color: meta.color }}>{meta.label}</span>
                      {task.task_type_name && <span style={{ ...pillStyle, background: `${task.task_type_color ?? '#1a2744'}18`, color: task.task_type_color ?? '#1a2744' }}>{task.task_type_name}</span>}
                      {task.section_title && <span style={mutedInlineStyle}>{task.section_title}</span>}
                    </div>

                    <h2 style={taskTitleStyle}>{task.title}</h2>

                    <div style={metaLineStyle}>
                      <span style={metaLineItemStyle}>กำหนด: <strong>{formatDate(task.due_date)}</strong></span>
                      <span style={metaLineItemStyle}>เจ้าหน้าที่ที่ดูแล: <strong>{listText(task.staff_names)}</strong></span>
                      <span style={metaLineItemStyle}>กรรมการที่ได้รับมอบหมาย/เข้าร่วม: <strong>{committeeText}</strong></span>
                    </div>
                  </div>

                  <div style={{ ...dueBoxStyle, background: meta.soft, color: meta.color }}>{dueText(task)}</div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={closeTask}
        />
      )}
    </div>
  )
}

const pageStyle: CSSProperties = {
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  background: '#eef2f8',
  fontFamily: FONT,
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 16,
  padding: '16px 24px',
  background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)',
  borderBottom: '1px solid #e4e8f2',
  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
  flexShrink: 0,
}

const pageIconStyle: CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 18,
  background: 'linear-gradient(135deg, #1a2744, #2d4a8a)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 900,
  boxShadow: '0 10px 24px rgba(26,39,68,0.25)',
}

const headingStyle: CSSProperties = { margin: 0, fontSize: 25, lineHeight: 1.15, color: '#17213a', fontWeight: 900 }
const subheadingStyle: CSSProperties = { margin: '5px 0 0', fontSize: 14, color: '#7b8aa3' }
const searchStyle: CSSProperties = { width: 'min(360px, 100%)', padding: '12px 16px', borderRadius: 16, border: '1.5px solid #dbe4ee', outline: 'none', background: '#f8fafc', color: '#1e293b', fontFamily: FONT, fontSize: 14 }
const lightButtonStyle: CSSProperties = { border: 'none', borderRadius: 16, padding: '13px 16px', background: '#f1f5f9', color: '#334155', cursor: 'pointer', fontFamily: FONT, fontWeight: 800, fontSize: 13 }
const darkButtonStyle: CSSProperties = { ...lightButtonStyle, background: '#1a2744', color: '#fff' }
const contentStyle: CSSProperties = { flex: 1, overflowY: 'auto', padding: 24 }
const dateFilterBarStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16, padding: 14, borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid rgba(15,23,42,0.05)' }
const dateFilterButtonStyle: CSSProperties = { border: '1.5px solid #dbe4ee', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontFamily: FONT, fontWeight: 900, fontSize: 13 }
const filterGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }
const filterCardStyle: CSSProperties = { borderRadius: 16, padding: '13px 14px', boxShadow: SHADOW, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s, transform 0.15s', fontFamily: FONT }
const skeletonStyle: CSSProperties = { height: 132, borderRadius: 20, background: 'linear-gradient(90deg, #f8fafc, #eef2f7, #f8fafc)', boxShadow: SHADOW }
const errorStyle: CSSProperties = { padding: 18, borderRadius: 18, background: '#fff7ed', color: '#9a3412', boxShadow: SHADOW }
const emptyStyle: CSSProperties = { minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 20, background: '#fff', color: '#94a3b8', fontSize: 15, boxShadow: SHADOW }
const taskCardStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px', gap: 18, padding: 20, borderRadius: 22, background: '#fff', boxShadow: SHADOW, border: '1px solid rgba(15,23,42,0.05)' }
const pillStyle: CSSProperties = { padding: '5px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 800 }
const mutedInlineStyle: CSSProperties = { color: '#94a3b8', fontSize: 12.5, fontWeight: 700 }
const taskTitleStyle: CSSProperties = { margin: '11px 0 0', fontSize: 22, lineHeight: 1.3, color: '#17213a', fontWeight: 900 }
const metaLineStyle: CSSProperties = { marginTop: 13, display: 'flex', flexWrap: 'wrap', gap: 12, color: '#66758d', fontSize: 13.5, lineHeight: 1.5 }
const metaLineItemStyle: CSSProperties = { minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const dueBoxStyle: CSSProperties = { minWidth: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 18, fontWeight: 900, fontSize: 16, textAlign: 'center', padding: '10px 12px' }
