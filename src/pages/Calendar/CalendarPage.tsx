import { useEffect, useMemo, useState } from 'react'
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, getDay, parse, startOfWeek } from 'date-fns'
import { th } from 'date-fns/locale/th'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { supabase } from '../../lib/supabase'

type TaskCalendarStatus = 'scheduled' | 'no_date'

interface CalendarTask {
  id: string
  code?: string | null
  title: string
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  completed: boolean
  deleted: boolean
  sections?: {
    title?: string | null
    color?: string | null
  } | null
  task_types?: {
    name?: string | null
    color?: string | null
  } | null
  task_members?: {
    members?: {
      name_th?: string | null
    } | null
  }[]
}

interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  resource: CalendarTask
}

const locales = { th }

const localizer = dateFnsLocalizer({
  format,
  parse,
  // weekStartsOn: 1 = Monday; date-fns v4 removed locale from startOfWeek options
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
})

const SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'

function combineDateTime(dateValue: string, timeValue?: string | null) {
  const time = timeValue ? timeValue.slice(0, 5) : '00:00'
  return new Date(`${dateValue}T${time}:00`)
}

function endOfAllDay(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return date
}

function eventFromTask(task: CalendarTask): CalendarEvent | null {
  const firstDate = task.start_date ?? task.end_date
  if (!firstDate) return null

  const hasTime = Boolean(task.start_time || task.end_time)
  const start = combineDateTime(firstDate, task.start_time)
  let end: Date

  if (hasTime) {
    const endDate = task.end_date ?? firstDate
    end = task.end_time ? combineDateTime(endDate, task.end_time) : new Date(start.getTime() + 60 * 60 * 1000)
    if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000)
  } else {
    end = endOfAllDay(task.end_date ?? firstDate)
  }

  return {
    id: task.id,
    title: task.title,
    start,
    end,
    allDay: !hasTime,
    resource: task,
  }
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function formatTime(value?: string | null) {
  if (!value) return ''
  return value.slice(0, 5)
}

function taskStatus(task: CalendarTask): TaskCalendarStatus {
  return task.start_date || task.end_date ? 'scheduled' : 'no_date'
}

function assigneeText(task: CalendarTask) {
  const names = (task.task_members ?? [])
    .map(item => item.members?.name_th)
    .filter((name): name is string => Boolean(name))

  return names.length ? names.join(', ') : 'ยังไม่ระบุผู้รับผิดชอบ'
}

export default function CalendarPage() {
  const [tasks, setTasks] = useState<CalendarTask[]>([])
  const [selectedTask, setSelectedTask] = useState<CalendarTask | null>(null)
  const [view, setView] = useState<View>('month')
  const [date, setDate] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // react-big-calendar's "+N งาน" day popup (.rbc-overlay) is portaled to
  // document.body and only clamps itself against overflowing to the right —
  // near the left/bottom edge of the screen it can render partly off-screen.
  // Nudge it back into the viewport after it mounts/repositions.
  useEffect(() => {
    const clampOverlay = () => {
      const el = document.querySelector('.rbc-overlay') as HTMLElement | null
      if (!el) return
      const margin = 12
      const rect = el.getBoundingClientRect()
      const currentLeft = parseFloat(el.style.left || '0')
      const currentTop = parseFloat(el.style.top || '0')

      let nextLeft = currentLeft
      let nextTop = currentTop
      if (rect.right > window.innerWidth - margin) nextLeft -= rect.right - (window.innerWidth - margin)
      if (rect.left < margin) nextLeft += margin - rect.left
      if (rect.bottom > window.innerHeight - margin) nextTop -= rect.bottom - (window.innerHeight - margin)
      if (rect.top < margin) nextTop += margin - rect.top

      el.style.left = `${nextLeft}px`
      el.style.top = `${nextTop}px`
      el.style.maxWidth = `calc(100vw - ${margin * 2}px)`
      el.style.maxHeight = `calc(100vh - ${margin * 2}px)`
      el.style.overflowY = 'auto'
    }

    const observer = new MutationObserver(() => requestAnimationFrame(clampOverlay))
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true

    const loadTasks = async () => {
      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from('tasks')
        .select('*, sections(title, color), task_types(name, color), task_members(members(name_th))')
        .eq('deleted', false)
        .order('start_date', { ascending: true, nullsFirst: false })
        .order('end_date', { ascending: true, nullsFirst: false })

      if (!active) return

      if (error) {
        setError(error.message)
        setTasks([])
      } else {
        setTasks((data ?? []) as CalendarTask[])
      }

      setLoading(false)
    }

    loadTasks()

    return () => {
      active = false
    }
  }, [])

  const events = useMemo(() => {
    return tasks
      .map(eventFromTask)
      .filter((event): event is CalendarEvent => Boolean(event))
  }, [tasks])

  const counts = useMemo(() => {
    return tasks.reduce((acc, task) => {
      if (task.completed) acc.completed += 1
      if (taskStatus(task) === 'scheduled') acc.scheduled += 1
      else acc.noDate += 1
      return acc
    }, {
      total: tasks.length,
      scheduled: 0,
      noDate: 0,
      completed: 0,
    })
  }, [tasks])

  const noDateTasks = useMemo(() => {
    return tasks.filter(task => taskStatus(task) === 'no_date' && !task.completed)
  }, [tasks])

  return (
    <div style={{
      height: '100%',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: '#eef0f7',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
        padding: '16px 24px',
        background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)',
        borderBottom: '1px solid #e4e8f2',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #1a2744, #2d4a8a)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Anuphan, sans-serif',
          fontWeight: 700,
          fontSize: 18,
          boxShadow: '0 4px 14px rgba(26,39,68,0.28)',
        }}>
          C
        </div>
        <div>
          <h1 style={{
            margin: 0,
            fontFamily: 'Anuphan, sans-serif',
            fontSize: 20,
            lineHeight: 1.2,
            color: '#1e293b',
          }}>
            ปฏิทินงาน
          </h1>
          <p style={{
            margin: '2px 0 0',
            fontFamily: 'Anuphan, sans-serif',
            fontSize: 13.5,
            color: '#94a3b8',
          }}>
            {counts.scheduled} งานในปฏิทิน จาก {counts.total} งานทั้งหมด
          </p>
        </div>

        <div style={{
          marginLeft: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(96px, auto))',
          gap: 10,
        }}>
          {[
            { label: 'มีวันกำหนด', value: counts.scheduled, color: '#1a2744', bg: '#eef2ff' },
            { label: 'ยังไม่ระบุวัน', value: counts.noDate, color: '#64748b', bg: '#f8fafc' },
            { label: 'เสร็จแล้ว', value: counts.completed, color: '#047857', bg: '#ecfdf5' },
          ].map(item => (
            <div key={item.label} style={{
              minWidth: 96,
              padding: '8px 12px',
              borderRadius: 12,
              background: item.bg,
              border: '1px solid rgba(15,23,42,0.06)',
            }}>
              <div style={{
                fontFamily: 'Anuphan, sans-serif',
                color: item.color,
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 1,
              }}>
                {item.value}
              </div>
              <div style={{
                marginTop: 4,
                fontFamily: 'Anuphan, sans-serif',
                color: '#64748b',
                fontSize: 12,
                whiteSpace: 'nowrap',
              }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]" style={{
        flex: 1,
        minHeight: 0,
        gap: 16,
        padding: 18,
        overflowY: 'auto',
      }}>
        <div className="min-h-[70vh] lg:min-h-0" style={{
          minWidth: 0,
          borderRadius: 18,
          background: '#fff',
          boxShadow: SHADOW,
          border: '1px solid rgba(15,23,42,0.05)',
          overflow: 'hidden',
        }}>
          {loading && (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{
                width: 36,
                height: 36,
                border: '3px solid #e2e8f0',
                borderTopColor: '#1a2744',
                borderRadius: '50%',
                animation: 'spin 0.75s linear infinite',
              }} />
            </div>
          )}

          {!loading && error && (
            <div style={{
              margin: 18,
              padding: 18,
              borderRadius: 16,
              background: '#fff7ed',
              color: '#9a3412',
              fontFamily: 'Anuphan, sans-serif',
            }}>
              โหลดปฏิทินไม่สำเร็จ: {error}
            </div>
          )}

          {!loading && !error && (
            <div className="yec-calendar" style={{ height: '100%', minHeight: 0 }}>
              <Calendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                titleAccessor="title"
                culture="th"
                date={date}
                view={view}
                views={['month', 'week', 'day', 'agenda']}
                popup
                onNavigate={setDate}
                onView={setView}
                onSelectEvent={(event: CalendarEvent) => setSelectedTask(event.resource)}
                eventPropGetter={(event: CalendarEvent) => {
                  const task = event.resource
                  const color = task.completed ? '#64748b' : task.task_types?.color ?? '#1a2744'
                  return {
                    style: {
                      backgroundColor: color,
                      borderColor: color,
                      color: '#fff',
                      borderRadius: 8,
                      opacity: task.completed ? 0.65 : 1,
                    },
                  }
                }}
                messages={{
                  today: 'วันนี้',
                  previous: 'ก่อนหน้า',
                  next: 'ถัดไป',
                  month: 'เดือน',
                  week: 'สัปดาห์',
                  day: 'วัน',
                  agenda: 'รายการ',
                  date: 'วันที่',
                  time: 'เวลา',
                  event: 'งาน',
                  noEventsInRange: 'ไม่มีงานในช่วงวันที่เลือก',
                  showMore: total => `+${total} งาน`,
                }}
              />
            </div>
          )}
        </div>

        <aside style={{
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <section style={{
            borderRadius: 18,
            background: '#fff',
            boxShadow: SHADOW,
            border: '1px solid rgba(15,23,42,0.05)',
            padding: 16,
          }}>
            <h2 style={{
              margin: 0,
              fontFamily: 'Anuphan, sans-serif',
              color: '#1e293b',
              fontSize: 16,
            }}>
              รายละเอียดงาน
            </h2>

            {selectedTask ? (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  display: 'inline-flex',
                  padding: '4px 9px',
                  borderRadius: 999,
                  background: `${selectedTask.task_types?.color ?? '#1a2744'}18`,
                  color: selectedTask.task_types?.color ?? '#1a2744',
                  fontFamily: 'Anuphan, sans-serif',
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  {selectedTask.task_types?.name ?? 'ไม่ระบุประเภท'}
                </div>
                <h3 style={{
                  margin: '10px 0 0',
                  fontFamily: 'Anuphan, sans-serif',
                  color: '#1e293b',
                  fontSize: 17,
                  lineHeight: 1.35,
                }}>
                  {selectedTask.title}
                </h3>
                {selectedTask.description && (
                  <p style={{
                    margin: '6px 0 0',
                    fontFamily: 'Anuphan, sans-serif',
                    color: '#64748b',
                    fontSize: 13.5,
                    lineHeight: 1.5,
                  }}>
                    {selectedTask.description}
                  </p>
                )}
                <dl style={{
                  margin: '14px 0 0',
                  display: 'grid',
                  gap: 10,
                  fontFamily: 'Anuphan, sans-serif',
                  fontSize: 13,
                }}>
                  <div>
                    <dt style={{ color: '#94a3b8' }}>วันที่</dt>
                    <dd style={{ color: '#1e293b', marginTop: 2 }}>
                      {formatDate(selectedTask.start_date ?? selectedTask.end_date)}
                      {selectedTask.end_date && selectedTask.end_date !== selectedTask.start_date
                        ? ` - ${formatDate(selectedTask.end_date)}`
                        : ''}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: '#94a3b8' }}>เวลา</dt>
                    <dd style={{ color: '#1e293b', marginTop: 2 }}>
                      {selectedTask.start_time || selectedTask.end_time
                        ? `${formatTime(selectedTask.start_time) || '00:00'} - ${formatTime(selectedTask.end_time) || 'ต่อเนื่อง 1 ชม.'}`
                        : 'ทั้งวัน'}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: '#94a3b8' }}>สถานะ</dt>
                    <dd style={{ color: selectedTask.completed ? '#047857' : '#b45309', marginTop: 2 }}>
                      {selectedTask.completed ? 'เสร็จแล้ว' : 'ยังไม่เสร็จ'}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: '#94a3b8' }}>ผู้รับผิดชอบ</dt>
                    <dd style={{ color: '#1e293b', marginTop: 2 }}>{assigneeText(selectedTask)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p style={{
                margin: '10px 0 0',
                fontFamily: 'Anuphan, sans-serif',
                color: '#94a3b8',
                fontSize: 13.5,
                lineHeight: 1.5,
              }}>
                เลือกงานบนปฏิทินเพื่อดูรายละเอียด
              </p>
            )}
          </section>

          <section style={{
            flex: 1,
            minHeight: 0,
            borderRadius: 18,
            background: '#fff',
            boxShadow: SHADOW,
            border: '1px solid rgba(15,23,42,0.05)',
            padding: 16,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <h2 style={{
              margin: 0,
              fontFamily: 'Anuphan, sans-serif',
              color: '#1e293b',
              fontSize: 16,
            }}>
              งานที่ยังไม่ระบุวัน
            </h2>
            <div style={{ marginTop: 12, overflowY: 'auto', display: 'grid', gap: 8 }}>
              {noDateTasks.length === 0 ? (
                <div style={{
                  padding: '28px 10px',
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontFamily: 'Anuphan, sans-serif',
                  fontSize: 13.5,
                }}>
                  ไม่มีงานค้างที่ยังไม่ระบุวัน
                </div>
              ) : noDateTasks.map(task => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  style={{
                    width: '100%',
                    border: '1px solid #e4e8f2',
                    borderRadius: 12,
                    background: selectedTask?.id === task.id ? '#eef2ff' : '#f8fafc',
                    padding: 11,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    fontFamily: 'Anuphan, sans-serif',
                    color: '#1e293b',
                    fontSize: 14.5,
                    lineHeight: 1.35,
                  }}>
                    {task.title}
                  </div>
                  <div style={{
                    marginTop: 5,
                    fontFamily: 'Anuphan, sans-serif',
                    color: '#94a3b8',
                    fontSize: 12.5,
                  }}>
                    {task.sections?.title ?? 'ไม่ระบุสถานะ'} · {task.task_types?.name ?? 'ไม่ระบุประเภท'}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
