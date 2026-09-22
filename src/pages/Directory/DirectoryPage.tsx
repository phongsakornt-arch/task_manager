import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { canManageDirectory } from '../../lib/permissions'
import { useAuthStore } from '../../stores/authStore'
import type { Committee, Member } from '../../types'

type DirectoryMember = Member & {
  committees?: Committee | null
}

interface MemberForm {
  committee_id: string
  name_th: string
  name_en: string
  nickname: string
  position_committee: string
  province: string
  email: string
  phone: string
}

interface CommitteeForm {
  name: string
  name_en: string
  color: string
  head_name: string
  head_email: string
}

const EMPTY_FORM: MemberForm = {
  committee_id: '',
  name_th: '',
  name_en: '',
  nickname: '',
  position_committee: '',
  province: '',
  email: '',
  phone: '',
}

const EMPTY_COMMITTEE_FORM: CommitteeForm = {
  name: '',
  name_en: '',
  color: '#c9a84c',
  head_name: '',
  head_email: '',
}

const CARD_SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'

function initials(member: DirectoryMember) {
  const source = member.nickname || member.name_th || member.name_en || '?'
  return source.trim().charAt(0).toUpperCase()
}

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function provinceFromPosition(position?: string | null) {
  const text = (position ?? '').trim()
  if (!text) return null

  const provinceMatch = text.match(/จังหวัด(.+)$/)
  if (provinceMatch?.[1]) return provinceMatch[1].trim()

  const yecMatch = text.match(/YEC\s*(.+)$/i)
  if (yecMatch?.[1]) {
    return yecMatch[1].replace(/^หอการค้า/, '').replace(/[)）]+$/g, '').trim()
  }

  if (!text.includes('หอการค้าไทย') && !text.includes('สภาหอการค้า')) return text
  return null
}

function memberProvince(member: DirectoryMember) {
  return member.province || provinceFromPosition(member.position_yec)
}

function sortMembersBySheetOrder(a: DirectoryMember, b: DirectoryMember) {
  const orderDiff = (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
  if (orderDiff !== 0) return orderDiff
  return a.name_th.localeCompare(b.name_th, 'th')
}

export default function DirectoryPage() {
  const { user } = useAuthStore()
  const [members, setMembers] = useState<DirectoryMember[]>([])
  const [committees, setCommittees] = useState<Committee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [committeeId, setCommitteeId] = useState('all')
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [editingMember, setEditingMember] = useState<DirectoryMember | null>(null)
  const [form, setForm] = useState<MemberForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [committeeModalOpen, setCommitteeModalOpen] = useState(false)
  const [editingCommittee, setEditingCommittee] = useState<Committee | null>(null)
  const [committeeForm, setCommitteeForm] = useState<CommitteeForm>(EMPTY_COMMITTEE_FORM)
  const [committeeSaving, setCommitteeSaving] = useState(false)
  const [committeeDeleting, setCommitteeDeleting] = useState(false)
  const [committeeError, setCommitteeError] = useState<string | null>(null)
  const canManageMembers = canManageDirectory(user?.role)

  // AI Member Search
  const [aiSearchOpen, setAiSearchOpen] = useState(false)
  const [aiSearchQuery, setAiSearchQuery] = useState('')
  const [aiSearchLoading, setAiSearchLoading] = useState(false)
  const [aiMatchedIds, setAiMatchedIds] = useState<Set<string> | null>(null)
  const [aiSearchReason, setAiSearchReason] = useState('')
  const [aiSearchError, setAiSearchError] = useState<string | null>(null)
  const aiSearchInputRef = useRef<HTMLInputElement>(null)

  const loadDirectoryData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [membersRes, committeesRes] = await Promise.all([
      supabase
        .from('members')
        .select('*, committees(*)')
        .eq('active', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name_th', { ascending: true }),
      supabase
        .from('committees')
        .select('*')
        .eq('active', true)
        .order('code', { ascending: true }),
    ])

    if (membersRes.error || committeesRes.error) {
      setError(membersRes.error?.message || committeesRes.error?.message || 'โหลดข้อมูลไม่สำเร็จ')
      setMembers([])
      setCommittees([])
    } else {
      setMembers((membersRes.data ?? []) as DirectoryMember[])
      setCommittees((committeesRes.data ?? []) as Committee[])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true

    Promise.all([
      supabase
        .from('members')
        .select('*, committees(*)')
        .eq('active', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name_th', { ascending: true }),
      supabase
        .from('committees')
        .select('*')
        .eq('active', true)
        .order('code', { ascending: true }),
    ]).then(([membersRes, committeesRes]) => {
        if (!active) return

        if (membersRes.error || committeesRes.error) {
          setError(membersRes.error?.message || committeesRes.error?.message || 'โหลดข้อมูลไม่สำเร็จ')
          setMembers([])
          setCommittees([])
        } else {
          setMembers((membersRes.data ?? []) as DirectoryMember[])
          setCommittees((committeesRes.data ?? []) as Committee[])
        }

        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const filteredMembers = useMemo(() => {
    const keyword = normalize(search)

    return members.filter(member => {
      if (aiMatchedIds && !aiMatchedIds.has(member.id)) return false
      const matchesCommittee = committeeId === 'all' || member.committee_id === committeeId
      const haystack = [
        member.name_th,
        member.name_en,
        member.nickname,
        member.position_committee,
        memberProvince(member),
        member.email,
        member.phone,
        member.committees?.name,
        member.committees?.name_en,
      ].map(normalize).join(' ')

      return matchesCommittee && (!keyword || haystack.includes(keyword))
    })
  }, [aiMatchedIds, committeeId, members, search])

  const committeeGroups = useMemo(() => {
    const groups = new Map<string, { committee: Committee | null; members: DirectoryMember[] }>()

    filteredMembers.forEach(member => {
      const key = member.committees?.id ?? 'none'
      const current = groups.get(key)

      if (current) current.members.push(member)
      else groups.set(key, { committee: member.committees ?? null, members: [member] })
    })

    return Array.from(groups.values()).sort((a, b) => {
      if (!a.committee) return 1
      if (!b.committee) return -1
      return a.committee.name.localeCompare(b.committee.name, 'th')
    }).map(group => ({
      ...group,
      members: [...group.members].sort(sortMembersBySheetOrder),
    }))
  }, [filteredMembers])

  const memberCountByCommittee = useMemo(() => {
    return members.reduce<Record<string, number>>((acc, member) => {
      if (member.committee_id) acc[member.committee_id] = (acc[member.committee_id] ?? 0) + 1
      return acc
    }, {})
  }, [members])

  const openAddModal = () => {
    setEditingMember(null)
    setForm({
      ...EMPTY_FORM,
      committee_id: committeeId !== 'all' ? committeeId : committees[0]?.id ?? '',
    })
    setFormError(null)
    setModalMode('add')
  }

  const openEditModal = (member: DirectoryMember) => {
    setEditingMember(member)
    setForm({
      committee_id: member.committee_id ?? '',
      name_th: member.name_th ?? '',
      name_en: member.name_en ?? '',
      nickname: member.nickname ?? '',
      position_committee: member.position_committee ?? '',
      province: memberProvince(member) ?? '',
      email: member.email ?? '',
      phone: member.phone ?? '',
    })
    setFormError(null)
    setModalMode('edit')
  }

  const closeModal = () => {
    if (saving || deleting) return
    setModalMode(null)
    setEditingMember(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  const updateForm = (field: keyof MemberForm, value: string) => {
    setForm(current => ({ ...current, [field]: value }))
  }

  const saveMember = async () => {
    if (!form.committee_id) {
      setFormError('กรุณาเลือกคณะกรรมการ')
      return
    }
    if (!form.name_th.trim()) {
      setFormError('กรุณากรอกชื่อกรรมการ')
      return
    }

    setSaving(true)
    setFormError(null)

    const payload = {
      committee_id: form.committee_id,
      name_th: form.name_th.trim(),
      name_en: form.name_en.trim() || null,
      nickname: form.nickname.trim() || null,
      position_committee: form.position_committee.trim() || null,
      province: form.province.trim() || null,
      email: form.email.trim().toLowerCase() || null,
      phone: form.phone.trim() || null,
    }

    const result = modalMode === 'edit' && editingMember
      ? await supabase.from('members').update(payload).eq('id', editingMember.id)
      : await supabase.rpc('create_member', {
        p_committee_id: payload.committee_id,
        p_name_th: payload.name_th,
        p_name_en: payload.name_en,
        p_nickname: payload.nickname,
        p_position_committee: payload.position_committee,
        p_province: payload.province,
        p_email: payload.email,
        p_phone: payload.phone,
      })

    if (result.error) {
      setFormError(result.error.message)
      setSaving(false)
      return
    }

    await loadDirectoryData()
    setSaving(false)
    closeModal()
  }

  const deleteMember = async () => {
    if (!editingMember) return

    const ok = window.confirm(`ลบ ${editingMember.name_th} ออกจากทำเนียบคณะกรรมการหรือไม่?`)
    if (!ok) return

    setDeleting(true)
    setFormError(null)

    const { error } = await supabase
      .from('members')
      .update({ active: false })
      .eq('id', editingMember.id)

    if (error) {
      setFormError(error.message)
      setDeleting(false)
      return
    }

    await loadDirectoryData()
    setDeleting(false)
    closeModal()
  }

  const openCommitteeManager = () => {
    setEditingCommittee(null)
    setCommitteeForm(EMPTY_COMMITTEE_FORM)
    setCommitteeError(null)
    setCommitteeModalOpen(true)
  }

  const openAddCommittee = () => {
    setEditingCommittee(null)
    setCommitteeForm(EMPTY_COMMITTEE_FORM)
    setCommitteeError(null)
  }

  const openEditCommittee = (committee: Committee) => {
    setEditingCommittee(committee)
    setCommitteeForm({
      name: committee.name ?? '',
      name_en: committee.name_en ?? '',
      color: committee.color ?? '#c9a84c',
      head_name: committee.head_name ?? '',
      head_email: committee.head_email ?? '',
    })
    setCommitteeError(null)
  }

  const closeCommitteeManager = () => {
    if (committeeSaving || committeeDeleting) return
    setCommitteeModalOpen(false)
    setEditingCommittee(null)
    setCommitteeForm(EMPTY_COMMITTEE_FORM)
    setCommitteeError(null)
  }

  const updateCommitteeForm = (field: keyof CommitteeForm, value: string) => {
    setCommitteeForm(current => ({ ...current, [field]: value }))
  }

  const saveCommittee = async () => {
    if (!committeeForm.name.trim()) {
      setCommitteeError('กรุณากรอกชื่อคณะกรรมการ')
      return
    }

    setCommitteeSaving(true)
    setCommitteeError(null)

    const payload = {
      name: committeeForm.name.trim(),
      name_en: committeeForm.name_en.trim() || null,
      color: committeeForm.color.trim() || '#c9a84c',
      head_name: committeeForm.head_name.trim() || null,
      head_email: committeeForm.head_email.trim().toLowerCase() || null,
    }

    const result = editingCommittee
      ? await supabase.from('committees').update(payload).eq('id', editingCommittee.id)
      : await supabase.rpc('create_committee', {
        p_name: payload.name,
        p_name_en: payload.name_en,
        p_color: payload.color,
        p_head_name: payload.head_name,
        p_head_email: payload.head_email,
      })

    if (result.error) {
      setCommitteeError(result.error.message)
      setCommitteeSaving(false)
      return
    }

    await loadDirectoryData()
    setCommitteeSaving(false)
    openAddCommittee()
  }

  const deleteCommittee = async () => {
    if (!editingCommittee) return

    const count = memberCountByCommittee[editingCommittee.id] ?? 0
    const ok = window.confirm(
      count > 0
        ? `คณะนี้มีกรรมการ ${count} คน ต้องการปิดใช้งานคณะกรรมการนี้หรือไม่?`
        : `ปิดใช้งาน ${editingCommittee.name} หรือไม่?`,
    )
    if (!ok) return

    setCommitteeDeleting(true)
    setCommitteeError(null)

    const { error } = await supabase
      .from('committees')
      .update({ active: false })
      .eq('id', editingCommittee.id)

    if (error) {
      setCommitteeError(error.message)
      setCommitteeDeleting(false)
      return
    }

    if (committeeId === editingCommittee.id) setCommitteeId('all')
    await loadDirectoryData()
    setCommitteeDeleting(false)
    openAddCommittee()
  }

  const runAiSearch = async () => {
    if (!aiSearchQuery.trim() || aiSearchLoading) return
    setAiSearchLoading(true); setAiSearchError(null); setAiMatchedIds(null); setAiSearchReason('')
    const hints = members.map(m => ({
      id: m.id,
      name_th: m.name_th,
      nickname: m.nickname ?? null,
      position_committee: m.position_committee ?? null,
      position_yec: m.position_yec ?? null,
      province: memberProvince(m) ?? null,
      committee: m.committees?.name ?? null,
    }))
    const { data, error } = await supabase.functions.invoke('ai-member-search', {
      body: { query: aiSearchQuery, members: hints },
    })
    setAiSearchLoading(false)
    if (error || data?.error) { setAiSearchError(error?.message ?? data?.error); return }
    setAiMatchedIds(new Set<string>(data?.matched_ids ?? []))
    setAiSearchReason(data?.reasoning ?? '')
    setAiSearchOpen(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#eef0f7' }}>
      <div
        className="flex flex-col md:flex-row md:items-center"
        style={{
          gap: 16,
          padding: '16px 24px',
          background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)',
          borderBottom: '1px solid #e4e8f2',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
          flexShrink: 0,
        }}
      >
        <div className="flex items-center" style={{ gap: 16 }}>
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            flexShrink: 0,
            background: 'linear-gradient(135deg, #1a2744, #2d4a8a)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Anuphan, sans-serif',
            fontWeight: 700,
            boxShadow: '0 4px 14px rgba(26,39,68,0.28)',
          }}>D</div>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 20, lineHeight: 1.2, color: '#1e293b' }}>
              ทำเนียบคณะกรรมการ
            </h1>
            <p style={{ margin: '2px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#94a3b8' }}>
              {filteredMembers.length} จาก {members.length} คน
            </p>
          </div>
        </div>

        <div className="flex flex-wrap md:ml-auto" style={{ gap: 10, alignItems: 'center' }}>
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="ค้นหาชื่อ ตำแหน่ง จังหวัด อีเมล..."
            className="w-full md:w-[240px]"
            style={{ padding: '10px 14px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', background: '#f8fafc', color: '#1e293b', fontFamily: 'Anuphan, sans-serif', fontSize: 14, minWidth: 0 }}
          />
          <button
            onClick={() => { setAiSearchOpen(true); setAiSearchError(null); setTimeout(() => aiSearchInputRef.current?.focus(), 80) }}
            style={{ padding: '10px 14px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontFamily: 'Anuphan, sans-serif', fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 12px rgba(124,58,237,0.28)', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
          >
            ✨ ค้นหาด้วย AI
          </button>
          {aiMatchedIds && (
            <button onClick={() => { setAiMatchedIds(null); setAiSearchReason('') }} style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #c4b5fd', background: '#faf5ff', color: '#7c3aed', fontFamily: 'Anuphan, sans-serif', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ล้าง AI ({aiMatchedIds.size})
            </button>
          )}
          <select
            value={committeeId}
            onChange={event => setCommitteeId(event.target.value)}
            className="w-full md:w-[220px]"
            style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', background: '#fff', color: '#1e293b', fontFamily: 'Anuphan, sans-serif', fontSize: 14, minWidth: 0 }}
          >
            <option value="all">ทุกคณะกรรมการ</option>
            {committees.map(committee => (
              <option key={committee.id} value={committee.id}>
                {committee.name} ({memberCountByCommittee[committee.id] ?? 0})
              </option>
            ))}
          </select>
          {canManageMembers && (
            <>
            <button
              onClick={openCommitteeManager}
              style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(26,39,68,0.14)', background: '#fff', color: '#1a2744', fontFamily: 'Anuphan, sans-serif', fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              จัดการคณะกรรมการ
            </button>
            <button
              onClick={openAddModal}
              style={{ padding: '10px 16px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', fontFamily: 'Anuphan, sans-serif', fontSize: 14, cursor: 'pointer', boxShadow: '0 4px 14px rgba(26,39,68,0.22)', whiteSpace: 'nowrap' }}
            >
              เพิ่มกรรมการ
            </button>
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} style={{ height: 148, borderRadius: 16, background: 'linear-gradient(90deg, #f8fafc, #eef2f7, #f8fafc)', boxShadow: CARD_SHADOW }} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: 18, borderRadius: 16, background: '#fff7ed', color: '#9a3412', fontFamily: 'Anuphan, sans-serif', boxShadow: CARD_SHADOW }}>
            โหลดรายชื่อสมาชิกไม่สำเร็จ: {error}
          </div>
        )}

        {!loading && !error && filteredMembers.length === 0 && (
          <div style={{ height: '100%', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 15 }}>
            ไม่พบสมาชิกตามเงื่อนไขที่เลือก
          </div>
        )}

        {!loading && !error && filteredMembers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {committeeGroups.map(group => {
              const committee = group.committee
              const accent = committee?.color || '#c9a84c'

              return (
                <section key={committee?.id ?? 'none'} style={{ borderRadius: 18, background: 'rgba(255,255,255,0.72)', border: '1px solid rgba(15,23,42,0.05)', boxShadow: '0 8px 24px rgba(26,39,68,0.06)', overflow: 'hidden' }}>
                  <div style={{ height: 5, background: accent }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid rgba(15,23,42,0.06)', background: '#fff' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 12, background: `linear-gradient(135deg, ${accent}, #f0d878)`, color: '#1a2744', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, flexShrink: 0 }}>
                      {(committee?.name ?? 'อื่นๆ').trim().charAt(0)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h2 style={{ margin: 0, color: '#1e293b', fontFamily: 'Anuphan, sans-serif', fontSize: 18, lineHeight: 1.25 }}>
                        {committee?.name || 'ไม่ระบุคณะกรรมการ'}
                      </h2>
                      {committee?.name_en && (
                        <div style={{ marginTop: 2, color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>
                          {committee.name_en}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '5px 11px', borderRadius: 999, background: 'rgba(26,39,68,0.06)', color: '#1a2744', fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {group.members.length} คน
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, padding: 14 }}>
                    {group.members.map(member => (
                      <article key={member.id} style={{ minHeight: 140, borderRadius: 16, background: '#fff', boxShadow: CARD_SHADOW, border: '1px solid rgba(15,23,42,0.05)', overflow: 'hidden' }}>
                        <div style={{ padding: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${accent}, #f0d878)`, color: '#1a2744', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 18 }}>
                              {member.photo_url ? (
                                <img src={member.photo_url} alt={member.name_th} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                              ) : initials(member)}
                            </div>

                            <div style={{ minWidth: 0, flex: 1 }}>
                              <h3 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 16, lineHeight: 1.25, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {member.name_th}
                              </h3>
                              <div style={{ marginTop: 3, color: '#64748b', fontFamily: 'Anuphan, sans-serif', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {member.nickname || member.name_en || '-'}
                              </div>
                            </div>
                          </div>

                          <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
                            {member.position_committee && (
                              <div style={{ color: '#475569', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5 }}>
                                {member.position_committee}
                              </div>
                            )}

                            {memberProvince(member) && (
                              <div style={{ width: 'fit-content', maxWidth: '100%', padding: '4px 9px', borderRadius: 999, background: 'rgba(26,39,68,0.06)', color: '#1a2744', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {memberProvince(member)}
                              </div>
                            )}

                            {(member.email || member.phone) && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', color: '#64748b', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5 }}>
                                {member.email && <span>{member.email}</span>}
                                {member.phone && <span>{member.phone}</span>}
                              </div>
                            )}
                          </div>

                          {canManageMembers && (
                            <button onClick={() => openEditModal(member)} style={{ marginTop: 12, width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(26,39,68,0.12)', background: '#f8fafc', color: '#1a2744', fontFamily: 'Anuphan, sans-serif', fontSize: 13, cursor: 'pointer' }}>
                              แก้ไขข้อมูล
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      {committeeModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(15,23,42,0.38)' }}>
          <div style={{ width: 'min(920px, 100%)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 18, background: '#fff', boxShadow: '0 22px 70px rgba(15,23,42,0.28)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid #e4e8f2' }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 19 }}>
                  จัดการคณะกรรมการ
                </h2>
                <div style={{ marginTop: 2, color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>
                  เพิ่ม แก้ไข หรือปิดใช้งานคณะกรรมการ
                </div>
              </div>
              <button onClick={closeCommitteeManager} disabled={committeeSaving || committeeDeleting} style={{ marginLeft: 'auto', width: 34, height: 34, borderRadius: 10, border: 'none', background: '#f1f5f9', cursor: committeeSaving || committeeDeleting ? 'not-allowed' : 'pointer', color: '#64748b', fontSize: 20 }}>
                x
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.95fr) minmax(320px, 1.05fr)', gap: 0 }}>
              <div style={{ padding: 18, borderRight: '1px solid #e4e8f2', background: '#f8fafc' }}>
                <button onClick={openAddCommittee} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none', background: '#1a2744', color: '#fff', fontFamily: 'Anuphan, sans-serif', cursor: 'pointer', marginBottom: 12 }}>
                  เพิ่มคณะกรรมการใหม่
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {committees.map(committee => {
                    const selected = editingCommittee?.id === committee.id
                    return (
                      <button
                        key={committee.id}
                        onClick={() => openEditCommittee(committee)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 12, border: selected ? '1.5px solid #1a2744' : '1px solid #e4e8f2', background: selected ? '#eef2ff' : '#fff', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: committee.color || '#c9a84c', flexShrink: 0 }} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: 'block', color: '#1e293b', fontFamily: 'Anuphan, sans-serif', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{committee.name}</span>
                          <span style={{ display: 'block', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 12 }}>{memberCountByCommittee[committee.id] ?? 0} คน</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div style={{ padding: 20 }}>
                <h3 style={{ margin: '0 0 14px', fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 17 }}>
                  {editingCommittee ? 'แก้ไขคณะกรรมการ' : 'เพิ่มคณะกรรมการ'}
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
                  {([
                    ['name', 'ชื่อคณะกรรมการ'],
                    ['name_en', 'ชื่ออังกฤษ'],
                    ['color', 'สีประจำคณะ'],
                    ['head_name', 'หัวหน้าคณะ'],
                    ['head_email', 'อีเมลหัวหน้าคณะ'],
                  ] as [keyof CommitteeForm, string][]).map(([field, label]) => (
                    <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: field === 'name' || field === 'head_email' ? '1 / -1' : undefined }}>
                      <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#475569' }}>{label}</span>
                      <input
                        type={field === 'color' ? 'text' : 'text'}
                        value={committeeForm[field]}
                        onChange={event => updateCommitteeForm(field, event.target.value)}
                        placeholder={field === 'color' ? '#c9a84c' : undefined}
                        style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #dbe2ee', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }}
                      />
                    </label>
                  ))}
                </div>

                {committeeError && (
                  <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>
                    {committeeError}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
                  {editingCommittee ? (
                    <button onClick={deleteCommittee} disabled={committeeSaving || committeeDeleting} style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontFamily: 'Anuphan, sans-serif', cursor: committeeSaving || committeeDeleting ? 'not-allowed' : 'pointer' }}>
                      {committeeDeleting ? 'กำลังปิดใช้งาน...' : 'ปิดใช้งานคณะ'}
                    </button>
                  ) : <span />}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={openAddCommittee} disabled={committeeSaving || committeeDeleting} style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #dbe2ee', background: '#fff', color: '#64748b', fontFamily: 'Anuphan, sans-serif', cursor: committeeSaving || committeeDeleting ? 'not-allowed' : 'pointer' }}>
                      ล้างฟอร์ม
                    </button>
                    <button onClick={saveCommittee} disabled={committeeSaving || committeeDeleting} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', fontFamily: 'Anuphan, sans-serif', cursor: committeeSaving || committeeDeleting ? 'not-allowed' : 'pointer', opacity: committeeSaving || committeeDeleting ? 0.7 : 1 }}>
                      {committeeSaving ? 'กำลังบันทึก...' : 'บันทึกคณะกรรมการ'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(15,23,42,0.38)' }}>
          <div style={{ width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 18, background: '#fff', boxShadow: '0 22px 70px rgba(15,23,42,0.28)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid #e4e8f2' }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 19 }}>
                  {modalMode === 'add' ? 'เพิ่มกรรมการ' : 'แก้ไขข้อมูลกรรมการ'}
                </h2>
                <div style={{ marginTop: 2, color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>
                  ตำแหน่งหลักคือข้อมูลจากคอลัมน์ H
                </div>
              </div>
              <button onClick={closeModal} disabled={saving || deleting} style={{ marginLeft: 'auto', width: 34, height: 34, borderRadius: 10, border: 'none', background: '#f1f5f9', cursor: saving || deleting ? 'not-allowed' : 'pointer', color: '#64748b', fontSize: 20 }}>
                x
              </button>
            </div>

            <div style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' }}>
                  <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#475569' }}>คณะกรรมการ</span>
                  <select value={form.committee_id} onChange={event => updateForm('committee_id', event.target.value)} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #dbe2ee', fontFamily: 'Anuphan, sans-serif' }}>
                    <option value="">เลือกคณะกรรมการ</option>
                    {committees.map(committee => (
                      <option key={committee.id} value={committee.id}>{committee.name}</option>
                    ))}
                  </select>
                </label>

                {([
                  ['name_th', 'ชื่อ-นามสกุล'],
                  ['nickname', 'ชื่อเล่น'],
                  ['name_en', 'ชื่ออังกฤษ'],
                  ['position_committee', 'ตำแหน่งในคณะกรรมการ'],
                  ['province', 'จังหวัด'],
                  ['email', 'อีเมล'],
                  ['phone', 'เบอร์โทร'],
                ] as [keyof MemberForm, string][]).map(([field, label]) => (
                  <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: field === 'position_committee' ? '1 / -1' : undefined }}>
                    <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#475569' }}>{label}</span>
                    <input value={form[field]} onChange={event => updateForm(field, event.target.value)} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #dbe2ee', outline: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
                  </label>
                ))}
              </div>

              {formError && (
                <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
                {modalMode === 'edit' ? (
                  <button onClick={deleteMember} disabled={saving || deleting} style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontFamily: 'Anuphan, sans-serif', cursor: saving || deleting ? 'not-allowed' : 'pointer' }}>
                    {deleting ? 'กำลังลบ...' : 'ลบกรรมการ'}
                  </button>
                ) : <span />}

                <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={closeModal} disabled={saving || deleting} style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #dbe2ee', background: '#fff', color: '#64748b', fontFamily: 'Anuphan, sans-serif', cursor: saving || deleting ? 'not-allowed' : 'pointer' }}>
                  ยกเลิก
                </button>
                <button onClick={saveMember} disabled={saving || deleting} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', fontFamily: 'Anuphan, sans-serif', cursor: saving || deleting ? 'not-allowed' : 'pointer', opacity: saving || deleting ? 0.7 : 1 }}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI MEMBER SEARCH POPUP */}
      {aiSearchOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setAiSearchOpen(false) }}>
          <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 500, boxShadow: '0 24px 64px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔍</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: 'Anuphan, sans-serif' }}>AI ค้นหาสมาชิก</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: 'Anuphan, sans-serif' }}>บรรยายคนที่ต้องการ AI จะหาให้</div>
              </div>
              <button onClick={() => setAiSearchOpen(false)} style={{ border: 'none', background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 30, height: 30, color: '#fff', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ padding: '18px 20px 22px', fontFamily: 'Anuphan, sans-serif' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {['คนที่ดูแลด้านการตลาด', 'กรรมการจากเชียงใหม่', 'ประธานคณะ', 'สมาชิกที่มีชื่อเล่นขึ้นต้นด้วย เอ'].map(ex => (
                  <button key={ex} onClick={() => setAiSearchQuery(ex)} style={{ border: '1.5px solid #e9d5ff', borderRadius: 20, padding: '4px 10px', background: '#faf5ff', color: '#7c3aed', fontSize: 12, cursor: 'pointer', fontFamily: 'Anuphan, sans-serif' }}>{ex}</button>
                ))}
              </div>
              <input
                ref={aiSearchInputRef}
                value={aiSearchQuery}
                onChange={e => setAiSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runAiSearch() }}
                placeholder='เช่น "กรรมการจากภาคเหนือที่ดูแลด้านการตลาด"'
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', borderRadius: 12, border: '1.5px solid #e9d5ff', fontFamily: 'Anuphan, sans-serif', fontSize: 14, outline: 'none', background: '#faf5ff' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.background = '#fff' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e9d5ff'; e.currentTarget.style.background = '#faf5ff' }}
              />
              {aiSearchError && <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 9, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>⚠️ {aiSearchError}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button onClick={() => setAiSearchOpen(false)} style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '9px 16px', background: '#fff', color: '#64748b', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 13 }}>ยกเลิก</button>
                <button onClick={runAiSearch} disabled={!aiSearchQuery.trim() || aiSearchLoading} style={{ border: 'none', borderRadius: 10, padding: '9px 18px', background: aiSearchQuery.trim() ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#e9d5ff', color: aiSearchQuery.trim() ? '#fff' : '#a78bfa', cursor: aiSearchQuery.trim() ? 'pointer' : 'default', fontFamily: 'Anuphan, sans-serif', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {aiSearchLoading ? <><span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />กำลังค้นหา...</> : '🔍 ค้นหา'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI SEARCH REASON BANNER */}
      {aiMatchedIds && aiSearchReason && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#4c1d95', color: '#fff', borderRadius: 12, padding: '10px 18px', fontFamily: 'Anuphan, sans-serif', fontSize: 13, boxShadow: '0 8px 24px rgba(124,58,237,0.35)', zIndex: 50, maxWidth: 480, textAlign: 'center' }}>
          ✨ {aiSearchReason}
        </div>
      )}
    </div>
  )
}
