import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { canManageMasterData } from '../../lib/permissions'
import { useAuthStore } from '../../stores/authStore'
import type { MasterMember } from '../../types'

const FONT = 'Anuphan, sans-serif'
const NAVY = '#1a2744'
const CARD_SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'
const PAGE_SIZE = 1000
const RENDER_CAP = 150

// field, label — ใช้ทั้งแสดงผลใน drawer และช่อง edit, จัดกลุ่มตามที่ระบบเดิม (DATA MASTER) วางไว้
const FIELD_GROUPS: { title: string; fields: [keyof MasterMember, string][] }[] = [
  {
    title: 'ข้อมูลส่วนตัว',
    fields: [
      ['prefix', 'คำนำหน้า'], ['first_name', 'ชื่อ'], ['last_name', 'นามสกุล'],
      ['birth_date', 'วัน/เดือน/ปีเกิด'], ['national_id', 'เลขบัตรประจำตัวประชาชน'],
    ],
  },
  {
    title: 'ข้อมูลติดต่อ',
    fields: [['phone', 'เบอร์โทร'], ['email', 'อีเมล'], ['current_address', 'ที่อยู่ปัจจุบัน']],
  },
  {
    title: 'YEC',
    fields: [
      ['region', 'ภาค'], ['province', 'จังหวัด'], ['is_yec_provincial', 'เป็น YEC หอการค้าจังหวัด'],
      ['yec_position', 'ตำแหน่งใน YEC'], ['member_since_date', 'วันที่เป็นสมาชิก YEC'],
      ['member_expiry_date', 'วันที่หมดอายุสมาชิก YEC'], ['verified_by_chair', 'ผ่านการตรวจสอบจากประธาน YEC'],
      ['payment_status', 'สถานะการชำระเงิน'], ['is_chamber_member', 'เป็นสมาชิกหอการค้า'],
    ],
  },
  {
    title: 'ธุรกิจ',
    fields: [
      ['business_name', 'ชื่อกิจการ'], ['entity_type', 'ประเภทกิจการ'], ['tax_id', 'เลขนิติบุคคล/เลขผู้เสียภาษี'],
      ['business_type_tsic', 'ประเภทธุรกิจ (TSIC)'], ['business_type_network', 'ประเภทธุรกิจ (Business Network)'],
      ['business_detail', 'รายละเอียดธุรกิจ'], ['has_tcc_connect', 'มี TCC Connect'], ['org_info', 'ข้อมูลหน่วยงาน'],
    ],
  },
]

const CSV_COLUMNS: [keyof MasterMember, string][] = FIELD_GROUPS.flatMap(g => g.fields)

type ResolverForm = { phone: string; email: string; first_name: string; last_name: string; province: string }
type ResolverResult = {
  id: string; master_id: string; first_name: string; last_name: string; province: string
  phone: string; email: string; yec_position: string; payment_status: string
  match_type: string; confidence: number
}
type BatchResult = ResolverResult & { input_index: number; input_text: string }

const MATCH_TYPE_LABEL: Record<string, string> = {
  phone: 'เบอร์โทร (ตรง)', email: 'อีเมล (ตรง)', name_province: 'ชื่อ+จังหวัด (ตรง)',
  name_exact: 'ชื่อตรง (ไม่ยืนยันจังหวัด)', fuzzy_name: 'ชื่อใกล้เคียง', name_fuzzy: 'ชื่อใกล้เคียง',
  not_found: 'ไม่พบ', empty: 'ว่าง',
}

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function normalizePhoneInput(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 9 ? `0${digits}` : digits
}

async function loadAllMasterMembers(): Promise<{ data: MasterMember[]; error: string | null }> {
  const rows: MasterMember[] = []
  let from = 0
  for (;;) {
    // อ่านผ่าน view ที่ mask เลขบัตรประชาชนให้ role ที่ไม่ใช่ admin เห็นเป็น null
    // แทนที่จะ query ตาราง master_members ตรงๆ (แก้ไขยังคงเขียนเข้าตารางจริงตามเดิม)
    const { data, error } = await supabase
      .from('master_members_view')
      .select('*')
      .eq('deleted', false)
      .order('province', { ascending: true })
      .order('first_name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return { data: [], error: error.message }
    rows.push(...((data ?? []) as MasterMember[]))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return { data: rows, error: null }
}

function toCsv(rows: MasterMember[]) {
  const header = ['Master_ID', ...CSV_COLUMNS.map(([, label]) => label)]
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [header.map(escape).join(',')]
  for (const row of rows) {
    lines.push([row.master_id, ...CSV_COLUMNS.map(([field]) => row[field])].map(escape).join(','))
  }
  return lines.join('\n')
}

export default function MasterDataPage() {
  const { user } = useAuthStore()
  const canManage = canManageMasterData(user?.role)
  const [members, setMembers] = useState<MasterMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('all')
  const [provinceFilter, setProvinceFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [controlsOpen, setControlsOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768)

  const [selected, setSelected] = useState<MasterMember | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<MasterMember>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [resolverOpen, setResolverOpen] = useState(false)
  const [resolverForm, setResolverForm] = useState<ResolverForm>({ phone: '', email: '', first_name: '', last_name: '', province: '' })
  const [resolverResults, setResolverResults] = useState<ResolverResult[] | null>(null)
  const [resolverLoading, setResolverLoading] = useState(false)
  const [resolverError, setResolverError] = useState<string | null>(null)

  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchFileName, setBatchFileName] = useState('')
  const [batchFileRows, setBatchFileRows] = useState<string[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null)
  const batchFileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: loadError } = await loadAllMasterMembers()
    if (loadError) setError(loadError)
    setMembers(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const regions = useMemo(() => Array.from(new Set(members.map(m => m.region).filter(Boolean))).sort() as string[], [members])
  const provinces = useMemo(() => {
    const pool = regionFilter === 'all' ? members : members.filter(m => m.region === regionFilter)
    return Array.from(new Set(pool.map(m => m.province).filter(Boolean))).sort() as string[]
  }, [members, regionFilter])
  const paymentStatuses = useMemo(() => Array.from(new Set(members.map(m => m.payment_status).filter(Boolean))).sort() as string[], [members])

  const filtered = useMemo(() => {
    const keyword = normalize(search)
    return members.filter(m => {
      if (regionFilter !== 'all' && m.region !== regionFilter) return false
      if (provinceFilter !== 'all' && m.province !== provinceFilter) return false
      if (paymentFilter !== 'all' && m.payment_status !== paymentFilter) return false
      if (!keyword) return true
      const haystack = [m.first_name, m.last_name, m.phone, m.email, m.business_name, m.province, m.yec_position]
        .map(normalize).join(' ')
      return haystack.includes(keyword)
    })
  }, [members, search, regionFilter, provinceFilter, paymentFilter])

  const visible = filtered.slice(0, RENDER_CAP)

  const openDetail = (member: MasterMember) => {
    setSelected(member)
    setEditing(false)
    setSaveError(null)
  }

  const closeDetail = () => {
    if (saving) return
    setSelected(null)
    setEditing(false)
    setEditForm({})
    setSaveError(null)
  }

  const startEdit = () => {
    if (!selected) return
    setEditForm({ ...selected })
    setEditing(true)
    setSaveError(null)
  }

  const updateEditField = (field: keyof MasterMember, value: string) => {
    setEditForm(current => ({ ...current, [field]: value }))
  }

  const saveEdit = async () => {
    if (!selected) return
    setSaving(true)
    setSaveError(null)
    const payload: Record<string, string | null> = {}
    for (const [field] of CSV_COLUMNS) {
      const value = editForm[field]
      payload[field] = typeof value === 'string' ? (value.trim() || null) : null
    }
    if (typeof editForm.phone === 'string') payload.phone_normalized = normalizePhoneInput(editForm.phone) || null
    if (typeof editForm.email === 'string') payload.email_normalized = editForm.email.trim().toLowerCase() || null

    const { data, error: updateError } = await supabase
      .from('master_members')
      .update(payload)
      .eq('id', selected.id)
      .select('*')
      .single()

    setSaving(false)
    if (updateError || !data) {
      setSaveError(updateError?.message ?? 'บันทึกไม่สำเร็จ')
      return
    }
    const updated = data as MasterMember
    setMembers(current => current.map(m => (m.id === updated.id ? updated : m)))
    setSelected(updated)
    setEditing(false)
  }

  const exportCsv = () => {
    const csv = toCsv(filtered)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    a.href = url
    a.download = `YEC_MasterData_Export_${stamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const runResolver = async () => {
    if (resolverLoading) return
    const hasInput = resolverForm.phone.trim() || resolverForm.email.trim() || resolverForm.first_name.trim() || resolverForm.last_name.trim()
    if (!hasInput) return
    setResolverLoading(true)
    setResolverError(null)
    setResolverResults(null)
    const { data, error: rpcError } = await supabase.rpc('resolve_master_member', {
      p_phone: resolverForm.phone.trim() || null,
      p_email: resolverForm.email.trim() || null,
      p_first_name: resolverForm.first_name.trim() || null,
      p_last_name: resolverForm.last_name.trim() || null,
      p_province: resolverForm.province.trim() || null,
    })
    setResolverLoading(false)
    if (rpcError) { setResolverError(rpcError.message); return }
    setResolverResults((data ?? []) as ResolverResult[])
  }

  const openBatch = () => {
    setBatchOpen(true)
    setBatchText('')
    setBatchFileName('')
    setBatchFileRows([])
    setBatchResults(null)
    setBatchError(null)
  }

  const handleBatchFile = (file: File) => {
    setBatchError(null)
    setBatchFileName(file.name)
    const reader = new FileReader()
    reader.onload = event => {
      try {
        const buffer = event.target?.result
        const workbook = XLSX.read(buffer, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
        // join ทุก cell ที่ไม่ว่างในแต่ละแถวเป็น string เดียว ให้ resolver ฝั่ง DB สแกนหาเบอร์/อีเมล/ชื่อเอง
        const lines = rows
          .map(row => row.map(cell => String(cell ?? '').trim()).filter(Boolean).join(', '))
          .filter(Boolean)
        setBatchFileRows(lines)
      } catch {
        setBatchError('อ่านไฟล์ไม่สำเร็จ — รองรับเฉพาะ CSV และ Excel (.xlsx)')
        setBatchFileRows([])
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const runBatchResolve = async () => {
    if (batchLoading) return
    const typedLines = batchText.split('\n').map(l => l.trim()).filter(Boolean)
    const inputs = [...typedLines, ...batchFileRows]
    if (!inputs.length) return
    setBatchLoading(true)
    setBatchError(null)
    setBatchResults(null)
    const { data, error: rpcError } = await supabase.rpc('resolve_master_members_batch', { inputs })
    setBatchLoading(false)
    if (rpcError) { setBatchError(rpcError.message); return }
    setBatchResults((data ?? []) as BatchResult[])
  }

  const batchSummary = useMemo(() => {
    if (!batchResults) return null
    return {
      total: batchResults.length,
      matched: batchResults.filter(r => r.confidence >= 85).length,
      possible: batchResults.filter(r => r.confidence > 0 && r.confidence < 85).length,
      notFound: batchResults.filter(r => r.confidence === 0 && r.match_type !== 'empty').length,
    }
  }, [batchResults])

  const exportBatchCsv = () => {
    if (!batchResults) return
    const header = ['ข้อมูลที่ตรวจ', 'สถานะ', 'ชื่อ-นามสกุลที่จับคู่', 'จังหวัด', 'ตำแหน่ง', 'สถานะชำระเงิน', 'ความมั่นใจ']
    const escape = (value: unknown) => {
      const text = value == null ? '' : String(value)
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const lines = [header.map(escape).join(',')]
    for (const r of batchResults) {
      lines.push([
        r.input_text,
        MATCH_TYPE_LABEL[r.match_type] ?? r.match_type,
        r.first_name ? `${r.first_name} ${r.last_name ?? ''}`.trim() : '',
        r.province ?? '', r.yec_position ?? '', r.payment_status ?? '', `${r.confidence}%`,
      ].map(escape).join(','))
    }
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `YEC_BatchCheck_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#eef0f7' }}>
      <div
        className="flex flex-col md:flex-row md:items-center"
        style={{ gap: 16, padding: '16px 24px', background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)', borderBottom: '1px solid #e4e8f2', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', flexShrink: 0 }}
      >
        <div className="flex items-center" style={{ gap: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontWeight: 700, boxShadow: '0 4px 14px rgba(26,39,68,0.28)' }}>M</div>
          <div>
            <h1 style={{ margin: 0, fontFamily: FONT, fontSize: 20, lineHeight: 1.2, color: '#1e293b' }}>Data Master — สมาชิก YEC ทั่วประเทศ</h1>
            <p style={{ margin: '2px 0 0', fontFamily: FONT, fontSize: 13.5, color: '#94a3b8' }}>
              {filtered.length.toLocaleString()} จาก {members.length.toLocaleString()} คน
            </p>
          </div>
          <button
            onClick={() => setControlsOpen(v => !v)}
            className="md:hidden"
            style={{ marginLeft: 'auto', border: '1px solid #e4e8f2', borderRadius: 10, background: '#fff', color: '#1a2744', fontFamily: FONT, fontSize: 12.5, fontWeight: 700, padding: '7px 12px', cursor: 'pointer', flexShrink: 0 }}
          >
            {controlsOpen ? 'ซ่อนตัวกรอง ▲' : 'ค้นหา/ตัวกรอง ▼'}
          </button>
        </div>

        <div className={`${controlsOpen ? 'flex' : 'hidden'} md:flex flex-wrap md:ml-auto`} style={{ gap: 10, alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ เบอร์ อีเมล บริษัท..."
            className="w-full md:w-[220px]"
            style={{ padding: '10px 14px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', background: '#f8fafc', color: '#1e293b', fontFamily: FONT, fontSize: 14, minWidth: 0 }}
          />
          <select value={regionFilter} onChange={e => { setRegionFilter(e.target.value); setProvinceFilter('all') }} className="w-full md:w-[140px]" style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', background: '#fff', color: '#1e293b', fontFamily: FONT, fontSize: 14, minWidth: 0 }}>
            <option value="all">ทุกภาค</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={provinceFilter} onChange={e => setProvinceFilter(e.target.value)} className="w-full md:w-[160px]" style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', background: '#fff', color: '#1e293b', fontFamily: FONT, fontSize: 14, minWidth: 0 }}>
            <option value="all">ทุกจังหวัด</option>
            {provinces.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} className="w-full md:w-[160px]" style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', background: '#fff', color: '#1e293b', fontFamily: FONT, fontSize: 14, minWidth: 0 }}>
            <option value="all">ทุกสถานะชำระเงิน</option>
            {paymentStatuses.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={() => { setResolverOpen(true); setResolverResults(null); setResolverError(null) }} style={{ padding: '10px 14px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontFamily: FONT, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 12px rgba(124,58,237,0.28)', whiteSpace: 'nowrap' }}>
            🔗 จับคู่สมาชิก
          </button>
          <button onClick={openBatch} style={{ padding: '10px 14px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#0891b2,#06b6d4)', color: '#fff', fontFamily: FONT, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 12px rgba(8,145,178,0.28)', whiteSpace: 'nowrap' }}>
            📋 ตรวจสถานะแบบหมู่
          </button>
          {canManage && (
            <button onClick={exportCsv} disabled={!filtered.length} style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(26,39,68,0.14)', background: '#fff', color: '#1a2744', fontFamily: FONT, fontSize: 13, cursor: filtered.length ? 'pointer' : 'default', opacity: filtered.length ? 1 : 0.5, whiteSpace: 'nowrap' }}>
              ⬇ Export CSV
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ height: 56, borderRadius: 12, background: 'linear-gradient(90deg, #f8fafc, #eef2f7, #f8fafc)', boxShadow: CARD_SHADOW }} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: 18, borderRadius: 16, background: '#fff7ed', color: '#9a3412', fontFamily: FONT, boxShadow: CARD_SHADOW }}>
            โหลดข้อมูลไม่สำเร็จ: {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ height: '100%', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontFamily: FONT, fontSize: 15 }}>
            ไม่พบข้อมูลตามเงื่อนไขที่เลือก
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div style={{ borderRadius: 16, background: '#fff', boxShadow: CARD_SHADOW, border: '1px solid rgba(15,23,42,0.05)', overflow: 'hidden' }}>
            {filtered.length > RENDER_CAP && (
              <div style={{ padding: '10px 16px', background: '#fffbeb', color: '#92400e', fontFamily: FONT, fontSize: 12.5, borderBottom: '1px solid #fde68a' }}>
                แสดง {RENDER_CAP} จาก {filtered.length.toLocaleString()} รายการ — พิมพ์ค้นหาหรือกรองเพิ่มเพื่อดูรายการที่ต้องการ
              </div>
            )}
            {visible.map((member, index) => (
              <button
                key={member.id}
                onClick={() => openDetail(member)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                  padding: '11px 16px', border: 'none', borderTop: index === 0 ? 'none' : '1px solid #f1f5f9',
                  background: '#fff', cursor: 'pointer', fontFamily: FONT,
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg,#c9a84c,#f0d878)', color: '#1a2744', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
                  {(member.first_name || '?').trim().charAt(0)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: '#1e293b', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {member.prefix}{member.first_name} {member.last_name}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[member.province, member.yec_position].filter(Boolean).join(' · ') || '-'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                  {member.payment_status && (
                    <span style={{
                      padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                      background: member.payment_status.includes('ชำระ') && !member.payment_status.includes('ไม่') ? '#dcfce7' : '#fee2e2',
                      color: member.payment_status.includes('ชำระ') && !member.payment_status.includes('ไม่') ? '#166534' : '#991b1b',
                    }}>
                      {member.payment_status}
                    </span>
                  )}
                  {member.phone && <span style={{ color: '#94a3b8', fontSize: 12 }}>{member.phone}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,23,42,0.38)' }} onClick={e => { if (e.target === e.currentTarget) closeDetail() }}>
          <div style={{ width: 'min(520px, 100%)', height: '100%', background: '#fff', boxShadow: '-16px 0 48px rgba(15,23,42,0.2)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid #e4e8f2', flexShrink: 0 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ margin: 0, fontFamily: FONT, color: '#1e293b', fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selected.prefix}{selected.first_name} {selected.last_name}
                </h2>
                <div style={{ marginTop: 2, color: '#94a3b8', fontFamily: FONT, fontSize: 12.5 }}>Master ID: {selected.master_id}</div>
              </div>
              {canManage && !editing && (
                <button onClick={startEdit} style={{ border: '1px solid rgba(26,39,68,0.14)', borderRadius: 10, background: '#f8fafc', color: '#1a2744', fontFamily: FONT, fontSize: 13, padding: '8px 12px', cursor: 'pointer', flexShrink: 0 }}>
                  ✏️ Edit
                </button>
              )}
              <button onClick={closeDetail} disabled={saving} style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: '#f1f5f9', cursor: saving ? 'not-allowed' : 'pointer', color: '#64748b', fontSize: 20, flexShrink: 0 }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {FIELD_GROUPS.map(group => (
                <div key={group.title}>
                  <h3 style={{ margin: '0 0 10px', fontFamily: FONT, fontSize: 13, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    § {group.title}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    {group.fields.map(([field, label]) => (
                      <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: field === 'business_detail' || field === 'current_address' ? '1 / -1' : undefined }}>
                        <span style={{ fontFamily: FONT, fontSize: 11.5, color: '#94a3b8' }}>{label}</span>
                        {editing ? (
                          <input
                            value={(editForm[field] as string) ?? ''}
                            onChange={e => updateEditField(field, e.target.value)}
                            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe2ee', outline: 'none', fontFamily: FONT, fontSize: 13.5 }}
                          />
                        ) : (
                          <span style={{ fontFamily: FONT, fontSize: 13.5, color: '#1e293b' }}>{(selected[field] as string) || '-'}</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {editing && (
              <div style={{ flexShrink: 0, borderTop: '1px solid #e4e8f2', padding: 16, display: 'flex', gap: 10 }}>
                {saveError && <div style={{ flex: 1, color: '#b91c1c', fontFamily: FONT, fontSize: 12.5, alignSelf: 'center' }}>{saveError}</div>}
                <button onClick={() => setEditing(false)} disabled={saving} style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #dbe2ee', background: '#fff', color: '#64748b', fontFamily: FONT, cursor: saving ? 'not-allowed' : 'pointer', marginLeft: 'auto' }}>ยกเลิก</button>
                <button onClick={saveEdit} disabled={saving} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${NAVY}, #2d4a8a)`, color: '#fff', fontFamily: FONT, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {resolverOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) setResolverOpen(false) }}>
          <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(15,23,42,0.22)' }}>
            <div style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0 }}>
              <span style={{ fontSize: 20 }}>🔗</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: FONT }}>จับคู่สมาชิกกับฐาน Data Master</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: FONT }}>กรอกอย่างน้อย 1 ช่อง — ระบบจะจับคู่ตามลำดับความแม่นยำ</div>
              </div>
              <button onClick={() => setResolverOpen(false)} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 30, height: 30, color: '#fff', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ padding: '18px 20px 22px', fontFamily: FONT }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
                <input value={resolverForm.first_name} onChange={e => setResolverForm(f => ({ ...f, first_name: e.target.value }))} placeholder="ชื่อ" style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e4e8f2', fontFamily: FONT, fontSize: 14 }} />
                <input value={resolverForm.last_name} onChange={e => setResolverForm(f => ({ ...f, last_name: e.target.value }))} placeholder="นามสกุล" style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e4e8f2', fontFamily: FONT, fontSize: 14 }} />
                <input value={resolverForm.province} onChange={e => setResolverForm(f => ({ ...f, province: e.target.value }))} placeholder="จังหวัด (ไม่บังคับ)" style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e4e8f2', fontFamily: FONT, fontSize: 14 }} />
                <input value={resolverForm.phone} onChange={e => setResolverForm(f => ({ ...f, phone: e.target.value }))} placeholder="เบอร์โทร" style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e4e8f2', fontFamily: FONT, fontSize: 14 }} />
                <input value={resolverForm.email} onChange={e => setResolverForm(f => ({ ...f, email: e.target.value }))} placeholder="อีเมล" style={{ gridColumn: '1 / -1', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e4e8f2', fontFamily: FONT, fontSize: 14 }} />
              </div>

              {resolverError && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 9, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>⚠️ {resolverError}</div>}

              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button onClick={() => setResolverOpen(false)} style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 16px', background: '#fff', color: '#64748b', cursor: 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 13 }}>ปิด</button>
                <button onClick={runResolver} disabled={resolverLoading} style={{ border: 'none', borderRadius: 10, padding: '9px 18px', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', cursor: 'pointer', fontFamily: FONT, fontWeight: 800, fontSize: 13 }}>
                  {resolverLoading ? 'กำลังค้นหา...' : '🔍 จับคู่'}
                </button>
              </div>

              {resolverResults && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {resolverResults.length === 0 && (
                    <div style={{ color: '#94a3b8', fontSize: 13.5, textAlign: 'center', padding: '12px 0' }}>ไม่พบข้อมูลที่ตรงกันในฐาน Data Master</div>
                  )}
                  {resolverResults.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #e4e8f2', background: r.confidence >= 90 ? '#f0fdf4' : '#fffbeb' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1e293b' }}>{r.first_name} {r.last_name}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{[r.province, r.yec_position, r.phone].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: r.confidence >= 90 ? '#dcfce7' : '#fef3c7', color: r.confidence >= 90 ? '#166534' : '#92400e', flexShrink: 0 }}>
                        {r.confidence}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {batchOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={e => { if (e.target === e.currentTarget) setBatchOpen(false) }}>
          <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 720, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(15,23,42,0.22)' }}>
            <div style={{ background: 'linear-gradient(135deg,#0891b2,#06b6d4)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0 }}>
              <span style={{ fontSize: 20 }}>📋</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: FONT }}>ตรวจสถานะสมาชิกแบบหมู่</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: FONT }}>วางรายชื่อทีละบรรทัด และ/หรืออัปโหลดไฟล์ CSV/Excel</div>
              </div>
              <button onClick={() => setBatchOpen(false)} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 30, height: 30, color: '#fff', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ padding: '18px 20px 22px', fontFamily: FONT }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#475569' }}>วาง/พิมพ์รายชื่อ (1 คน ต่อ 1 บรรทัด — ชื่อ, เบอร์โทร, หรืออีเมลก็ได้)</label>
              <textarea
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                rows={6}
                placeholder={'สมชาย ใจดี\n0812345678\nsomchai@example.com'}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 13.5, resize: 'vertical' }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <button
                  onClick={() => batchFileInputRef.current?.click()}
                  style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(26,39,68,0.14)', background: '#f8fafc', color: '#1a2744', fontFamily: FONT, fontSize: 13, cursor: 'pointer' }}
                >
                  📎 เลือกไฟล์ CSV/Excel
                </button>
                <input
                  ref={batchFileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleBatchFile(f) }}
                />
                {batchFileName && (
                  <span style={{ fontSize: 12.5, color: '#64748b' }}>
                    {batchFileName} ({batchFileRows.length.toLocaleString()} แถว)
                  </span>
                )}
              </div>

              {batchError && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 9, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>⚠️ {batchError}</div>}

              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                <button onClick={() => setBatchOpen(false)} style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 16px', background: '#fff', color: '#64748b', cursor: 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 13 }}>ปิด</button>
                <button onClick={runBatchResolve} disabled={batchLoading} style={{ border: 'none', borderRadius: 10, padding: '9px 18px', background: 'linear-gradient(135deg,#0891b2,#06b6d4)', color: '#fff', cursor: 'pointer', fontFamily: FONT, fontWeight: 800, fontSize: 13 }}>
                  {batchLoading ? 'กำลังตรวจสอบ...' : '🔍 ตรวจสอบทั้งหมด'}
                </button>
              </div>

              {batchSummary && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: '#eef2ff', color: '#1a2744' }}>รวม {batchSummary.total}</span>
                    <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: '#dcfce7', color: '#166534' }}>พบตรง {batchSummary.matched}</span>
                    <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: '#fef3c7', color: '#92400e' }}>ใกล้เคียง {batchSummary.possible}</span>
                    <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: '#fee2e2', color: '#991b1b' }}>ไม่พบ {batchSummary.notFound}</span>
                    {canManage && (
                      <button onClick={exportBatchCsv} style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 999, border: '1px solid rgba(26,39,68,0.14)', background: '#fff', color: '#1a2744', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                        ⬇ Export ผลลัพธ์ CSV
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                    {batchResults?.map(r => (
                      <div key={r.input_index} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid #e4e8f2', background: r.confidence >= 85 ? '#f0fdf4' : r.confidence > 0 ? '#fffbeb' : '#fef2f2' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.input_text}</div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>
                            {r.confidence > 0
                              ? `→ ${r.first_name} ${r.last_name ?? ''} · ${[r.province, r.yec_position].filter(Boolean).join(' · ')}`
                              : (MATCH_TYPE_LABEL[r.match_type] ?? 'ไม่พบข้อมูลที่ตรงกัน')}
                          </div>
                        </div>
                        {r.match_type !== 'empty' && (
                          <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: r.confidence >= 85 ? '#dcfce7' : r.confidence > 0 ? '#fef3c7' : '#fee2e2', color: r.confidence >= 85 ? '#166534' : r.confidence > 0 ? '#92400e' : '#991b1b', flexShrink: 0 }}>
                            {r.confidence}%
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
