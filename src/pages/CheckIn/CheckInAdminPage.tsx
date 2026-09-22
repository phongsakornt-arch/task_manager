import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import MeetingMemberPicker from '../../components/MeetingMemberPicker'
import type { Committee, Member } from '../../types'

const FONT = 'Anuphan, sans-serif'
const SHADOW = '0 2px 10px rgba(15,23,42,0.06)'

type MeetingFormat = 'onsite' | 'online' | 'hybrid'

interface Meeting {
  id: string
  code: string
  title: string
  tag?: string | null
  date: string
  time?: string | null
  location?: string | null
  format: MeetingFormat
}

interface MeetingForm {
  title: string
  tag: string
  date: string
  time: string
  location: string
  format: MeetingFormat
}

const EMPTY_FORM: MeetingForm = { title: '', tag: '', date: '', time: '', location: '', format: 'onsite' }

const FORMAT_OPTIONS: { value: MeetingFormat; label: string; icon: string }[] = [
  { value: 'onsite', label: 'Onsite', icon: '🏢' },
  { value: 'online', label: 'Online', icon: '💻' },
  { value: 'hybrid', label: 'Hybrid', icon: '🔀' },
]

function genCode() {
  return Math.random().toString(36).slice(2, 8)
}

function formatThaiDateShort(dateStr?: string | null) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }).format(d)
}

function displayName(m: Member) {
  return m.nickname ? `${m.name_th} (${m.nickname})` : m.name_th
}

interface ResponseRow {
  meeting_id: string
  member_id: string
  status: 'going' | 'leave'
  attend_mode?: 'onsite' | 'online' | null
}

export default function CheckInAdminPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [committees, setCommittees] = useState<Committee[]>([])
  const [meetingMemberIds, setMeetingMemberIds] = useState<Record<string, string[]>>({})
  const [responsesByMeeting, setResponsesByMeeting] = useState<Record<string, ResponseRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<MeetingForm>(EMPTY_FORM)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    const [mt, mb, cm, mm, rs] = await Promise.all([
      supabase.from('meetings').select('*').order('date', { ascending: false }),
      supabase.from('members').select('*').eq('active', true).order('name_th'),
      supabase.from('committees').select('*').eq('active', true).order('name'),
      supabase.from('meeting_members').select('meeting_id, member_id'),
      supabase.from('meeting_responses').select('meeting_id, member_id, status, attend_mode'),
    ])
    if (mt.error) setError(mt.error.message)
    setMeetings((mt.data ?? []) as Meeting[])
    setMembers((mb.data ?? []) as Member[])
    setCommittees((cm.data ?? []) as Committee[])

    const idsByMeeting: Record<string, string[]> = {}
    for (const row of mm.data ?? []) {
      idsByMeeting[row.meeting_id] ??= []
      idsByMeeting[row.meeting_id].push(row.member_id)
    }
    setMeetingMemberIds(idsByMeeting)

    const byMeeting: Record<string, ResponseRow[]> = {}
    for (const r of (rs.data ?? []) as ResponseRow[]) {
      byMeeting[r.meeting_id] ??= []
      byMeeting[r.meeting_id].push(r)
    }
    setResponsesByMeeting(byMeeting)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const memberById = useMemo(() => {
    const map: Record<string, Member> = {}
    for (const m of members) map[m.id] = m
    return map
  }, [members])

  function toggleForm() {
    setShowForm(v => {
      const next = !v
      setForm(EMPTY_FORM)
      setSelectedIds(new Set())
      setEditingId('')
      return next
    })
  }

  function startEdit(m: Meeting) {
    setForm({ title: m.title, tag: m.tag ?? '', date: m.date, time: m.time ?? '', location: m.location ?? '', format: m.format })
    setSelectedIds(new Set(meetingMemberIds[m.id] ?? []))
    setEditingId(m.id)
    setConfirmDeleteId('')
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function copyLink(code: string, id: string) {
    const url = `${window.location.origin}/checkin?code=${code}`
    navigator.clipboard?.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(''), 2000)
  }

  async function saveMeeting(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title || !form.date || selectedIds.size === 0) return
    setSaving(true)
    setError(null)

    if (editingId) {
      const { error: err } = await supabase.from('meetings').update(form).eq('id', editingId)
      if (!err) {
        await supabase.from('meeting_members').delete().eq('meeting_id', editingId)
        const rows = Array.from(selectedIds).map(member_id => ({ meeting_id: editingId, member_id }))
        if (rows.length) await supabase.from('meeting_members').insert(rows)
        setForm(EMPTY_FORM); setSelectedIds(new Set()); setEditingId(''); setShowForm(false)
        await load()
      } else setError(err.message)
      setSaving(false)
      return
    }

    const code = genCode()
    const { data: inserted, error: err } = await supabase.from('meetings').insert({ code, ...form }).select().single()
    if (!err && inserted) {
      const rows = Array.from(selectedIds).map(member_id => ({ meeting_id: inserted.id, member_id }))
      if (rows.length) await supabase.from('meeting_members').insert(rows)
      setForm(EMPTY_FORM); setSelectedIds(new Set()); setShowForm(false)
      await load()
      copyLink(code, inserted.id)
    } else if (err) setError(err.message)
    setSaving(false)
  }

  async function deleteMeeting(id: string) {
    setDeleting(true)
    const { error: err } = await supabase.from('meetings').delete().eq('id', id)
    setDeleting(false)
    if (!err) { setConfirmDeleteId(''); load() } else setError(err.message)
  }

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#eef0f7' }}>
      <div className="flex flex-col md:flex-row md:items-center" style={{ gap: 16, padding: '16px 24px', background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)', borderBottom: '1px solid #e4e8f2', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', flexShrink: 0 }}>
        <div className="flex items-center" style={{ gap: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontWeight: 700, fontSize: 18 }}>✓</div>
          <div>
            <h1 style={{ margin: 0, fontFamily: FONT, fontSize: 20, lineHeight: 1.2, color: '#1e293b' }}>เช็คชื่อเข้าประชุม</h1>
            <p style={{ margin: '2px 0 0', fontFamily: FONT, fontSize: 13.5, color: '#94a3b8' }}>{meetings.length} การประชุม · กรรมการทั้งหมด {members.length} คน</p>
          </div>
        </div>
        <div className="md:ml-auto">
          <button
            onClick={toggleForm}
            style={{ height: 40, padding: '0 18px', borderRadius: 12, border: 'none', background: '#1a2744', color: '#fff', fontFamily: FONT, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            {showForm ? 'ปิด' : '+ สร้างประชุม'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
        {error && (
          <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: '#fff7ed', color: '#9a3412', fontFamily: FONT, boxShadow: SHADOW }}>⚠️ {error}</div>
        )}

        {showForm && (
          <form onSubmit={saveMeeting} style={{ background: '#fff', borderRadius: 18, boxShadow: SHADOW, border: '1px solid rgba(15,23,42,0.05)', padding: 20, marginBottom: 18, display: 'grid', gap: 12 }}>
            {editingId && <div style={{ fontSize: 12.5, color: '#1d4ed8', fontWeight: 700, fontFamily: FONT }}>กำลังแก้ไขประชุม</div>}

            <Field label="หัวข้อการประชุม *">
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="ประชุมคณะกรรมการพัฒนาผู้ประกอบการรุ่นใหม่" style={inputStyle} />
            </Field>
            <Field label="ครั้งที่ / หมวด">
              <input value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} placeholder="YEC ครั้งที่ 3/2569" style={inputStyle} />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12 }}>
              <Field label="วันที่ *">
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="เวลา">
                <input value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} placeholder="13.30 - 16.30" style={inputStyle} />
              </Field>
            </div>

            <Field label="สถานที่ / ลิงก์ประชุมออนไลน์">
              <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="ห้อง 2201 หรือลิงก์ Zoom/Meet" style={inputStyle} />
            </Field>

            <Field label="รูปแบบการประชุม *">
              <div className="grid grid-cols-3" style={{ gap: 8 }}>
                {FORMAT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, format: opt.value })}
                    style={{
                      height: 42, borderRadius: 12, fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                      border: form.format === opt.value ? '1.5px solid #1a2744' : '1.5px solid #e4e8f2',
                      background: form.format === opt.value ? '#1a2744' : '#fff',
                      color: form.format === opt.value ? '#fff' : '#64748b',
                    }}
                  >
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="กรรมการที่เข้าประชุมนี้ *">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                style={{ width: '100%', height: 44, padding: '0 14px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: FONT, fontSize: 14, cursor: 'pointer' }}
              >
                <span style={{ color: selectedIds.size ? '#1e293b' : '#94a3b8' }}>
                  {selectedIds.size ? `เลือกแล้ว ${selectedIds.size} คน` : 'แตะเพื่อเลือกกรรมการหรือทั้งคณะ'}
                </span>
                <span style={{ color: '#94a3b8' }}>›</span>
              </button>
            </Field>

            <button
              type="submit"
              disabled={saving || selectedIds.size === 0}
              style={{ height: 44, borderRadius: 12, border: 'none', background: '#1a2744', color: '#fff', fontFamily: FONT, fontWeight: 700, fontSize: 14.5, cursor: 'pointer', opacity: saving || selectedIds.size === 0 ? 0.6 : 1 }}
            >
              {editingId ? (saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข') : (saving ? 'กำลังสร้าง...' : 'สร้าง + คัดลอกลิงก์')}
            </button>
          </form>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <div className="w-8 h-8 border-4 border-[#1a2744] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : meetings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontFamily: FONT }}>ยังไม่มีการประชุม — กด "สร้างประชุม" เพื่อเริ่ม</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {meetings.map(m => {
              const responses = responsesByMeeting[m.id] ?? []
              const respByMember: Record<string, ResponseRow> = {}
              for (const r of responses) respByMember[r.member_id] = r
              const assignedIds = meetingMemberIds[m.id] ?? []
              const goingOnsite: Member[] = [], goingOnline: Member[] = [], leave: Member[] = [], pending: Member[] = []
              for (const id of assignedIds) {
                const member = memberById[id]
                if (!member) continue
                const r = respByMember[id]
                if (r?.status === 'going') { if (r.attend_mode === 'online') goingOnline.push(member); else goingOnsite.push(member) }
                else if (r?.status === 'leave') leave.push(member)
                else pending.push(member)
              }
              const going = [...goingOnsite, ...goingOnline]
              const c = { going: going.length, leave: leave.length }
              const formatMeta = FORMAT_OPTIONS.find(o => o.value === m.format) ?? FORMAT_OPTIONS[0]
              const isExpanded = expandedId === m.id
              return (
                <div key={m.id} style={{ background: '#fff', borderRadius: 16, boxShadow: SHADOW, border: '1px solid rgba(15,23,42,0.05)', padding: 16 }}>
                  <div className="flex flex-col sm:flex-row sm:items-start" style={{ gap: 12, justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        {m.tag && <span style={{ fontSize: 12, color: '#1d4ed8', fontFamily: FONT }}>{m.tag}</span>}
                        <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: FONT }}>{formatMeta.icon} {formatMeta.label}</span>
                      </div>
                      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 15, color: '#1e293b', lineHeight: 1.35 }}>{m.title}</div>
                      <div style={{ marginTop: 4, fontSize: 13, color: '#64748b', fontFamily: FONT }}>
                        {formatThaiDateShort(m.date)}{m.time ? ` · ${m.time}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-row sm:flex-col flex-wrap" style={{ gap: 6, flexShrink: 0 }}>
                      <a href={`/checkin?code=${m.code}`} target="_blank" rel="noreferrer" style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid #e4e8f2', color: '#64748b', fontFamily: FONT, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>เปิด</a>
                      <button onClick={() => copyLink(m.code, m.id)} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: 'none', background: '#eff6ff', color: '#1d4ed8', fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        {copiedId === m.id ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
                      </button>
                      <button onClick={() => startEdit(m)} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid #e4e8f2', background: '#fff', color: '#64748b', fontFamily: FONT, fontSize: 12, cursor: 'pointer' }}>แก้ไข</button>
                      <button onClick={() => setConfirmDeleteId(m.id)} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: 'none', background: '#fef2f2', color: '#b91c1c', fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ลบ</button>
                    </div>
                  </div>

                  {confirmDeleteId === m.id && (
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12.5, color: '#b91c1c', fontFamily: FONT }}>ลบประชุมนี้และคำตอบทั้งหมด?</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setConfirmDeleteId('')} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid #e4e8f2', background: '#fff', color: '#64748b', fontFamily: FONT, fontSize: 12, cursor: 'pointer' }}>ยกเลิก</button>
                        <button onClick={() => deleteMeeting(m.id)} disabled={deleting} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
                          {deleting ? '...' : 'ยืนยันลบ'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <Pill n={c.going} label="เข้าร่วม" bg="#f0fdf4" color="#047857" onClick={() => setExpandedId(isExpanded ? '' : m.id)} />
                    <Pill n={c.leave} label="ลา" bg="#fef2f2" color="#b91c1c" onClick={() => setExpandedId(isExpanded ? '' : m.id)} />
                    <Pill n={pending.length} label="ยังไม่ตอบ" bg="#f1f5f9" color="#64748b" onClick={() => setExpandedId(isExpanded ? '' : m.id)} />
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                      {m.format === 'hybrid' ? (
                        <>
                          <NameGroup title="เข้าร่วม (ที่สถานที่)" color="#059669" people={goingOnsite} />
                          <NameGroup title="เข้าร่วม (ออนไลน์)" color="#059669" people={goingOnline} />
                        </>
                      ) : (
                        <NameGroup title="เข้าร่วม" color="#059669" people={going} />
                      )}
                      <NameGroup title="ลา" color="#dc2626" people={leave} />
                      <NameGroup title="ยังไม่ตอบ" color="#94a3b8" people={pending} muted />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <MeetingMemberPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        committees={committees}
        members={members}
        selectedIds={selectedIds}
        onChange={setSelectedIds}
      />
    </div>
  )
}

const inputStyle: React.CSSProperties = { width: '100%', height: 44, padding: '0 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#f8fafc', fontFamily: FONT, fontSize: 14, color: '#1e293b', outline: 'none' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 13, color: '#64748b', marginBottom: 6, fontFamily: FONT }}>{label}</span>
      {children}
    </label>
  )
}

function Pill({ n, label, bg, color, onClick }: { n: number; label: string; bg: string; color: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ flex: '1 1 90px', minWidth: 90, borderRadius: 10, padding: '6px 10px', textAlign: 'center', background: bg, border: 'none', cursor: onClick ? 'pointer' : 'default' }}
    >
      <span style={{ fontFamily: FONT, fontWeight: 800, color }}>{n}</span> <span style={{ fontFamily: FONT, fontSize: 12, color }}>{label}</span>
    </button>
  )
}

function NameGroup({ title, color, people, muted }: { title: string; color: string; people: Member[]; muted?: boolean }) {
  if (people.length === 0) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, marginBottom: 6, color, fontWeight: 700, fontFamily: FONT }}>● {title} ({people.length})</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {people.map(p => (
          <span key={p.id} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: '#f8fafc', color: muted ? '#94a3b8' : '#334155', fontFamily: FONT }}>
            {displayName(p)}
          </span>
        ))}
      </div>
    </div>
  )
}
