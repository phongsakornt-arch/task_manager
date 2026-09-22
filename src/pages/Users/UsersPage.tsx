import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { canViewUsers, canManageUsers } from '../../lib/permissions'
import { useAuthStore } from '../../stores/authStore'
import type { Member, User, UserRole } from '../../types'

type UserWithMember = User & {
  members?: Pick<Member, 'id' | 'name_th' | 'nickname' | 'email' | 'position_committee' | 'province'> | null
}

const ROLES: { value: UserRole; label: string; color: string; bg: string }[] = [
  { value: 'super_admin', label: 'Super Admin', color: '#7c2d12', bg: '#ffedd5' },
  { value: 'admin', label: 'Admin', color: '#1d4ed8', bg: '#eff6ff' },
  { value: 'editor', label: 'Editor', color: '#047857', bg: '#ecfdf5' },
  { value: 'member', label: 'Member', color: '#64748b', bg: '#f8fafc' },
]

const SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

export default function UsersPage() {
  const { user: currentUser, fetchUser } = useAuthStore()
  const [users, setUsers] = useState<UserWithMember[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [passwordTarget, setPasswordTarget] = useState<UserWithMember | null>(null)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('member')
  const [newMemberId, setNewMemberId] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserWithMember | null>(null)
  const [deleting, setDeleting] = useState(false)

  const canView = canViewUsers(currentUser?.role)
  const canManage = canManageUsers(currentUser?.role)

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!canView) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const [usersRes, membersRes] = await Promise.all([
        supabase
          .from('users')
          .select('*, members(id, name_th, nickname, email, position_committee, province)')
          .order('created_at', { ascending: false }),
        supabase
          .from('members')
          .select('*')
          .eq('active', true)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('name_th'),
      ])

      if (!active) return

      if (usersRes.error) {
        setError(usersRes.error.message)
        setUsers([])
      } else {
        setUsers((usersRes.data ?? []) as UserWithMember[])
      }

      if (membersRes.data) setMembers(membersRes.data as Member[])
      setLoading(false)
    }

    load()

    return () => {
      active = false
    }
  }, [canView])

  const counts = useMemo(() => {
    return users.reduce<Record<UserRole | 'all' | 'inactive', number>>((acc, item) => {
      acc.all += 1
      acc[item.role] += 1
      if (!item.active) acc.inactive += 1
      return acc
    }, {
      all: 0,
      super_admin: 0,
      admin: 0,
      editor: 0,
      member: 0,
      inactive: 0,
    })
  }, [users])

  const filteredUsers = useMemo(() => {
    const keyword = normalize(search)
    return users.filter(item => {
      const matchesRole = roleFilter === 'all' || item.role === roleFilter
      const haystack = [
        item.name,
        item.email,
        item.role,
        item.members?.name_th,
        item.members?.nickname,
        item.members?.position_committee,
        item.members?.province,
      ].map(normalize).join(' ')

      return matchesRole && (!keyword || haystack.includes(keyword))
    })
  }, [roleFilter, search, users])

  const updateUser = async (target: UserWithMember, patch: Partial<Pick<User, 'role' | 'active' | 'member_id'>>) => {
    if (!canManage) return
    setSavingId(target.id)
    setError(null)

    const payload = 'member_id' in patch && !patch.member_id
      ? { ...patch, member_id: null }
      : patch

    const { data, error } = await supabase
      .from('users')
      .update(payload)
      .eq('id', target.id)
      .select('*, members(id, name_th, nickname, email, position_committee, province)')
      .single()

    if (error) {
      setError(error.message)
    } else if (data) {
      setUsers(prev => prev.map(item => item.id === target.id ? data as UserWithMember : item))
      if (target.id === currentUser?.id) await fetchUser()
    }

    setSavingId(null)
  }

  const openPasswordModal = (target: UserWithMember) => {
    setPasswordTarget(target)
    setPassword('')
    setPasswordConfirm('')
    setError(null)
    setMessage(null)
  }

  const closePasswordModal = () => {
    setPasswordTarget(null)
    setPassword('')
    setPasswordConfirm('')
  }

  const setUserPassword = async () => {
    if (!canManage || !passwordTarget || savingId) return
    setError(null)
    setMessage(null)

    if (password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
      return
    }
    if (password !== passwordConfirm) {
      setError('รหัสผ่านสองช่องไม่ตรงกัน')
      return
    }

    setSavingId(passwordTarget.id)
    const { data, error } = await supabase.functions.invoke<{ success: boolean; email: string }>('admin-set-user-password', {
      body: { userId: passwordTarget.id, password },
    })

    if (error) {
      setError(error.message)
    } else if (!data?.success) {
      setError('ตั้งรหัสผ่านไม่สำเร็จ')
    } else {
      setMessage(`ตั้งรหัสผ่านให้ ${data.email} แล้ว`)
      closePasswordModal()
    }

    setSavingId(null)
  }

  const openCreateModal = () => {
    setCreateOpen(true)
    setNewEmail('')
    setNewName('')
    setNewPassword('')
    setNewRole('member')
    setNewMemberId('')
    setError(null)
    setMessage(null)
  }

  const closeCreateModal = () => {
    if (creating) return
    setCreateOpen(false)
  }

  const createUser = async () => {
    if (!canManage || creating) return
    setError(null)
    setMessage(null)

    if (!/^\S+@\S+\.\S+$/.test(newEmail)) { setError('กรุณาใส่อีเมลให้ถูกต้อง'); return }
    if (!newName.trim()) { setError('กรุณาใส่ชื่อ'); return }
    if (newPassword.length < 8) { setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return }

    setCreating(true)
    const { data, error } = await supabase.functions.invoke<{ success: boolean; user: UserWithMember }>('admin-create-user', {
      body: { email: newEmail.trim(), name: newName.trim(), password: newPassword, role: newRole, memberId: newMemberId || null },
    })

    if (error) {
      setError(error.message)
    } else if (!data?.success) {
      setError('สร้างผู้ใช้ไม่สำเร็จ')
    } else {
      setUsers(prev => [data.user, ...prev])
      setMessage(`เพิ่มผู้ใช้ ${data.user.email} แล้ว`)
      setCreateOpen(false)
    }
    setCreating(false)
  }

  const confirmDeleteUser = async () => {
    if (!canManage || !deleteTarget || deleting) return
    setError(null)
    setMessage(null)
    setDeleting(true)

    const { data, error } = await supabase.functions.invoke<{ success: boolean; userId: string }>('admin-delete-user', {
      body: { userId: deleteTarget.id },
    })

    if (error) {
      setError(error.message)
    } else if (!data?.success) {
      setError('ลบผู้ใช้ไม่สำเร็จ')
    } else {
      setUsers(prev => prev.filter(item => item.id !== deleteTarget.id))
      setMessage(`ลบผู้ใช้ ${deleteTarget.email} แล้ว`)
      setDeleteTarget(null)
    }
    setDeleting(false)
  }

  const roleMeta = (role: UserRole) => ROLES.find(item => item.value === role) ?? ROLES[3]

  if (!canView) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef0f7', padding: 24 }}>
        <div style={{ maxWidth: 420, borderRadius: 18, background: '#fff', boxShadow: SHADOW, padding: 24, textAlign: 'center', fontFamily: 'Anuphan, sans-serif', color: '#64748b' }}>
          <h1 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 20 }}>ไม่มีสิทธิ์เข้าถึง</h1>
          <p style={{ marginTop: 8 }}>หน้านี้สำหรับ Admin และ Super Admin เท่านั้น</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#eef0f7' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px', background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)', borderBottom: '1px solid #e4e8f2', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', flexShrink: 0 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, boxShadow: '0 4px 14px rgba(26,39,68,0.28)' }}>U</div>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 20, lineHeight: 1.2, color: '#1e293b' }}>จัดการผู้ใช้</h1>
          <p style={{ margin: '2px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#94a3b8' }}>{filteredUsers.length} จาก {users.length} ผู้ใช้</p>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหาชื่อ อีเมล สมาชิก..." style={{ width: 260, padding: '10px 14px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', background: '#f8fafc', color: '#1e293b', fontFamily: 'Anuphan, sans-serif', fontSize: 14 }} />
          <select value={roleFilter} onChange={event => setRoleFilter(event.target.value as UserRole | 'all')} style={{ padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', background: '#fff', color: '#334155', fontFamily: 'Anuphan, sans-serif', fontSize: 14, outline: 'none' }}>
            <option value="all">ทุก role</option>
            {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
          {canManage && (
            <button onClick={openCreateModal} style={{ border: 'none', borderRadius: 12, padding: '10px 16px', background: '#1a2744', color: '#fff', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>
              + เพิ่มผู้ใช้
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[{ value: 'all' as const, label: 'ทั้งหมด', color: '#1a2744', bg: '#fff' }, ...ROLES].map(item => (
            <button key={item.value} onClick={() => setRoleFilter(item.value === 'all' ? 'all' : item.value)} style={{ border: roleFilter === item.value ? `1.5px solid ${item.color}` : '1px solid rgba(15,23,42,0.06)', borderRadius: 14, padding: '12px 14px', background: roleFilter === item.value ? item.bg : '#fff', boxShadow: SHADOW, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ color: item.color, fontFamily: 'Anuphan, sans-serif', fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{counts[item.value]}</div>
              <div style={{ marginTop: 6, color: '#64748b', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>{item.label}</div>
            </button>
          ))}
        </div>

        {error && <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: '#fff7ed', color: '#9a3412', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>{error}</div>}
        {message && <div style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: '#ecfdf5', color: '#047857', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>{message}</div>}

        <div style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid rgba(15,23,42,0.05)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.4fr) 140px minmax(200px, 1fr) 105px 145px 190px', gap: 12, padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2', color: '#64748b', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5 }}>
            <span>ผู้ใช้</span>
            <span>Role</span>
            <span>สมาชิกที่ผูก</span>
            <span>สถานะ</span>
            <span>เข้าใช้ล่าสุด</span>
            <span>จัดการ</span>
          </div>

          {loading && <div style={{ padding: 28, color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', textAlign: 'center' }}>กำลังโหลดผู้ใช้...</div>}
          {!loading && filteredUsers.length === 0 && <div style={{ padding: 28, color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', textAlign: 'center' }}>ไม่พบผู้ใช้ตามเงื่อนไข</div>}

          {!loading && filteredUsers.map(item => {
            const meta = roleMeta(item.role)
            const saving = savingId === item.id
            const lockedSelfSuperAdmin = item.id === currentUser?.id && item.role === 'super_admin'

            return (
              <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.4fr) 140px minmax(200px, 1fr) 105px 145px 190px', gap: 12, alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #f1f5f9', opacity: saving ? 0.65 : 1 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 14.5, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                  <div style={{ marginTop: 2, fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.email}</div>
                </div>

                {canManage ? (
                  <select value={item.role} disabled={saving || lockedSelfSuperAdmin} onChange={event => updateUser(item, { role: event.target.value as UserRole })} style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #e4e8f2', background: lockedSelfSuperAdmin ? '#f8fafc' : meta.bg, color: meta.color, fontFamily: 'Anuphan, sans-serif', outline: 'none' }}>
                    {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                ) : (
                  <span style={{ justifySelf: 'start', padding: '5px 10px', borderRadius: 999, background: meta.bg, color: meta.color, fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 600 }}>{meta.label}</span>
                )}

                {canManage ? (
                  <select value={item.member_id ?? ''} disabled={saving} onChange={event => updateUser(item, { member_id: event.target.value || undefined })} style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #e4e8f2', background: '#fff', color: '#334155', fontFamily: 'Anuphan, sans-serif', outline: 'none' }}>
                    <option value="">ไม่ผูกสมาชิก</option>
                    {members.map(member => <option key={member.id} value={member.id}>{member.name_th}{member.nickname ? ` (${member.nickname})` : ''}</option>)}
                  </select>
                ) : (
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#64748b' }}>{item.members?.name_th ?? '-'}</div>
                )}

                <button disabled={!canManage || saving || lockedSelfSuperAdmin} onClick={() => updateUser(item, { active: !item.active })} style={{ justifySelf: 'start', border: 'none', borderRadius: 999, padding: '6px 11px', background: item.active ? '#ecfdf5' : '#f1f5f9', color: item.active ? '#047857' : '#64748b', cursor: canManage && !lockedSelfSuperAdmin ? 'pointer' : 'default', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 600 }}>
                  {item.active ? 'Active' : 'Inactive'}
                </button>

                <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b' }}>{formatDate(item.last_login ?? item.created_at)}</div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    disabled={!canManage || saving}
                    onClick={() => openPasswordModal(item)}
                    style={{
                      border: 'none',
                      borderRadius: 10,
                      padding: '8px 10px',
                      background: canManage ? '#eef2ff' : '#f1f5f9',
                      color: canManage ? '#1d4ed8' : '#94a3b8',
                      cursor: canManage ? 'pointer' : 'default',
                      fontFamily: 'Anuphan, sans-serif',
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    ตั้งรหัสผ่าน
                  </button>
                  <button
                    disabled={!canManage || saving || item.id === currentUser?.id}
                    onClick={() => setDeleteTarget(item)}
                    title={item.id === currentUser?.id ? 'ลบบัญชีตัวเองไม่ได้' : 'ลบผู้ใช้'}
                    style={{
                      border: 'none',
                      borderRadius: 10,
                      padding: '8px 10px',
                      background: canManage && item.id !== currentUser?.id ? '#fef2f2' : '#f1f5f9',
                      color: canManage && item.id !== currentUser?.id ? '#b91c1c' : '#94a3b8',
                      cursor: canManage && item.id !== currentUser?.id ? 'pointer' : 'default',
                      fontFamily: 'Anuphan, sans-serif',
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {passwordTarget && (
        <div
          onClick={closePasswordModal}
          style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(15,23,42,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{ width: '100%', maxWidth: 430, borderRadius: 20, background: '#fff', boxShadow: '0 24px 80px rgba(0,0,0,0.22)', overflow: 'hidden' }}
          >
            <div style={{ height: 5, background: 'linear-gradient(90deg, #1a2744, #2d4a8a, #c9a84c)' }} />
            <div style={{ padding: 22 }}>
              <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 18, color: '#1e293b' }}>ตั้งรหัสผ่าน</h2>
              <p style={{ margin: '6px 0 18px', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, lineHeight: 1.65, color: '#64748b' }}>
                ผู้ใช้: <strong>{passwordTarget.email}</strong>
              </p>

              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', marginBottom: 7, fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#334155' }}>รหัสผ่านใหม่</span>
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="อย่างน้อย 8 ตัวอักษร"
                  style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #dbe3ef', background: '#f8fafc', color: '#0f172a', outline: 'none', padding: '0 13px', fontFamily: 'Anuphan, sans-serif' }}
                />
              </label>

              <label style={{ display: 'block', marginBottom: 16 }}>
                <span style={{ display: 'block', marginBottom: 7, fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#334155' }}>ยืนยันรหัสผ่าน</span>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={event => setPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                  placeholder="กรอกซ้ำอีกครั้ง"
                  onKeyDown={event => { if (event.key === 'Enter') void setUserPassword() }}
                  style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #dbe3ef', background: '#f8fafc', color: '#0f172a', outline: 'none', padding: '0 13px', fontFamily: 'Anuphan, sans-serif' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={closePasswordModal} style={{ border: 'none', borderRadius: 12, padding: '10px 14px', background: '#f1f5f9', color: '#475569', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif' }}>
                  ยกเลิก
                </button>
                <button disabled={savingId === passwordTarget.id} onClick={setUserPassword} style={{ border: 'none', borderRadius: 12, padding: '10px 15px', background: savingId === passwordTarget.id ? '#94a3b8' : '#1a2744', color: '#fff', cursor: savingId === passwordTarget.id ? 'default' : 'pointer', fontFamily: 'Anuphan, sans-serif' }}>
                  {savingId === passwordTarget.id ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่าน'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div
          onClick={closeCreateModal}
          style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(15,23,42,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, borderRadius: 20, background: '#fff', boxShadow: '0 24px 80px rgba(0,0,0,0.22)', overflow: 'hidden' }}
          >
            <div style={{ height: 5, background: 'linear-gradient(90deg, #1a2744, #2d4a8a, #c9a84c)' }} />
            <div style={{ padding: 22 }}>
              <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 18, color: '#1e293b' }}>เพิ่มผู้ใช้ใหม่</h2>

              <label style={{ display: 'block', marginTop: 16, marginBottom: 12 }}>
                <span style={{ display: 'block', marginBottom: 7, fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#334155' }}>ชื่อ</span>
                <input value={newName} onChange={event => setNewName(event.target.value)} placeholder="ชื่อผู้ใช้" style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #dbe3ef', background: '#f8fafc', color: '#0f172a', outline: 'none', padding: '0 13px', fontFamily: 'Anuphan, sans-serif' }} />
              </label>

              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', marginBottom: 7, fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#334155' }}>อีเมล</span>
                <input type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder="name@thaichamber.org" style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #dbe3ef', background: '#f8fafc', color: '#0f172a', outline: 'none', padding: '0 13px', fontFamily: 'Anuphan, sans-serif' }} />
              </label>

              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', marginBottom: 7, fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#334155' }}>รหัสผ่านเริ่มต้น</span>
                <input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร" style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #dbe3ef', background: '#f8fafc', color: '#0f172a', outline: 'none', padding: '0 13px', fontFamily: 'Anuphan, sans-serif' }} />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
                <label style={{ display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 7, fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#334155' }}>Role</span>
                  <select value={newRole} onChange={event => setNewRole(event.target.value as UserRole)} style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #dbe3ef', background: '#fff', color: '#0f172a', outline: 'none', padding: '0 10px', fontFamily: 'Anuphan, sans-serif' }}>
                    {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </label>
                <label style={{ display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 7, fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#334155' }}>ผูกสมาชิก</span>
                  <select value={newMemberId} onChange={event => setNewMemberId(event.target.value)} style={{ width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #dbe3ef', background: '#fff', color: '#0f172a', outline: 'none', padding: '0 10px', fontFamily: 'Anuphan, sans-serif' }}>
                    <option value="">ไม่ผูกสมาชิก</option>
                    {members.map(member => <option key={member.id} value={member.id}>{member.name_th}</option>)}
                  </select>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={closeCreateModal} style={{ border: 'none', borderRadius: 12, padding: '10px 14px', background: '#f1f5f9', color: '#475569', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif' }}>
                  ยกเลิก
                </button>
                <button disabled={creating} onClick={createUser} style={{ border: 'none', borderRadius: 12, padding: '10px 15px', background: creating ? '#94a3b8' : '#1a2744', color: '#fff', cursor: creating ? 'default' : 'pointer', fontFamily: 'Anuphan, sans-serif' }}>
                  {creating ? 'กำลังสร้าง...' : 'สร้างผู้ใช้'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          onClick={() => !deleting && setDeleteTarget(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(15,23,42,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{ width: '100%', maxWidth: 400, borderRadius: 20, background: '#fff', boxShadow: '0 24px 80px rgba(0,0,0,0.22)', overflow: 'hidden' }}
          >
            <div style={{ height: 5, background: 'linear-gradient(90deg, #dc2626, #f97316)' }} />
            <div style={{ padding: 22 }}>
              <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 18, color: '#1e293b' }}>ลบผู้ใช้</h2>
              <p style={{ margin: '10px 0 18px', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, lineHeight: 1.65, color: '#64748b' }}>
                ยืนยันลบ <strong>{deleteTarget.email}</strong>? ถ้าผู้ใช้นี้มีข้อมูลผูกอยู่ในระบบ (task, เอกสาร, ธุรกรรม) จะลบไม่ได้ — แนะนำปิดการใช้งาน (Inactive) แทนในกรณีนั้น
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setDeleteTarget(null)} style={{ border: 'none', borderRadius: 12, padding: '10px 14px', background: '#f1f5f9', color: '#475569', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif' }}>
                  ยกเลิก
                </button>
                <button disabled={deleting} onClick={confirmDeleteUser} style={{ border: 'none', borderRadius: 12, padding: '10px 15px', background: deleting ? '#94a3b8' : '#dc2626', color: '#fff', cursor: deleting ? 'default' : 'pointer', fontFamily: 'Anuphan, sans-serif' }}>
                  {deleting ? 'กำลังลบ...' : 'ลบผู้ใช้'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
