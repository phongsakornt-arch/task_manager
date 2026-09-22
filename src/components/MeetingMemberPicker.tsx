import { useMemo, useState } from 'react'
import type { Committee, Member } from '../types'

const FONT = 'Anuphan, sans-serif'

function displayName(m: Member) {
  return m.nickname ? `${m.name_th} (${m.nickname})` : m.name_th
}

interface Props {
  open: boolean
  onClose: () => void
  committees: Committee[]
  members: Member[]
  selectedIds: Set<string>
  onChange: (next: Set<string>) => void
}

export default function MeetingMemberPicker({ open, onClose, committees, members, selectedIds, onChange }: Props) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const groups = useMemo(() => {
    const byCommittee = new Map<string, Member[]>()
    const unassigned: Member[] = []
    for (const m of members) {
      if (m.committee_id) {
        if (!byCommittee.has(m.committee_id)) byCommittee.set(m.committee_id, [])
        byCommittee.get(m.committee_id)!.push(m)
      } else {
        unassigned.push(m)
      }
    }
    const list = committees.map(c => ({ id: c.id, name: c.name, color: c.color, members: byCommittee.get(c.id) ?? [] }))
    if (unassigned.length) list.push({ id: '__unassigned', name: 'ไม่มีคณะ', color: undefined, members: unassigned })
    return list.filter(g => g.members.length > 0)
  }, [committees, members])

  const q = search.trim().toLowerCase()
  const visibleGroups = useMemo(() => {
    if (!q) return groups.map(g => ({ ...g, filtered: g.members }))
    return groups
      .map(g => ({ ...g, filtered: g.members.filter(m => `${m.name_th} ${m.nickname ?? ''}`.toLowerCase().includes(q)) }))
      .filter(g => g.filtered.length > 0)
  }, [groups, q])

  if (!open) return null

  function toggleMember(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange(next)
  }
  function toggleGroup(groupMembers: Member[]) {
    const allSelected = groupMembers.length > 0 && groupMembers.every(m => selectedIds.has(m.id))
    const next = new Set(selectedIds)
    for (const m of groupMembers) { if (allSelected) next.delete(m.id); else next.add(m.id) }
    onChange(next)
  }
  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAll() {
    const next = new Set(selectedIds)
    for (const m of members) next.add(m.id)
    onChange(next)
  }
  function clearAll() { onChange(new Set()) }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, borderBottom: '1px solid #f1f5f9', padding: '16px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontFamily: FONT, fontSize: 16, fontWeight: 800, color: '#1e293b' }}>เลือกกรรมการ</h2>
          <button onClick={onClose} type="button" style={{ width: 34, height: 34, borderRadius: 999, border: 'none', background: '#f1f5f9', color: '#64748b', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อหรือชื่อเล่น..."
          style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#f8fafc', fontFamily: FONT, fontSize: 14.5, outline: 'none', marginBottom: 10 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={selectAll} style={{ border: 'none', background: 'none', color: '#1d4ed8', fontFamily: FONT, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>เลือกทั้งหมด</button>
          <span style={{ color: '#cbd5e1' }}>|</span>
          <button type="button" onClick={clearAll} style={{ border: 'none', background: 'none', color: '#1d4ed8', fontFamily: FONT, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>ล้างทั้งหมด</button>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: '#94a3b8', fontFamily: FONT }}>เลือกแล้ว {selectedIds.size}/{members.length} คน</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {visibleGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: '#94a3b8', fontFamily: FONT, fontSize: 14 }}>ไม่พบชื่อที่ค้นหา</div>
        ) : (
          visibleGroups.map(g => {
            const isOpen = q ? true : expanded.has(g.id)
            const selCount = g.members.filter(m => selectedIds.has(m.id)).length
            const allSelected = g.members.length > 0 && selCount === g.members.length
            return (
              <div key={g.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
                  <input type="checkbox" checked={allSelected} onChange={() => toggleGroup(g.members)} style={{ width: 18, height: 18, flexShrink: 0 }} />
                  <button
                    type="button"
                    onClick={() => toggleExpand(g.id)}
                    style={{ flex: 1, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {g.color && <span style={{ width: 10, height: 10, borderRadius: 999, background: g.color, flexShrink: 0 }} />}
                      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>
                      <span>{selCount}/{g.members.length}</span>
                      <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>›</span>
                    </span>
                  </button>
                </div>
                {isOpen && (
                  <div style={{ paddingBottom: 4 }}>
                    {g.filtered.map(m => (
                      <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 42, paddingRight: 12, minHeight: 44, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleMember(m.id)} style={{ width: 18, height: 18, flexShrink: 0 }} />
                        <span style={{ fontFamily: FONT, fontSize: 13.5, color: '#334155' }}>{displayName(m)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div style={{ flexShrink: 0, borderTop: '1px solid #f1f5f9', padding: '12px 16px calc(env(safe-area-inset-bottom) + 12px)' }}>
        <button
          onClick={onClose}
          type="button"
          style={{ width: '100%', height: 48, borderRadius: 12, border: 'none', background: '#1a2744', color: '#fff', fontFamily: FONT, fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}
        >
          เสร็จสิ้น ({selectedIds.size} คน)
        </button>
      </div>
    </div>
  )
}
