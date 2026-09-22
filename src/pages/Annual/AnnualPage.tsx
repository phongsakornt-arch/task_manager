import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { canUseAiCreate } from '../../lib/permissions'
import { useAuthStore } from '../../stores/authStore'
import type { Section, Task, TaskType } from '../../types'

type StatusFilter = 'all' | 'pending' | 'done'

const SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'

const MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
]

const QUARTERS = [
  { title: 'QUARTER 1', sub: 'มกราคม - มีนาคม', months: [0, 1, 2] },
  { title: 'QUARTER 2', sub: 'เมษายน - มิถุนายน', months: [3, 4, 5] },
  { title: 'QUARTER 3', sub: 'กรกฎาคม - กันยายน', months: [6, 7, 8] },
  { title: 'QUARTER 4', sub: 'ตุลาคม - ธันวาคม', months: [9, 10, 11] },
]

function taskDate(task: Task) {
  return task.start_date || task.end_date || ''
}

function taskYear(task: Task) {
  const date = taskDate(task)
  return date ? Number(date.slice(0, 4)) : null
}

function taskMonth(task: Task) {
  const date = taskDate(task)
  return date ? Number(date.slice(5, 7)) - 1 : -1
}

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function formatDateRange(start?: string | null, end?: string | null) {
  const first = start || end
  if (!first) return 'ยังไม่ระบุวัน'

  const formatOne = (value: string) => new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(`${value}T00:00:00`))

  if (!end || end === first) return formatOne(first)
  return `${formatOne(first)} - ${formatOne(end)}`
}

function taskColor(task: Task) {
  return task.task_types?.color || task.sections?.color || '#1d4ed8'
}

function sortTasks(a: Task, b: Task) {
  const ad = taskDate(a) || '9999-99-99'
  const bd = taskDate(b) || '9999-99-99'
  if (ad !== bd) return ad.localeCompare(bd)
  return a.title.localeCompare(b.title, 'th')
}

export default function AnnualPage() {
  const { user } = useAuthStore()
  const canAiReport = canUseAiCreate(user?.role)
  const [tasks, setTasks] = useState<Task[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [sectionId, setSectionId] = useState('')
  const [taskTypeIds, setTaskTypeIds] = useState<string[]>([])
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  // เริ่มแบบย่อบนมือถือ (จอแคบกว่า md) เพื่อไม่ให้ตัวกรองเต็มจอบังเนื้อหา — บนจอใหญ่เริ่มแบบขยายตามเดิม
  const [filtersCollapsed, setFiltersCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // AI Report
  const [aiReportOpen, setAiReportOpen] = useState(false)
  const [aiReportLoading, setAiReportLoading] = useState(false)
  const [aiReport, setAiReport] = useState<{ report: string; stats: { total: number; done: number; pending: number; rate: string } } | null>(null)
  const [aiReportError, setAiReportError] = useState<string | null>(null)
  const reportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true

    const loadAnnual = async () => {
      setLoading(true)
      setError(null)

      const [tasksRes, sectionsRes, typesRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('*, sections(*), task_types(*), task_members(*, members(name_th))')
          .eq('deleted', false)
          .order('start_date', { ascending: true, nullsFirst: false })
          .order('end_date', { ascending: true, nullsFirst: false }),
        supabase.from('sections').select('*').eq('active', true).order('sort_order'),
        supabase.from('task_types').select('*').order('name'),
      ])

      if (!active) return

      const firstError = tasksRes.error || sectionsRes.error || typesRes.error
      if (firstError) {
        setError(firstError.message)
        setTasks([])
      } else {
        const nextTasks = (tasksRes.data ?? []) as Task[]
        setTasks(nextTasks)
        setSections((sectionsRes.data ?? []) as Section[])
        setTaskTypes((typesRes.data ?? []) as TaskType[])
        const availableYear = nextTasks.map(taskYear).filter((item): item is number => Boolean(item)).sort((a, b) => b - a)[0]
        if (availableYear) setYear(current => nextTasks.some(task => taskYear(task) === current) ? current : availableYear)
      }

      setLoading(false)
    }

    loadAnnual()

    return () => {
      active = false
    }
  }, [])

  const yearOptions = useMemo(() => {
    const years = new Set(tasks.map(taskYear).filter((item): item is number => Boolean(item)))
    years.add(new Date().getFullYear())
    return [...years].sort((a, b) => b - a)
  }, [tasks])

  const filteredTasks = useMemo(() => {
    const keyword = normalize(search)
    return tasks.filter(task => {
      const matchesYear = taskYear(task) === year
      const matchesSection = !sectionId || task.section_id === sectionId
      const matchesType = taskTypeIds.length === 0 || (!!task.task_type_id && taskTypeIds.includes(task.task_type_id))
      const matchesStatus = status === 'all' || (status === 'done' ? task.completed : !task.completed)
      const haystack = [
        task.title,
        task.description,
        task.sections?.title,
        task.task_types?.name,
        ...(task.task_members ?? []).map(item => item.members?.name_th ?? ''),
      ].map(normalize).join(' ')

      return matchesYear && matchesSection && matchesType && matchesStatus && (!keyword || haystack.includes(keyword))
    })
  }, [search, sectionId, status, taskTypeIds, tasks, year])

  const byMonth = useMemo(() => {
    const buckets: Record<number, Task[]> = {}
    Array.from({ length: 12 }, (_, index) => { buckets[index] = [] })
    filteredTasks.forEach(task => {
      const month = taskMonth(task)
      if (month >= 0 && month < 12) buckets[month].push(task)
    })
    Object.values(buckets).forEach(items => items.sort(sortTasks))
    return buckets
  }, [filteredTasks])

  const counts = useMemo(() => {
    const dated = filteredTasks.filter(task => taskDate(task)).length
    const done = filteredTasks.filter(task => task.completed).length
    return {
      total: filteredTasks.length,
      dated,
      done,
      pending: filteredTasks.length - done,
      noDateInYear: tasks.filter(task => !taskDate(task) && (status === 'all' || (status === 'done' ? task.completed : !task.completed))).length,
    }
  }, [filteredTasks, status, tasks])

  const clearFilters = () => {
    setSectionId('')
    setTaskTypeIds([])
    setStatus('all')
    setSearch('')
  }

  const selectedTypeLabel = taskTypeIds.length
    ? taskTypes.filter(type => taskTypeIds.includes(type.id)).map(type => type.name).join(', ')
    : 'ทุกประเภท'

  const selectedSectionLabel = sectionId ? sections.find(section => section.id === sectionId)?.title ?? 'Section' : 'ทุกสถานะบอร์ด'
  const selectedStatusLabel = status === 'done' ? 'เสร็จแล้ว' : status === 'pending' ? 'ยังไม่เสร็จ' : 'ทั้งหมด'
  const filterSummary = `${year + 543} · ${selectedSectionLabel} · ${selectedTypeLabel} · ${selectedStatusLabel}${search.trim() ? ` · "${search.trim()}"` : ''}`

  const toggleTaskType = (id: string) => {
    setTaskTypeIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  const printReport = () => { window.print() }

  const generateAiReport = async () => {
    if (aiReportLoading) return
    const yearTasks = tasks.filter(t => taskYear(t) === year && !t.deleted)
    if (!yearTasks.length) { setAiReportError('ไม่มีงานในปีนี้'); setAiReportOpen(true); return }
    setAiReportOpen(true); setAiReportLoading(true); setAiReportError(null); setAiReport(null)
    const { data, error } = await supabase.functions.invoke('ai-annual-report', {
      body: {
        year,
        tasks: yearTasks.map(t => ({
          title: t.title,
          section: t.sections?.title ?? null,
          type: t.task_types?.name ?? null,
          start_date: t.start_date ?? null,
          end_date: t.end_date ?? null,
          completed: t.completed,
        })),
      },
    })
    setAiReportLoading(false)
    if (error || data?.error) { setAiReportError(error?.message ?? data?.error); return }
    setAiReport(data)
  }

  return (
    <div className="annual-shell" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#eef0f7' }}>
      <style>{`
        @page {
          size: A4 landscape;
          margin: 10mm;
        }
        @media print {
          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          html, body, #root { height: auto !important; overflow: visible !important; }
          aside, nav { display: none !important; }
          main { height: auto !important; overflow: visible !important; display: block !important; }
          .annual-shell { height: auto !important; min-height: auto !important; overflow: visible !important; display: block !important; background: #fff !important; }
          .annual-toolbar, .annual-controls { display: none !important; }
          .annual-content { height: auto !important; min-height: auto !important; overflow: visible !important; display: block !important; padding: 0 !important; }
          .annual-report-cover, .annual-summary, .annual-quarter-board, .annual-no-date-note { display: none !important; }
          .annual-print-report { display: block !important; }
          .annual-print-hero {
            border-radius: 0 0 18px 18px;
            padding: 14mm 15mm 10mm;
            margin: -10mm -10mm 7mm;
            background: linear-gradient(135deg, #142348 0%, #234987 62%, #b88b22 100%);
            color: #fff;
            position: relative;
            overflow: hidden;
          }
          .annual-print-title { margin: 0; font-family: Anuphan, sans-serif; font-size: 28px; line-height: 1.1; font-weight: 900; }
          .annual-print-subtitle { margin-top: 6px; font-family: Anuphan, sans-serif; color: rgba(255,255,255,0.78); font-size: 12px; }
          .annual-print-year {
            position: absolute;
            right: 15mm;
            top: 12mm;
            border-radius: 999px;
            padding: 7px 16px;
            background: #fff;
            color: #1d3c78;
            font-family: Anuphan, sans-serif;
            font-size: 16px;
            font-weight: 900;
          }
          .annual-print-month-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5mm; }
          .annual-print-month {
            break-inside: avoid;
            page-break-inside: avoid;
            border: 1px solid #d7e0ec;
            border-radius: 12px;
            overflow: hidden;
            background: #fff;
            min-height: 36mm;
          }
          .annual-print-month-head {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            padding: 7px 9px;
            background: linear-gradient(135deg, #18284f, #2d5594 65%, #a47d22);
            color: #fff;
            font-family: Anuphan, sans-serif;
            font-size: 13px;
            font-weight: 900;
          }
          .annual-print-items { display: grid; gap: 4px; padding: 7px; }
          .annual-print-task {
            border-radius: 8px;
            border: 1px solid #dbe5f0;
            background: #f8fbff;
            padding: 5px 7px;
            border-left-width: 4px;
          }
          .annual-print-task-title { font-family: Anuphan, sans-serif; color: #0f172a; font-size: 10.5px; line-height: 1.28; font-weight: 900; }
          .annual-print-task-date { margin-top: 2px; font-family: Anuphan, sans-serif; color: #64748b; font-size: 9px; }
          .annual-print-empty { padding: 11px 12px; color: #b8c4d4; font-family: Anuphan, sans-serif; font-size: 11px; }
          .annual-print-footer { margin-top: 5mm; text-align: right; color: #64748b; font-family: Anuphan, sans-serif; font-size: 10px; }
        }
      `}</style>

      <div className="annual-toolbar flex flex-col md:flex-row md:items-center" style={{ gap: 16, padding: '16px 24px', background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)', borderBottom: '1px solid #e4e8f2', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', flexShrink: 0 }}>
        <div className="flex items-center" style={{ gap: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, boxShadow: '0 4px 14px rgba(26,39,68,0.28)' }}>Y</div>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 20, lineHeight: 1.2, color: '#1e293b' }}>แผนรายปี</h1>
            <p style={{ margin: '2px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#94a3b8' }}>{counts.dated} งานในปฏิทิน ปี {year + 543}</p>
          </div>
        </div>

        <div className="flex flex-wrap md:ml-auto" style={{ gap: 10, alignItems: 'center' }}>
          <button onClick={clearFilters} style={{ border: 'none', borderRadius: 12, padding: '10px 13px', background: '#f1f5f9', color: '#334155', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>ล้างตัวกรอง</button>
          {canAiReport && (
            <button onClick={generateAiReport} disabled={aiReportLoading} style={{ border: 'none', borderRadius: 12, padding: '10px 14px', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(124,58,237,0.28)' }}>
              {aiReportLoading ? <><span style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />กำลังสรุป...</> : <>✨ AI รายงาน</>}
            </button>
          )}
          <button onClick={printReport} style={{ border: 'none', borderRadius: 12, padding: '10px 14px', background: '#1a2744', color: '#fff', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>Print Report</button>
        </div>
      </div>

      <div
        className={`annual-controls ${filtersCollapsed ? '' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-[120px_minmax(220px,1fr)_minmax(180px,0.8fr)_130px_minmax(220px,1.2fr)]'}`}
        style={{ display: 'grid', gridTemplateColumns: filtersCollapsed ? 'minmax(0, 1fr) auto' : undefined, gap: 10, padding: filtersCollapsed ? '10px 16px' : 16, background: '#fff', borderBottom: '1px solid #e4e8f2', alignItems: 'start' }}
      >
        {filtersCollapsed ? (
          <>
            <div style={{ minHeight: 40, display: 'flex', alignItems: 'center', color: '#64748b', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filterSummary}</div>
            <button onClick={() => setFiltersCollapsed(false)} style={chipButtonStyle}>แสดงตัวกรอง</button>
          </>
        ) : (
          <>
        <select value={year} onChange={event => setYear(Number(event.target.value))} style={controlStyle}>
          {yearOptions.map(item => <option key={item} value={item}>{item + 543}</option>)}
        </select>
        <select value={sectionId} onChange={event => setSectionId(event.target.value)} style={controlStyle}>
          <option value="">ทุกสถานะบอร์ด</option>
          {sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}
        </select>
        <select value="" onChange={event => event.target.value && toggleTaskType(event.target.value)} style={controlStyle}>
          <option value="">ทุกประเภท</option>
          {taskTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
        <select value={status} onChange={event => setStatus(event.target.value as StatusFilter)} style={controlStyle}>
          <option value="all">ทั้งหมด</option>
          <option value="pending">ยังไม่เสร็จ</option>
          <option value="done">เสร็จแล้ว</option>
        </select>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหางาน ผู้รับผิดชอบ ประเภท..." style={controlStyle} />
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setTaskTypeIds([])} style={{ ...chipButtonStyle, background: taskTypeIds.length === 0 ? '#eff6ff' : '#fff', borderColor: taskTypeIds.length === 0 ? '#93c5fd' : '#dbe4ee', color: taskTypeIds.length === 0 ? '#1d4ed8' : '#64748b' }}>ทุกประเภท</button>
          {taskTypes.map(type => {
            const selected = taskTypeIds.includes(type.id)
            const color = type.color || '#1d4ed8'
            return (
              <button
                key={type.id}
                onClick={() => toggleTaskType(type.id)}
                style={{ ...chipButtonStyle, background: selected ? `${color}18` : '#fff', borderColor: selected ? color : '#dbe4ee', color: selected ? color : '#64748b' }}
              >
                {selected ? '✓ ' : ''}{type.name}
              </button>
            )
          })}
        </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setFiltersCollapsed(true)} style={chipButtonStyle}>ยุบตัวกรอง</button>
            </div>
          </>
        )}
      </div>

      <div className="annual-content" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
        <section className="annual-report-cover" style={{ borderRadius: 22, padding: '20px 22px', marginBottom: 16, color: '#fff', background: 'linear-gradient(135deg, #142348 0%, #224884 62%, #c49a2c 100%)', boxShadow: SHADOW, display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'end' }}>
          <div>
            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.74, fontWeight: 900 }}>YEC Task Manager</div>
            <h2 style={{ margin: '8px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 26, lineHeight: 1.15 }}>แผนรายปี {year + 543}</h2>
            <div style={{ marginTop: 8, fontFamily: 'Anuphan, sans-serif', color: 'rgba(255,255,255,0.78)', fontSize: 13.5 }}>QUARTER 1-4 · {selectedTypeLabel}</div>
          </div>
          <div style={{ textAlign: 'right', fontFamily: 'Anuphan, sans-serif' }}>
            <div style={{ fontSize: 34, lineHeight: 1, fontWeight: 900 }}>{counts.dated}</div>
            <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.75)', fontSize: 12.5 }}>งานในแผนรายปี</div>
          </div>
        </section>

        {!loading && (
          <section className="annual-print-report" style={{ display: 'none' }}>
            <div className="annual-print-hero">
              <h1 className="annual-print-title">กิจกรรมประจำปี</h1>
              <div className="annual-print-subtitle">ภาพรวมทั้งปี · {counts.dated} งาน · YEC Task Manager · {selectedTypeLabel}</div>
              <div className="annual-print-year">YEAR: {year + 543}</div>
            </div>

            <div className="annual-print-month-grid">
              {MONTHS.map((monthName, month) => {
                const monthTasks = byMonth[month]
                return (
                  <section className="annual-print-month" key={monthName}>
                    <div className="annual-print-month-head">
                      <span>{monthName}</span>
                      <span>{monthTasks.length}/{monthTasks.length} งาน</span>
                    </div>
                    {monthTasks.length ? (
                      <div className="annual-print-items">
                        {monthTasks.map(task => {
                          const color = taskColor(task)
                          return (
                            <div key={task.id} className="annual-print-task" style={{ borderLeftColor: color }}>
                              <div className="annual-print-task-title">{task.title}</div>
                              <div className="annual-print-task-date">{formatDateRange(task.start_date, task.end_date)}</div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="annual-print-empty">- ไม่มีงาน -</div>
                    )}
                  </section>
                )
              })}
            </div>

            <div className="annual-print-footer">กิจกรรมประจำปี · รวมทั้งปี {counts.dated} งาน</div>
          </section>
        )}

        <div className="annual-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'งานทั้งหมด', value: counts.total, color: '#1a2744' },
            { label: 'มีวันที่', value: counts.dated, color: '#1d4ed8' },
            { label: 'ยังไม่เสร็จ', value: counts.pending, color: '#b45309' },
            { label: 'เสร็จแล้ว', value: counts.done, color: '#047857' },
          ].map(card => (
            <div key={card.label} style={{ borderRadius: 16, background: '#fff', padding: 16, boxShadow: SHADOW }}>
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 26, color: card.color, fontWeight: 700 }}>{card.value}</div>
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#64748b' }}>{card.label}</div>
            </div>
          ))}
        </div>

        {error && <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: '#fff7ed', color: '#9a3412', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>{error}</div>}
        {loading && <div style={{ padding: 28, borderRadius: 18, background: '#fff', color: '#94a3b8', textAlign: 'center', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>กำลังโหลดแผนรายปี...</div>}

        {!loading && (
          <>
            <div className="annual-quarter-board" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
              {QUARTERS.map(quarter => {
                const quarterTotal = quarter.months.reduce((sum, month) => sum + byMonth[month].length, 0)
                return (
                  <section className="annual-quarter" key={quarter.title} style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid rgba(15,23,42,0.05)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '13px 16px', background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff' }}>
                      <div>
                        <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 15.5, fontWeight: 700 }}>{quarter.title}</div>
                        <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: 'rgba(255,255,255,0.72)' }}>{quarter.sub}</div>
                      </div>
                      <span style={{ borderRadius: 999, padding: '5px 10px', background: 'rgba(255,255,255,0.13)', fontFamily: 'Anuphan, sans-serif', fontSize: 12 }}>{quarterTotal} งาน</span>
                    </div>

                    <div className="annual-month-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0 }}>
                      {quarter.months.map(month => (
                        <div className="annual-month" key={month} style={{ minHeight: 420, borderRight: month % 3 !== 2 ? '1px solid #e4e8f2' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2' }}>
                            <span style={{ fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 13.5 }}>{MONTHS[month]}</span>
                            <span style={{ minWidth: 24, textAlign: 'center', borderRadius: 999, padding: '2px 7px', background: '#fff', color: '#64748b', fontFamily: 'Anuphan, sans-serif', fontSize: 12 }}>{byMonth[month].length}</span>
                          </div>

                          <div style={{ display: 'grid', gap: 7, padding: 10 }}>
                            {byMonth[month].length ? byMonth[month].map(task => {
                              const color = taskColor(task)
                              return (
                                <div key={task.id} title={task.title} style={{ borderRadius: 10, border: `1px solid ${color}55`, background: task.completed ? `${color}14` : `${color}22`, padding: '8px 9px', minWidth: 0 }}>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'start' }}>
                                    <span style={{ color, fontSize: 11, lineHeight: '18px' }}>{task.completed ? '✓' : '●'}</span>
                                    <div style={{ minWidth: 0 }}>
                                      <div className="annual-task-title" style={{ fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 12.5, lineHeight: 1.4, whiteSpace: 'normal', overflow: 'visible', wordBreak: 'break-word' }}>{task.title}</div>
                                      <div style={{ marginTop: 3, fontFamily: 'Anuphan, sans-serif', color: '#64748b', fontSize: 11.5 }}>{formatDateRange(task.start_date, task.end_date)}</div>
                                    </div>
                                  </div>
                                </div>
                              )
                            }) : <div style={{ padding: 18, textAlign: 'center', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5 }}>ไม่มีงาน</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>

            {counts.noDateInYear > 0 && (
              <div style={{ marginTop: 16, borderRadius: 16, padding: 14, background: '#fff7ed', color: '#9a3412', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>
                มีงานที่ยังไม่ระบุวันที่ {counts.noDateInYear} งาน จึงไม่ถูกวางในแผนรายปี
              </div>
            )}
          </>
        )}
      </div>

      {/* AI REPORT MODAL */}
      {aiReportOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setAiReportOpen(false) }}>
          <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 700, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 20 }}>📊</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, fontFamily: 'Anuphan, sans-serif' }}>AI สรุปผลงานประจำปี {year + 543}</div>
                {aiReport && <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: 'Anuphan, sans-serif' }}>รวม {aiReport.stats.total} งาน · เสร็จ {aiReport.stats.done} · อัตราสำเร็จ {aiReport.stats.rate}</div>}
              </div>
              <button onClick={() => setAiReportOpen(false)} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 32, height: 32, color: '#fff', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div ref={reportRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {aiReportLoading && (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontFamily: 'Anuphan, sans-serif' }}>
                  <div style={{ width: 36, height: 36, border: '3px solid #e9d5ff', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 14px' }} />
                  กำลังวิเคราะห์ข้อมูล {tasks.filter(t => taskYear(t) === year).length} งาน...
                </div>
              )}
              {aiReportError && <div style={{ padding: '12px 16px', borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontFamily: 'Anuphan, sans-serif' }}>⚠️ {aiReportError}</div>}
              {aiReport && (
                <pre style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 14, lineHeight: 1.8, color: '#1e293b', whiteSpace: 'pre-wrap', margin: 0 }}>{aiReport.report}</pre>
              )}
            </div>
            {aiReport && (
              <div style={{ flexShrink: 0, padding: '12px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => navigator.clipboard.writeText(aiReport.report)} style={{ border: '1.5px solid #e9d5ff', borderRadius: 10, padding: '8px 16px', background: '#faf5ff', color: '#7c3aed', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 13 }}>📋 คัดลอก</button>
                <button onClick={() => setAiReportOpen(false)} style={{ border: 'none', borderRadius: 10, padding: '8px 16px', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 13 }}>ปิด</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const controlStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 12,
  border: '1.5px solid #e4e8f2',
  background: '#fff',
  color: '#1e293b',
  outline: 'none',
  fontFamily: 'Anuphan, sans-serif',
  fontSize: 14,
}

const chipButtonStyle: React.CSSProperties = {
  border: '1.5px solid #dbe4ee',
  borderRadius: 999,
  padding: '8px 12px',
  background: '#fff',
  color: '#64748b',
  cursor: 'pointer',
  fontFamily: 'Anuphan, sans-serif',
  fontSize: 13,
  fontWeight: 800,
}
