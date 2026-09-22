import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

type PublicMeeting = {
  id: string; code: string; title: string; tag?: string | null
  date: string; time?: string | null; location?: string | null
  format: 'onsite' | 'online' | 'hybrid'
}
type PublicMember = { id: string; name_th: string; nickname?: string | null }
type PublicResponse = { member_id: string; status: 'going' | 'leave'; attend_mode?: 'onsite' | 'online' | null }
type PublicCheckinData = { success: boolean; meeting: PublicMeeting; members: PublicMember[]; allMembers: PublicMember[]; responses: PublicResponse[] }

const NAVY = '#1a2744'
const GOLD = '#c9a84c'
const FONT = 'Anuphan, sans-serif'

const FORMAT_ICON: Record<string, string> = { onsite: '🏢', online: '💻', hybrid: '🔀' }
const FORMAT_LABEL: Record<string, string> = { onsite: 'Onsite', online: 'Online', hybrid: 'Hybrid' }

function displayName(m: PublicMember) {
  return m.nickname ? `${m.name_th} (${m.nickname})` : m.name_th
}

function formatThaiDate(dateStr?: string | null) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

export default function CheckInPublicPage() {
  const [params] = useSearchParams()
  const code = params.get('code') ?? ''

  const [data, setData] = useState<PublicCheckinData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')
  const [selectedIsNew, setSelectedIsNew] = useState(false)
  const [saving, setSaving] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async (silent = false) => {
    if (!code) { setError('ลิงก์ไม่ครบถ้วน'); setLoading(false); return }
    if (!silent) setLoading(true)
    const { data: r, error: e } = await supabase.functions.invoke<PublicCheckinData>('meeting-checkin-data', { body: { code } })
    if (e || !r?.success) { if (!silent) { setError(e?.message ?? 'โหลดข้อมูลไม่ได้ ลิงก์อาจไม่ถูกต้อง'); setData(null) } }
    else { setData(r); setError(null) }
    if (!silent) setLoading(false)
  }, [code])

  // Standard fetch-on-mount + poll pattern; loadData sets state internally.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    loadData()
    pollRef.current = setInterval(() => loadData(true), 6000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadData])

  const allMemberById = useMemo(() => {
    const map: Record<string, PublicMember> = {}
    for (const m of data?.allMembers ?? []) map[m.id] = m
    return map
  }, [data])

  const respByMember = useMemo(() => {
    const map: Record<string, 'going' | 'leave'> = {}
    for (const r of data?.responses ?? []) map[r.member_id] = r.status
    return map
  }, [data])
  const groups = useMemo(() => {
    const going: PublicMember[] = [], goingOnsite: PublicMember[] = [], goingOnline: PublicMember[] = []
    const leave: PublicMember[] = []
    for (const r of data?.responses ?? []) {
      const member = allMemberById[r.member_id]
      if (!member) continue
      if (r.status === 'going') {
        going.push(member)
        if (r.attend_mode === 'online') goingOnline.push(member); else goingOnsite.push(member)
      } else if (r.status === 'leave') leave.push(member)
    }
    // "ยังไม่ตอบ" = เฉพาะรายชื่อที่แอดมินเลือกไว้ล่วงหน้าและยังไม่ตอบ — ไม่รวมทั้งองค์กร
    const pending = (data?.members ?? []).filter(m => !respByMember[m.id])
    return { going, goingOnsite, goingOnline, leave, pending }
  }, [data, allMemberById, respByMember])

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = data?.allMembers ?? []
    if (!q) return list
    return list.filter(m => `${m.name_th} ${m.nickname ?? ''}`.toLowerCase().includes(q))
  }, [data, search])

  function pick(member: PublicMember) {
    setSelectedId(member.id)
    setSelectedLabel(displayName(member))
    setSelectedIsNew(false)
    setSearch('')
  }
  function pickNew() {
    const name = search.trim()
    if (!name) return
    setSelectedId('')
    setSelectedLabel(name)
    setSelectedIsNew(true)
    setSearch('')
  }
  function changeSelection() {
    setSelectedId(''); setSelectedLabel(''); setSelectedIsNew(false); setSearch('')
  }

  async function submit(status: 'going' | 'leave', attendMode?: 'onsite' | 'online') {
    if ((!selectedId && !selectedIsNew) || saving) return
    const key = attendMode ? `${status}-${attendMode}` : status
    setSaving(key)
    const { data: r, error: e } = await supabase.functions.invoke<{ success: boolean; memberId?: string }>('meeting-checkin-submit', {
      body: selectedIsNew
        ? { code, newName: selectedLabel, status, attendMode: attendMode ?? null }
        : { code, memberId: selectedId, status, attendMode: attendMode ?? null },
    })
    setSaving('')
    if (!e && r?.memberId) {
      // ชื่อใหม่ถูกสร้างแล้ว — ผูกไอดีไว้กันสร้างซ้ำถ้ากดตอบอีกครั้ง (เช่น เปลี่ยนใจจากเข้าร่วมเป็นลา)
      if (selectedIsNew) { setSelectedId(r.memberId); setSelectedIsNew(false) }
      setJustSaved(true); setTimeout(() => setJustSaved(false), 2200); loadData(true)
    }
  }

  const meeting = data?.meeting
  const hasSelection = !!selectedId || selectedIsNew

  return (
    <div style={{ minHeight: '100vh', background: '#eef2f7', fontFamily: FONT, display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #1e3a6e 100%)`, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, boxShadow: '0 3px 16px rgba(0,0,0,0.3)' }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: 'rgba(201,168,76,0.15)', border: `2px solid ${GOLD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: GOLD, flexShrink: 0 }}>✓</div>
        <div>
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 800 }}>เช็คชื่อเข้าประชุม</div>
          <div style={{ color: GOLD, fontSize: 12.5, fontWeight: 600, letterSpacing: '0.03em' }}>หอการค้าไทย · YEC</div>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 24px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'grid', gap: 14 }}>

          {loading && (
            <div style={{ background: '#fff', borderRadius: 16, padding: 40, textAlign: 'center', color: '#94a3b8', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
              กำลังโหลดข้อมูล...
            </div>
          )}

          {!loading && error && (
            <div style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#b91c1c', marginBottom: 6 }}>เปิดลิงก์ไม่ได้</div>
              <div style={{ color: '#64748b', fontSize: 14 }}>{error}</div>
            </div>
          )}

          {!loading && meeting && (
            <div style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
              <div style={{ height: 5, background: `linear-gradient(90deg, ${NAVY}, #2d4a8a, ${GOLD})` }} />

              <div style={{ padding: '18px 20px' }}>
                {meeting.tag && <div style={{ color: NAVY, fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{meeting.tag}</div>}
                <h1 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800, color: '#0f172a', lineHeight: 1.4 }}>{meeting.title}</h1>
                <div style={{ display: 'grid', gap: 6 }}>
                  <InfoRow icon={FORMAT_ICON[meeting.format]} text={FORMAT_LABEL[meeting.format]} />
                  <InfoRow icon="📅" text={formatThaiDate(meeting.date)} />
                  {meeting.time && <InfoRow icon="⏰" text={`${meeting.time} น.`} />}
                  {meeting.location && <InfoRow icon="📍" text={meeting.location} />}
                </div>
              </div>

              <div style={{ padding: '0 20px 20px', borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
                <label style={{ display: 'block', fontSize: 13, color: '#64748b', marginBottom: 8, fontFamily: FONT }}>ฉันคือ</label>

                {hasSelection ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#f8fafc', marginBottom: 12 }}>
                    <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14.5, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedLabel}{selectedId && respByMember[selectedId] ? '  ✓ ตอบแล้ว' : ''}
                    </span>
                    <button type="button" onClick={changeSelection} style={{ flexShrink: 0, border: 'none', background: 'none', color: '#1d4ed8', fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>เปลี่ยน</button>
                  </div>
                ) : (
                  <div style={{ marginBottom: 12 }}>
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="พิมพ์ชื่อหรือชื่อเล่นของคุณ..."
                      style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#f8fafc', fontFamily: FONT, fontSize: 14.5, color: '#1e293b', outline: 'none' }}
                    />
                    <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6, borderRadius: 12, border: filteredMembers.length ? '1px solid #f1f5f9' : 'none' }}>
                      {filteredMembers.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => pick(m)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid #f8fafc', background: '#fff', fontFamily: FONT, fontSize: 14, color: '#334155', cursor: 'pointer' }}
                        >
                          {displayName(m)}{respByMember[m.id] ? '  ✓ ตอบแล้ว' : ''}
                        </button>
                      ))}
                      {search.trim() && filteredMembers.length === 0 && (
                        <button
                          type="button"
                          onClick={pickNew}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', background: '#eff6ff', fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: '#1d4ed8', cursor: 'pointer', borderRadius: 12 }}
                        >
                          + เพิ่มชื่อ "{search.trim()}" เป็นชื่อใหม่
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {meeting.format === 'hybrid' ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <ActionButton disabled={!hasSelection || !!saving} loading={saving === 'going-onsite'} onClick={() => submit('going', 'onsite')} tone="blue">🏢 เข้าร่วม (ที่สถานที่)</ActionButton>
                      <ActionButton disabled={!hasSelection || !!saving} loading={saving === 'going-online'} onClick={() => submit('going', 'online')} tone="green">💻 เข้าร่วม (ออนไลน์)</ActionButton>
                    </div>
                    <ActionButton disabled={!hasSelection || !!saving} loading={saving === 'leave'} onClick={() => submit('leave')} tone="red" full>✕ ลา</ActionButton>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <ActionButton disabled={!hasSelection || !!saving} loading={saving === 'going'} onClick={() => submit('going')} tone="green">✓ เข้าร่วม</ActionButton>
                    <ActionButton disabled={!hasSelection || !!saving} loading={saving === 'leave'} onClick={() => submit('leave')} tone="red">✕ ลา</ActionButton>
                  </div>
                )}
                {justSaved && <p style={{ textAlign: 'center', fontSize: 13.5, color: '#047857', marginTop: 10, fontWeight: 700 }}>บันทึกแล้ว ขอบคุณค่ะ</p>}
              </div>

              <div style={{ padding: '16px 20px 20px', borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>สถานะล่าสุด</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>● อัปเดตทุก 6 วิ</span>
                </div>

                {meeting.format === 'hybrid' ? (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                    <Stat n={groups.goingOnsite.length} label="🏢 Onsite" tone="blue" />
                    <Stat n={groups.goingOnline.length} label="💻 Online" tone="green" />
                    <Stat n={groups.leave.length} label="ลา" tone="red" />
                    <Stat n={groups.pending.length} label="ยังไม่ตอบ" tone="gray" />
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                    <Stat n={groups.going.length} label="เข้าร่วม" tone="green" />
                    <Stat n={groups.leave.length} label="ลา" tone="red" />
                    <Stat n={groups.pending.length} label="ยังไม่ตอบ" tone="gray" />
                  </div>
                )}

                {meeting.format === 'hybrid' ? (
                  <>
                    <NameGroup title="เข้าร่วม (ที่สถานที่)" tone="blue" people={groups.goingOnsite} />
                    <NameGroup title="เข้าร่วม (ออนไลน์)" tone="green" people={groups.goingOnline} />
                  </>
                ) : (
                  <NameGroup title="เข้าร่วม" tone="green" people={groups.going} />
                )}
                <NameGroup title="ลา" tone="red" people={groups.leave} />
                <NameGroup title="ยังไม่ตอบ" tone="gray" people={groups.pending} muted />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon, text }: { icon: string; text: string }) {
  return <div style={{ fontSize: 13.5, color: '#475569', display: 'flex', alignItems: 'center', gap: 8 }}><span>{icon}</span>{text}</div>
}

const ACTION_TONE: Record<string, { bg: string; color: string; border: string }> = {
  green: { bg: '#f0fdf4', color: '#047857', border: '#bbf7d0' },
  blue: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  red: { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
}
function ActionButton({ children, onClick, disabled, loading, tone, full }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; loading?: boolean; tone: 'green' | 'blue' | 'red'; full?: boolean }) {
  const colors = ACTION_TONE[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: full ? undefined : 1, width: full ? '100%' : undefined,
        height: 44, borderRadius: 12, border: `1.5px solid ${colors.border}`,
        background: colors.bg, color: colors.color, fontFamily: FONT, fontWeight: 700, fontSize: 13.5,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >
      {loading ? '...' : children}
    </button>
  )
}

const STAT_TONE: Record<string, { bg: string; color: string }> = {
  green: { bg: '#f0fdf4', color: '#047857' },
  blue: { bg: '#eff6ff', color: '#1d4ed8' },
  red: { bg: '#fef2f2', color: '#b91c1c' },
  gray: { bg: '#f1f5f9', color: '#64748b' },
}
function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  const c = STAT_TONE[tone]
  return (
    <div style={{ flex: '1 1 70px', minWidth: 70, borderRadius: 12, padding: '8px 6px', textAlign: 'center', background: c.bg }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: c.color }}>{n}</div>
      <div style={{ fontSize: 11, color: c.color }}>{label}</div>
    </div>
  )
}

const DOT_TONE: Record<string, string> = { green: '#059669', blue: '#1d4ed8', red: '#dc2626', gray: '#94a3b8' }
function NameGroup({ title, tone, people, muted }: { title: string; tone: string; people: PublicMember[]; muted?: boolean }) {
  if (people.length === 0) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, marginBottom: 6, color: DOT_TONE[tone], fontWeight: 700 }}>● {title} ({people.length})</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {people.map(p => (
          <span key={p.id} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: '#f8fafc', color: muted ? '#94a3b8' : '#334155' }}>
            {displayName(p)}
          </span>
        ))}
      </div>
    </div>
  )
}
