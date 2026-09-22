import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { canManageSystem } from '../../lib/permissions'
import { useAuthStore } from '../../stores/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthResult = {
  success: boolean
  checkedAt: string
  config: Record<string, boolean>
  tables: { table: string; ok: boolean; count: number; error?: string | null }[]
  readyForExternalProviders: boolean
}

type BackupItem = {
  id: string
  createdAt: string
  createdBy: string
  detail: string
  manifest?: {
    tableCount?: number
    rowCounts?: Record<string, number>
  }
}

type ReminderResult = {
  success: boolean
  targetDate: string
  candidates: number
  sentOrPreviewed: number
  pending: number
  tasks: { id: string; title: string; assigneeEmails: string[]; alreadyHandled: boolean }[]
}

type ResyncResult = {
  success: boolean
  status: string
  count: number
  payloads?: { taskId: string; payload: unknown }[]
}

/** ผลการตรวจสอบสถานะก่อน Sync Google Calendar */
type CalendarCheckResult = {
  checkedAt: string
  total: number                     // งานทั้งหมดที่มีวันที่
  willCreate: CalendarTaskRow[]     // ยังไม่มี event_id → จะสร้างใหม่
  willUpdate: CalendarTaskRow[]     // มี event_id → จะ PATCH (อัพเดต)
  willSkip: CalendarTaskRow[]       // hash ไม่เปลี่ยน → จะข้าม
  riskDuplicate: CalendarTaskRow[]  // เคย sync แล้ว แต่หาย event_id → เสี่ยงซ้ำ
}

type CalendarTaskRow = {
  id: string
  title: string
  start_date?: string | null
  end_date?: string | null
  calendar_event_id?: string | null
  calendar_sync_status?: string | null
  calendar_last_sync_at?: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayOffset(days: number) {
  const now = new Date()
  now.setDate(now.getDate() + days)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SystemPage() {
  const { user } = useAuthStore()
  const canManage = canManageSystem(user?.role)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Health
  const [health, setHealth] = useState<HealthResult | null>(null)

  // Backup
  const [backups, setBackups] = useState<BackupItem[]>([])
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null)

  // Reminder
  const [reminderDate, setReminderDate] = useState(todayOffset(1))
  const [reminder, setReminder] = useState<ReminderResult | null>(null)

  // Calendar Check
  const [calCheck, setCalCheck] = useState<CalendarCheckResult | null>(null)
  const [calCheckOpen, setCalCheckOpen] = useState(false)

  // Calendar Resync
  const [resync, setResync] = useState<ResyncResult | null>(null)

  // Google Calendar OAuth connection
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; connectedEmail: string | null } | null>(null)
  const [googleConnectMessage, setGoogleConnectMessage] = useState<string | null>(null)

  const configRows = useMemo(() => Object.entries(health?.config ?? {}), [health])

  // ── Generic invoke ──────────────────────────────────────────────────────────
  const invoke = async <T,>(name: string, body?: Record<string, unknown>) => {
    setBusy(name)
    setError(null)
    const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} })
    setBusy(null)
    if (error) { setError(error.message); return null }
    return data ?? null
  }

  // ── Google Calendar connection ──────────────────────────────────────────────
  const loadGoogleStatus = async () => {
    const result = await invoke<{ success: boolean; connected: boolean; connectedEmail: string | null }>('google-oauth-status')
    if (result) setGoogleStatus(result)
  }

  const connectGoogleCalendar = async () => {
    const result = await invoke<{ success: boolean; url: string }>('google-oauth-start')
    if (result?.url) window.location.href = result.url
  }

  useEffect(() => {
    loadGoogleStatus()
    const params = new URLSearchParams(window.location.search)
    const status = params.get('google_calendar')
    if (status === 'connected') {
      setGoogleConnectMessage('เชื่อมต่อ Google Calendar สำเร็จแล้ว')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (status === 'error') {
      setGoogleConnectMessage(`เชื่อมต่อไม่สำเร็จ: ${params.get('message') || 'unknown error'}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
    // Standard fetch-on-mount pattern; loadGoogleStatus sets state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Health Check ────────────────────────────────────────────────────────────
  const runHealth = async () => {
    const result = await invoke<HealthResult>('system-health')
    if (result) setHealth(result)
  }

  // ── Backup ──────────────────────────────────────────────────────────────────
  const runBackup = async () => {
    const result = await invoke<{ success: boolean; manifest: unknown; snapshot: unknown }>('backup-snapshot')
    if (result) {
      downloadJson(`yec-backup-${new Date().toISOString().slice(0, 10)}.json`, result)
      await listBackups()
    }
  }

  const listBackups = async () => {
    const result = await invoke<{ success: boolean; backups: BackupItem[] }>('list-backups', { limit: 20 })
    if (result) setBackups(result.backups ?? [])
  }

  const restoreLatest = async () => {
    const result = await invoke<{ status?: string; message?: string; error?: string }>('restore-latest-backup')
    if (result) setRestoreStatus(result.message || result.status || result.error || 'restore requested')
  }

  // ── Reminder Stats ──────────────────────────────────────────────────────────
  const runReminderStats = async () => {
    const result = await invoke<ReminderResult>('reminder-stats', { date: reminderDate })
    if (result) setReminder(result)
  }

  // ── Calendar Check (client-side query ไม่ต้องการ edge function ใหม่) ─────────
  const runCalendarCheck = async () => {
    setBusy('calendar-check')
    setError(null)
    setCalCheck(null)

    const { data, error: dbErr } = await supabase
      .from('tasks')
      .select('id, title, start_date, end_date, calendar_event_id, calendar_sync_status, calendar_last_sync_at')
      .eq('deleted', false)
      .or('start_date.not.is.null,end_date.not.is.null')
      .order('start_date', { ascending: true, nullsFirst: false })
      .limit(500)

    setBusy(null)

    if (dbErr) { setError(dbErr.message); return }

    const rows = (data ?? []) as CalendarTaskRow[]

    const willCreate: CalendarTaskRow[] = []
    const willUpdate: CalendarTaskRow[] = []
    const willSkip: CalendarTaskRow[] = []
    const riskDuplicate: CalendarTaskRow[] = []

    rows.forEach(row => {
      const hasSynced = row.calendar_sync_status === 'synced_yec_calendar' || row.calendar_sync_status === 'skipped_no_change'
      const hasEventId = Boolean(row.calendar_event_id)

      if (hasEventId) {
        // มี event_id → sync จะ PATCH (อัพเดต) ไม่สร้างซ้ำ
        willUpdate.push(row)
      } else if (hasSynced && !hasEventId) {
        // เคย sync สำเร็จแต่ไม่มี event_id ในฐานข้อมูล → เสี่ยงสร้างซ้ำ
        riskDuplicate.push(row)
      } else if (row.calendar_sync_status === 'skipped_no_change') {
        willSkip.push(row)
      } else {
        // ยังไม่มี event_id และไม่เคย sync → จะสร้างใหม่ (ปกติ)
        willCreate.push(row)
      }
    })

    setCalCheck({
      checkedAt: new Date().toISOString(),
      total: rows.length,
      willCreate,
      willUpdate,
      willSkip,
      riskDuplicate,
    })
    setCalCheckOpen(true)
  }

  // ── Calendar Resync ─────────────────────────────────────────────────────────
  const runResync = async (dryRun = true) => {
    const result = await invoke<ResyncResult>('resync-task-calendar', { dryRun, limit: 300 })
    if (result) setResync(result)
  }

  // ── Access guard ─────────────────────────────────────────────────────────────
  if (!canManage) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef0f7', color: '#64748b', fontFamily: 'Anuphan, sans-serif' }}>
        เฉพาะ admin / super_admin เท่านั้น
      </div>
    )
  }

  const hasDuplicateRisk = (calCheck?.riskDuplicate.length ?? 0) > 0

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#eef0f7' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px', background: 'linear-gradient(135deg, #fff 0%, #f8faff 100%)', borderBottom: '1px solid #e4e8f2', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 18 }}>⚙</div>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 20, color: '#1e293b' }}>ระบบ (System)</h1>
          <p style={{ margin: '2px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#94a3b8' }}>ตรวจสุขภาพ · สำรองข้อมูล · แจ้งเตือน · ปฏิทิน</p>
        </div>
      </div>

      <div style={{ padding: 24, display: 'grid', gap: 16 }}>
        {error && (
          <div style={{ padding: 14, borderRadius: 14, background: '#fff7ed', color: '#9a3412', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── 1. Health Check ─────────────────────────────────────────────── */}
        <Section
          icon="🩺"
          title="ตรวจสุขภาพระบบ"
          desc="ตรวจสอบตารางข้อมูลทั้งหมดว่า query ได้ปกติ และดูว่า API keys ที่จำเป็น (Google, Groq, Gemini ฯลฯ) ถูกตั้งค่าครบหรือยัง"
          action={<button disabled={busy === 'system-health'} onClick={runHealth} style={btnStyle('#1a2744', '#fff')}>{busy === 'system-health' ? 'กำลังตรวจ...' : '🔍 ตรวจสอบ'}</button>}
        >
          {health && (
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {configRows.map(([key, ok]) => (
                  <span key={key} style={{ borderRadius: 999, padding: '5px 10px', background: ok ? '#ecfdf5' : '#fef2f2', color: ok ? '#047857' : '#b91c1c', fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 600 }}>
                    {ok ? '✓' : '✗'} {key}
                  </span>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                {health.tables.map(table => (
                  <div key={table.table} style={{ borderRadius: 12, background: table.ok ? '#f8fafc' : '#fef2f2', padding: '10px 12px', border: `1px solid ${table.ok ? '#e4e8f2' : '#fca5a5'}` }}>
                    <div style={{ fontFamily: 'Anuphan, sans-serif', color: table.ok ? '#1e293b' : '#b91c1c', fontSize: 13, fontWeight: 600 }}>{table.table}</div>
                    <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#64748b', fontSize: 12 }}>{table.ok ? `${table.count.toLocaleString()} rows` : table.error}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#94a3b8' }}>ตรวจเมื่อ {formatDate(health.checkedAt)}</div>
            </div>
          )}
        </Section>

        {/* ── 2. Backup ────────────────────────────────────────────────────── */}
        <Section
          icon="💾"
          title="สำรองข้อมูล (Backup)"
          desc="สร้าง snapshot JSON ของข้อมูลทั้งหมดในฐานข้อมูล และดาวน์โหลดอัตโนมัติ · ดูรายการ backup ที่ผ่านมา · กู้คืนข้อมูลจาก backup ล่าสุด (ต้องระวัง: ข้อมูลปัจจุบันจะถูกแทนที่)"
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button disabled={busy === 'backup-snapshot'} onClick={runBackup} style={btnStyle('#1a2744', '#fff')}>{busy === 'backup-snapshot' ? 'กำลัง backup...' : '⬇ Backup ตอนนี้'}</button>
              <button disabled={busy === 'list-backups'} onClick={listBackups} style={btnStyle('#f1f5f9', '#334155')}>📋 รายการ</button>
              <button disabled={busy === 'restore-latest-backup'} onClick={restoreLatest} style={btnStyle('#fff7ed', '#c2410c')}>⏪ Restore ล่าสุด</button>
            </div>
          }
        >
          {restoreStatus && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, background: '#fff7ed', color: '#c2410c', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>
              {restoreStatus}
            </div>
          )}
          {backups.length > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
              {backups.map(backup => (
                <div key={backup.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, padding: '10px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e4e8f2', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'Anuphan, sans-serif', color: '#64748b', fontSize: 12 }}>{new Date(backup.createdAt).toLocaleString('th-TH', { hour12: false })}</span>
                  <span style={{ fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 13 }}>{backup.createdBy}</span>
                  <span style={{ fontFamily: 'Anuphan, sans-serif', color: '#64748b', fontSize: 12 }}>{backup.manifest?.tableCount ?? '-'} tables</span>
                </div>
              ))}
            </div>
          )}
          {backups.length === 0 && !busy && (
            <p style={{ margin: '10px 0 0', fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#94a3b8' }}>กด "รายการ" เพื่อโหลดประวัติ backup</p>
          )}
        </Section>

        {/* ── 3. Reminder Stats ────────────────────────────────────────────── */}
        <Section
          icon="🔔"
          title="ตรวจสอบการแจ้งเตือน (Reminder Stats)"
          desc="ดูรายการงานที่ครบกำหนดในวันที่เลือก พร้อมสถานะการส่งอีเมลแจ้งเตือนว่าส่งแล้วหรือยังค้างอยู่ ใช้เพื่อ debug ว่า reminder ทำงานถูกต้องหรือไม่"
          action={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="date"
                value={reminderDate}
                onChange={e => setReminderDate(e.target.value)}
                style={{ padding: '9px 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', fontFamily: 'Anuphan, sans-serif', fontSize: 13, outline: 'none' }}
              />
              <button disabled={busy === 'reminder-stats'} onClick={runReminderStats} style={btnStyle('#1a2744', '#fff')}>{busy === 'reminder-stats' ? 'กำลังตรวจ...' : '🔍 ตรวจสอบ'}</button>
            </div>
          }
        >
          {reminder && (
            <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'งานทั้งหมด', value: reminder.candidates, color: '#1a2744' },
                  { label: 'ส่งแล้ว', value: reminder.sentOrPreviewed, color: '#047857' },
                  { label: 'ยังค้าง', value: reminder.pending, color: '#b45309' },
                ].map(stat => (
                  <div key={stat.label} style={{ borderRadius: 12, background: '#f8fafc', border: '1px solid #e4e8f2', padding: '10px 16px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#64748b' }}>{stat.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {reminder.tasks.slice(0, 12).map(task => (
                  <div key={task.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 8, background: task.alreadyHandled ? '#f0fdf4' : '#fffbeb' }}>
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{task.alreadyHandled ? '✅' : '⏳'}</span>
                    <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                    <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11, color: '#94a3b8' }}>{task.assigneeEmails.length} คน</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ── Google Calendar OAuth connection ─────────────────────────────── */}
        <Section
          icon="🔗"
          title="เชื่อมต่อ Google Calendar"
          desc="ต้องเชื่อมต่อบัญชี YEC@thaichamber.org ผ่าน OAuth ก่อน ระบบถึงจะสร้าง/แก้ไข/ส่งนัดหมายในปฏิทินแทนได้จริง (แทนที่วิธี Service Account เดิมที่ติดนโยบายแชร์ปฏิทินนอกองค์กร)"
          action={
            <button
              disabled={busy === 'google-oauth-start'}
              onClick={connectGoogleCalendar}
              style={btnStyle(googleStatus?.connected ? '#f1f5f9' : '#1a2744', googleStatus?.connected ? '#334155' : '#fff')}
            >
              {busy === 'google-oauth-start' ? 'กำลังเปิด...' : googleStatus?.connected ? '🔄 เชื่อมต่อใหม่' : '🔗 เชื่อมต่อ Google Calendar'}
            </button>
          }
        >
          <div style={{ marginTop: 10, fontFamily: 'Anuphan, sans-serif', fontSize: 13.5 }}>
            {googleStatus?.connected ? (
              <span style={{ color: '#047857', fontWeight: 700 }}>✓ เชื่อมต่อแล้ว{googleStatus.connectedEmail ? ` (${googleStatus.connectedEmail})` : ''}</span>
            ) : (
              <span style={{ color: '#b91c1c', fontWeight: 700 }}>✗ ยังไม่ได้เชื่อมต่อ — ปุ่ม "ส่งนัดหมาย" จะยังใช้วิธีเปิดหน้า Google Calendar แทน</span>
            )}
          </div>
          {googleConnectMessage && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: '#f8fafc', color: '#475569', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5 }}>
              {googleConnectMessage}
            </div>
          )}
        </Section>

        {/* ── 4. Calendar Check + Resync ───────────────────────────────────── */}
        <Section
          icon="📅"
          title="ซิงค์ปฏิทิน Google Calendar"
          desc="ตรวจสอบสถานะก่อนซิงค์เพื่อป้องกันการสร้าง Event ซ้ำในปฏิทิน YEC@thaichamber.org แนะนำให้กด 'ตรวจสอบก่อน Sync' ทุกครั้งก่อนกด Queue"
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                disabled={busy === 'calendar-check'}
                onClick={runCalendarCheck}
                style={btnStyle('#0369a1', '#fff')}
              >
                {busy === 'calendar-check' ? 'กำลังตรวจ...' : '🔍 ตรวจสอบก่อน Sync'}
              </button>
              <button
                disabled={busy === 'resync-task-calendar'}
                onClick={() => runResync(true)}
                style={btnStyle('#f1f5f9', '#334155')}
                title="แสดง payload ที่จะส่ง โดยยังไม่บันทึกอะไรจริง"
              >
                Dry Run
              </button>
              <button
                disabled={busy === 'resync-task-calendar' || hasDuplicateRisk}
                onClick={() => runResync(false)}
                style={btnStyle(hasDuplicateRisk ? '#cbd5e1' : '#1a2744', '#fff')}
                title={hasDuplicateRisk ? 'ไม่สามารถ Queue ได้ — มีงานเสี่ยงสร้างซ้ำ กรุณาแก้ไขก่อน' : 'ตั้ง status เป็น queued_for_calendar_sync'}
              >
                {busy === 'resync-task-calendar' ? 'กำลัง Queue...' : hasDuplicateRisk ? '⚠ Queue (ถูกล็อก)' : '▶ Queue'}
              </button>
            </div>
          }
        >
          {/* Calendar Check Result */}
          {calCheck && calCheckOpen && (
            <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, color: '#94a3b8' }}>ตรวจเมื่อ {formatDate(calCheck.checkedAt)}</span>
                <button onClick={() => setCalCheckOpen(false)} style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>

              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                {[
                  { label: 'งานมีวันที่', value: calCheck.total, color: '#1a2744', bg: '#f8fafc', icon: '📋' },
                  { label: 'จะสร้างใหม่', value: calCheck.willCreate.length, color: '#1d4ed8', bg: '#eff6ff', icon: '➕' },
                  { label: 'จะอัพเดต', value: calCheck.willUpdate.length, color: '#047857', bg: '#f0fdf4', icon: '✏️' },
                  { label: 'ข้าม (ไม่เปลี่ยน)', value: calCheck.willSkip.length, color: '#64748b', bg: '#f8fafc', icon: '⏭' },
                  { label: '⚠ เสี่ยงซ้ำ', value: calCheck.riskDuplicate.length, color: calCheck.riskDuplicate.length > 0 ? '#b91c1c' : '#047857', bg: calCheck.riskDuplicate.length > 0 ? '#fef2f2' : '#f0fdf4', icon: calCheck.riskDuplicate.length > 0 ? '⚠️' : '✅' },
                ].map(stat => (
                  <div key={stat.label} style={{ borderRadius: 12, background: stat.bg, padding: '10px 12px', border: `1px solid ${stat.color}22` }}>
                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                    <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#64748b' }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* เสี่ยงซ้ำ — warning */}
              {calCheck.riskDuplicate.length > 0 && (
                <div style={{ borderRadius: 12, background: '#fef2f2', border: '1.5px solid #fca5a5', padding: '12px 14px' }}>
                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontWeight: 700, color: '#b91c1c', marginBottom: 8 }}>
                    ⚠️ พบ {calCheck.riskDuplicate.length} งานเสี่ยงสร้าง Event ซ้ำ
                  </div>
                  <p style={{ margin: '0 0 10px', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#991b1b', lineHeight: 1.6 }}>
                    งานเหล่านี้เคยถูก sync สำเร็จ (status = synced_yec_calendar) แต่ไม่มี <code>calendar_event_id</code> ในฐานข้อมูล
                    หากกด Queue จะสร้าง Event ใหม่ซ้อน Event เดิมในปฏิทิน
                    กรุณาตรวจสอบปฏิทิน Google ก่อนดำเนินการต่อ
                  </p>
                  <div style={{ display: 'grid', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                    {calCheck.riskDuplicate.map(row => (
                      <div key={row.id} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#fff5f5', border: '1px solid #fecaca', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                        <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11, color: '#b91c1c', flexShrink: 0 }}>{row.start_date || row.end_date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* จะสร้างใหม่ */}
              {calCheck.willCreate.length > 0 && (
                <details style={{ borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe', overflow: 'hidden' }}>
                  <summary style={{ padding: '10px 14px', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600, color: '#1d4ed8', listStyle: 'none', display: 'flex', justifyContent: 'space-between' }}>
                    <span>➕ งานที่จะสร้าง Event ใหม่ ({calCheck.willCreate.length} งาน)</span>
                    <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>คลิกเพื่อดู</span>
                  </summary>
                  <div style={{ maxHeight: 220, overflowY: 'auto', padding: '0 12px 12px' }}>
                    {calCheck.willCreate.map(row => (
                      <div key={row.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #dbeafe', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                        <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11, color: '#3b82f6', flexShrink: 0 }}>{row.start_date || row.end_date}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* จะอัพเดต */}
              {calCheck.willUpdate.length > 0 && (
                <details style={{ borderRadius: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', overflow: 'hidden' }}>
                  <summary style={{ padding: '10px 14px', cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600, color: '#047857', listStyle: 'none', display: 'flex', justifyContent: 'space-between' }}>
                    <span>✏️ งานที่จะอัพเดต Event เดิม ({calCheck.willUpdate.length} งาน)</span>
                    <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>คลิกเพื่อดู</span>
                  </summary>
                  <div style={{ maxHeight: 220, overflowY: 'auto', padding: '0 12px 12px' }}>
                    {calCheck.willUpdate.map(row => (
                      <div key={row.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #d1fae5', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                        <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11, color: '#10b981', flexShrink: 0 }}>{row.calendar_event_id?.slice(0, 12)}…</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* ผลลัพธ์รวม */}
              {calCheck.riskDuplicate.length === 0 && (
                <div style={{ borderRadius: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 14px', fontFamily: 'Anuphan, sans-serif', fontSize: 13, color: '#047857', fontWeight: 600 }}>
                  ✅ ปลอดภัย — ไม่พบความเสี่ยงสร้าง Event ซ้ำ สามารถกด Queue ได้เลย
                </div>
              )}
            </div>
          )}

          {/* Resync result */}
          {resync && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e4e8f2' }}>
              <span style={{ fontFamily: 'Anuphan, sans-serif', color: '#64748b', fontSize: 13 }}>
                {resync.status === 'dry_run' ? '🔎 Dry Run' : '▶ Queued'}: {resync.count} งาน
              </span>
            </div>
          )}
        </Section>

      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  icon, title, desc, action, children,
}: {
  icon: string
  title: string
  desc: string
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid rgba(15,23,42,0.05)', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{icon}</span> {title}
          </h2>
          <p style={{ margin: '5px 0 0', fontFamily: 'Anuphan, sans-serif', color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>{desc}</p>
        </div>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
      {children}
    </section>
  )
}

function btnStyle(background: string, color: string): React.CSSProperties {
  return {
    border: 'none',
    borderRadius: 12,
    padding: '9px 14px',
    background,
    color,
    cursor: 'pointer',
    fontFamily: 'Anuphan, sans-serif',
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }
}
