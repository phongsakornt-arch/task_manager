import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { canViewUsers, canManageSystem, canEditMeetings } from '../lib/permissions'

const navItems = [
  { to: '/',          icon: '▦', label: 'Board' },
  { to: '/todo',      icon: '☑', label: 'Kanban' },
  { to: '/pending',   icon: '◷', label: 'งานค้าง' },
  { to: '/calendar',  icon: '▤', label: 'ปฏิทิน' },
  { to: '/annual',    icon: '▣', label: 'รายปี' },
  { to: '/budget',    icon: '◈', label: 'งบประมาณ' },
  { to: '/directory', icon: '◉', label: 'ทำเนียบ' },
  { to: '/approval',  icon: '◎', label: 'อนุมัติ' },
]

const adminNavItems = [
  { to: '/meetings', icon: '✓', label: 'เช็คชื่อ' },
  { to: '/users', icon: 'U', label: 'Users' },
  { to: '/system', icon: 'S', label: 'System' },
]

export default function AppShell() {
  const { user, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const visibleAdminItems = adminNavItems.filter(item => {
    if (item.to === '/meetings') return canEditMeetings(user?.role)
    if (item.to === '/users') return canViewUsers(user?.role)
    if (item.to === '/system') return canManageSystem(user?.role)
    return false
  })
  const visibleNavItems = visibleAdminItems.length > 0
    ? [...navItems, ...visibleAdminItems]
    : navItems

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Mobile top bar — hamburger + logo, only shown below md.
          Deliberately NOT position:fixed: it sits in normal document flow,
          stacked above the row below, so it always pushes content down by
          its own real height with no padding-offset math that can drift
          out of sync (that mismatch was the cause of the header-overlap bug).
          display must come from the className (not inline style), since an
          inline `display` would always beat the md:hidden media-query class. */}
      <div
        className="flex md:hidden"
        style={{
          flexShrink: 0, zIndex: 30,
          alignItems: 'center', gap: 10,
          padding: '10px 14px', height: 52,
          background: 'linear-gradient(135deg, #0d1b3e 0%, #1e3a6e 100%)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.22)',
        }}
      >
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="เปิดเมนู"
          style={{ width: 36, height: 36, flexShrink: 0, border: 'none', borderRadius: 10, background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 18, cursor: 'pointer' }}
        >
          ☰
        </button>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(135deg, #c9a84c 0%, #f0d878 50%, #c9a84c 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 14, color: '#1a2744',
        }}>Y</div>
        <div style={{ fontFamily: 'Anuphan, sans-serif', fontWeight: 600, fontSize: 14, color: '#fff' }}>YEC Task Manager</div>
      </div>

      {/* Row: sidebar + main content, fills remaining height below the mobile top bar */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* Backdrop for mobile drawer */}
      {mobileNavOpen && (
        <div
          className="md:hidden"
          onClick={() => setMobileNavOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 39, background: 'rgba(15,23,42,0.5)' }}
        />
      )}

      {/* Sidebar — static column on desktop, slide-in drawer on mobile */}
      <aside
        className={mobileNavOpen ? 'flex' : 'hidden md:flex'}
        style={{
          width: 230,
          flexShrink: 0,
          flexDirection: 'column',
          background: 'linear-gradient(175deg, #0d1b3e 0%, #162548 45%, #1e3a6e 100%)',
          boxShadow: '4px 0 32px rgba(0,0,0,0.22)',
          overflow: 'hidden',
          position: mobileNavOpen ? 'fixed' : 'relative',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 40,
        }}
      >

        {/* Decorative glow */}
        <div style={{
          position: 'absolute', top: -60, left: -60,
          width: 180, height: 180, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(201,168,76,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Logo */}
        <div style={{ padding: '22px 18px 16px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: 'linear-gradient(135deg, #c9a84c 0%, #f0d878 50%, #c9a84c 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 20, color: '#1a2744',
              boxShadow: '0 4px 14px rgba(201,168,76,0.4)',
            }}>Y</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontWeight: 600, fontSize: 14.5, color: '#fff', letterSpacing: 0.3 }}>
                YEC Task Manager
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>หอการค้าไทย</div>
            </div>
            <button
              onClick={() => setMobileNavOpen(false)}
              className="md:hidden"
              aria-label="ปิดเมนู"
              style={{ width: 30, height: 30, flexShrink: 0, border: 'none', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', fontSize: 15, cursor: 'pointer' }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ height: 1, margin: '0 16px 10px', background: 'rgba(255,255,255,0.08)' }} />

        {/* Nav */}
        <nav style={{ flex: 1, padding: '4px 10px', overflowY: 'auto' }}>
          {visibleNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileNavOpen(false)}
              children={({ isActive }) => (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 11,
                  padding: '10px 14px', borderRadius: 12, marginBottom: 3,
                  cursor: 'pointer',
                  fontFamily: 'Anuphan, sans-serif', fontSize: 14.5,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#1a2744' : 'rgba(255,255,255,0.6)',
                  background: isActive
                    ? 'linear-gradient(135deg, #c9a84c 0%, #e8d068 100%)'
                    : 'transparent',
                  boxShadow: isActive ? '0 4px 14px rgba(201,168,76,0.35)' : 'none',
                  transition: 'all 0.18s',
                }}>
                  <span style={{ fontSize: 17, width: 22, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              )}
            />
          ))}
        </nav>

        <div style={{ height: 1, margin: '8px 16px', background: 'rgba(255,255,255,0.08)' }} />

        {/* User */}
        <div style={{ padding: '10px 10px 20px' }}>
          {user && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 12, marginBottom: 6,
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #c9a84c, #e8d068)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 16, color: '#1a2744',
                boxShadow: '0 2px 8px rgba(201,168,76,0.3)',
              }}>
                {(user.name || user.email || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.name}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(201,168,76,0.85)', textTransform: 'capitalize', marginTop: 1 }}>
                  {user.role}
                </div>
              </div>
            </div>
          )}
          <button
            onClick={handleSignOut}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 10, border: 'none',
              background: 'transparent', cursor: 'pointer',
              fontFamily: 'Anuphan, sans-serif', fontSize: 13,
              color: 'rgba(255,255,255,0.35)',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.72)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}
          >
            <span style={{ fontSize: 15 }}>↩</span> ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  )
}
