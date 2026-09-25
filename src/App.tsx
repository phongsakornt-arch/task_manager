import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuthStore } from './stores/authStore'
import { canViewUsers, canManageSystem, canEditMeetings } from './lib/permissions'
import type { UserRole } from './types'
import AppShell from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import AuthCallback from './pages/AuthCallback'
import BoardPage from './pages/Board/BoardPage'
import AnnualPage from './pages/Annual/AnnualPage'
import DirectoryPage from './pages/Directory/DirectoryPage'
import ApprovalPublicPage from './pages/Approval/ApprovalPublicPage'
import CheckInPublicPage from './pages/CheckIn/CheckInPublicPage'
import TodoPage from './pages/Todo/TodoPage'
import SystemPage from './pages/System/SystemPage'

// Code-split the larger/less-frequently-entered pages so the initial bundle
// stays small; BoardPage (the landing page) and the always-needed shell
// pages above stay eager.
const PendingPage = lazy(() => import('./pages/Pending/PendingPage'))
const CalendarPage = lazy(() => import('./pages/Calendar/CalendarPage'))
const BudgetPage = lazy(() => import('./pages/Budget/BudgetPage'))
const ApprovalPage = lazy(() => import('./pages/Approval/ApprovalPage'))
const UsersPage = lazy(() => import('./pages/Users/UsersPage'))
const CheckInAdminPage = lazy(() => import('./pages/CheckIn/CheckInAdminPage'))
const MasterDataPage = lazy(() => import('./pages/MasterData/MasterDataPage'))

function PageLoader() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="w-8 h-8 border-4 border-[#1a2744] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthStore()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f6fa]">
      <div className="w-8 h-8 border-4 border-[#1a2744] border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireRole({ children, check }: { children: React.ReactNode; check: (role?: UserRole | null) => boolean }) {
  const { user, loading } = useAuthStore()
  if (loading) return null
  if (!check(user?.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { setSession, fetchUser } = useAuthStore()

  useEffect(() => {
    fetchUser()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [fetchUser, setSession])

  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/approval/public" element={<ApprovalPublicPage />} />
        <Route path="/checkin" element={<CheckInPublicPage />} />
        <Route path="/" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<BoardPage />} />
          <Route path="pending" element={<PendingPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="annual" element={<AnnualPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="directory" element={<DirectoryPage />} />
          <Route path="master-data" element={<MasterDataPage />} />
          <Route path="approval" element={<ApprovalPage />} />
          <Route path="todo" element={<TodoPage />} />
          <Route path="meetings" element={<RequireRole check={canEditMeetings}><CheckInAdminPage /></RequireRole>} />
          <Route path="users" element={<RequireRole check={canViewUsers}><UsersPage /></RequireRole>} />
          <Route path="system" element={<RequireRole check={canManageSystem}><SystemPage /></RequireRole>} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
