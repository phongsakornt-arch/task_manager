import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { logActivity } from '../lib/activityLog'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useTaskStore } from '../stores/taskStore'
import type { Attachment, ChecklistItem, Committee, Member, Task, TaskMember, TaskStaff, User } from '../types'

interface DefaultValues {
  title?: string
  description?: string
  start_date?: string
  end_date?: string
  start_time?: string
  end_time?: string
  tags?: string[]
}

interface Props {
  task?: Task | null
  defaultSectionId?: string
  defaultParentTaskId?: string
  defaultValues?: DefaultValues
  canEdit?: boolean
  canDelete?: boolean
  onCreateSubtask?: (task: Task) => void
  onOpenTask?: (task: Task) => void
  onClose: () => void
}

type ActivityRow = { id: string; action: string; detail?: string; actor_email?: string; created_at: string }
type UserWithMember = Omit<User, 'member_id'> & {
  member_id?: string | null
  members?: Pick<Member, 'id' | 'name_th' | 'nickname' | 'email' | 'position_committee' | 'province'> | null
}

const FONT = 'Anuphan, sans-serif'
const FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.txt,.csv'

function toArray<T>(value: T[] | Record<string, T> | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

// Attachments synced from the legacy Excel sheet store their link under `url`
// instead of `viewUrl` (the field this app's uploader writes) — fall back to it
// so those links (registration forms, Canva, Sheets, etc.) still open.
function attachmentUrl(file: Attachment): string {
  return file.viewUrl || file.dataUrl || (file as unknown as { url?: string }).url || ''
}

function normalizeTime(value: string) {
  const clean = value.trim()
  if (!clean) return ''
  const digits = clean.replace(/[^0-9]/g, '')
  const [rawH, rawM] = clean.includes(':') ? clean.split(':') : [digits.slice(0, 2), digits.slice(2, 4) || '00']
  const h = Math.min(23, Math.max(0, Number(rawH || 0)))
  const m = Math.min(59, Math.max(0, Number((rawM || '00').replace(/[^0-9]/g, '').padEnd(2, '0'))))
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatDate(date?: string) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(`${date.slice(0, 10)}T00:00:00`))
}

function formatDateRange(start?: string | null, end?: string | null) {
  const first = start || end
  if (!first) return '-'
  const last = end || first
  return first === last ? formatDate(first) : `${formatDate(first)} - ${formatDate(last)}`
}

function formatTimeRange(start?: string | null, end?: string | null) {
  const from = start?.slice(0, 5)
  const to = end?.slice(0, 5)
  if (!from && !to) return '-'
  if (from && to) return `${from} - ${to} น.`
  return `${from || to} น.`
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

async function fileToAttachment(file: File): Promise<Attachment> {
  const id = crypto.randomUUID()
  // Supabase Storage object keys reject non-ASCII (e.g. Thai) characters,
  // so the storage path must be ASCII-safe — the original Thai name is
  // preserved separately below via `name: file.name` for display.
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.replace(/[^a-zA-Z0-9]/g, '') : ''
  const safeName = ext ? `file.${ext}` : 'file'
  const path = `${id}/${safeName}`

  const { error } = await supabase.storage.from('task-attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })

  if (error) throw new Error(`อัปโหลดไฟล์ล้มเหลว: ${error.message}`)

  const { data: urlData } = supabase.storage.from('task-attachments').getPublicUrl(path)

  return {
    id,
    name: file.name,
    viewUrl: urlData.publicUrl,
    mimeType: file.type || 'application/octet-stream',
    uploadedAt: new Date().toISOString(),
  }
}

function cleanAttachment(file: Attachment) {
  const next = { ...file }
  delete next.dataUrl
  return next
}

function userLabel(user: UserWithMember) {
  const member = user.members
  const name = user.name || member?.name_th || user.email
  return member?.nickname ? `${name} (${member.nickname})` : name
}

function memberLabel(member: Member) {
  return member.nickname ? `${member.name_th} (${member.nickname})` : member.name_th
}

function matchesSearch(values: Array<string | null | undefined>, query: string) {
  if (!query) return true
  return values.some(value => (value ?? '').toLowerCase().includes(query))
}

function addOneDay(date: string) {
  const value = new Date(`${date}T00:00:00+07:00`)
  value.setDate(value.getDate() + 1)
  return value.toISOString().slice(0, 10)
}

function calendarDateToken(date: string, time?: string | null) {
  const ymd = date.replaceAll('-', '')
  if (!time) return ymd
  return `${ymd}T${time.replace(':', '').slice(0, 4).padEnd(4, '0')}00`
}

function buildGoogleCalendarTemplateLink(input: {
  title: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  driveFolderUrl?: string | null
  attachments?: Attachment[]
  attendeeEmails?: string[]
}) {
  const firstDate = input.startDate || input.endDate
  if (!firstDate) return null
  const endDate = input.endDate || firstDate
  const hasTime = Boolean(input.startTime || input.endTime)
  const details = [
    input.description?.trim(),
    input.driveFolderUrl ? `Google Drive: ${input.driveFolderUrl}` : '',
    ...(input.attachments ?? []).map(item => ({ item, url: attachmentUrl(item) })).filter(({ url }) => url).map(({ item, url }) => `${item.name}: ${url}`),
  ].filter(Boolean).join('\n\n')
  const dates = hasTime
    ? `${calendarDateToken(firstDate, input.startTime || '09:00')}/${calendarDateToken(endDate, input.endTime || input.startTime || '10:00')}`
    : `${calendarDateToken(firstDate)}/${calendarDateToken(addOneDay(endDate))}`
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title || 'YEC Task',
    details,
    dates,
    ctz: 'Asia/Bangkok',
  })
  const attendees = Array.from(new Set((input.attendeeEmails ?? []).map(email => email.trim().toLowerCase()).filter(Boolean)))
  if (attendees.length) params.set('add', attendees.join(','))
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export default function TaskModal({ task, defaultSectionId, defaultParentTaskId, defaultValues, canEdit = true, canDelete = false, onCreateSubtask, onOpenTask, onClose }: Props) {
  const { tasks, sections, taskTypes, addTask, updateTask, removeTask } = useTaskStore()
  const { user } = useAuthStore()
  const isEdit = Boolean(task?.id)
  const isSubtask = Boolean(task?.parent_task_id || defaultParentTaskId)
  const [editing, setEditing] = useState(!isEdit)
  const readOnly = !canEdit || (isEdit && !editing)

  const initialStaffUserIds = useMemo(() => task?.task_staff?.map(item => item.user_id).filter(Boolean) ?? [], [task?.task_staff])
  const initialStaffMemberIds = useMemo(() => task?.task_members?.filter(item => item.role === 'assignee' && item.member_id).map(item => item.member_id as string) ?? [], [task?.task_members])
  const initialParticipantMemberIds = useMemo(() => task?.task_members?.filter(item => item.role === 'watcher' && item.member_id).map(item => item.member_id as string) ?? [], [task?.task_members])
  const initialCommitteeIds = useMemo(() => task?.task_members?.filter(item => item.role === 'watcher' && item.committee_id).map(item => item.committee_id as string) ?? [], [task?.task_members])

  const [title, setTitle] = useState(task?.title ?? defaultValues?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? defaultValues?.description ?? '')
  const [sectionId, setSectionId] = useState(task?.section_id ?? defaultSectionId ?? sections[0]?.id ?? '')
  const [taskTypeId, setTaskTypeId] = useState(task?.task_type_id ?? '')
  const [parentTaskId] = useState(task?.parent_task_id ?? defaultParentTaskId ?? '')
  const [startDate, setStartDate] = useState(task?.start_date?.slice(0, 10) ?? defaultValues?.start_date ?? '')
  const [endDate, setEndDate] = useState(task?.end_date?.slice(0, 10) ?? defaultValues?.end_date ?? '')
  const [startTime, setStartTime] = useState(task?.start_time?.slice(0, 5) ?? defaultValues?.start_time ?? '')
  const [endTime, setEndTime] = useState(task?.end_time?.slice(0, 5) ?? defaultValues?.end_time ?? '')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(toArray(task?.checklist as ChecklistItem[] | Record<string, ChecklistItem>))
  const [attachments, setAttachments] = useState<Attachment[]>(toArray(task?.attachments as Attachment[] | Record<string, Attachment>))
  const [driveFolderUrl, setDriveFolderUrl] = useState(task?.drive_folder_url ?? '')
  const [completedState, setCompletedState] = useState(task?.completed ?? false)
  const [newChecklist, setNewChecklist] = useState('')
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [users, setUsers] = useState<UserWithMember[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [committees, setCommittees] = useState<Committee[]>([])
  const [staffSearch, setStaffSearch] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [staffUserIds, setStaffUserIds] = useState<string[]>(initialStaffUserIds.length ? initialStaffUserIds : task?.owner_id ? [task.owner_id] : [])
  const [participantMemberIds, setParticipantMemberIds] = useState<string[]>(initialParticipantMemberIds)
  const [committeeIds, setCommitteeIds] = useState<string[]>(initialCommitteeIds)
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'calendar' | 'line' | 'invite' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [linePreview, setLinePreview] = useState('')
  const [confirmingInvite, setConfirmingInvite] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const parentTask = useMemo(() => tasks.find(item => item.id === parentTaskId), [parentTaskId, tasks])
  const childTasks = useMemo(() => tasks.filter(item => item.parent_task_id === task?.id && !item.deleted), [task?.id, tasks])
  const selectedStaffUsers = useMemo(() => users.filter(item => staffUserIds.includes(item.id)), [staffUserIds, users])
  const selectedStaffMemberIds = useMemo(() => selectedStaffUsers.map(item => item.member_id).filter((id): id is string => Boolean(id)), [selectedStaffUsers])
  const selectedParticipantMembers = useMemo(() => members.filter(member => participantMemberIds.includes(member.id)), [members, participantMemberIds])
  const selectedCommittees = useMemo(() => committees.filter(committee => committeeIds.includes(committee.id)), [committeeIds, committees])
  const committeeParticipantMembers = useMemo(() => members.filter(member => member.committee_id && committeeIds.includes(member.committee_id)), [committeeIds, members])
  const attendeeEmails = useMemo(() => {
    return Array.from(new Set([
      ...selectedParticipantMembers.map(item => item.email),
      ...committeeParticipantMembers.map(item => item.email),
    ].map(email => (email ?? '').trim().toLowerCase()).filter(Boolean)))
  }, [committeeParticipantMembers, selectedParticipantMembers])

  const availableStaffUsers = useMemo(() => {
    const query = staffSearch.trim().toLowerCase()
    return users
      .filter(item => item.active !== false)
      .filter(item => !staffUserIds.includes(item.id))
      .filter(item => matchesSearch([item.name, item.email, item.members?.name_th, item.members?.nickname], query))
      .slice(0, 10)
  }, [staffSearch, staffUserIds, users])

  const availableParticipantMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase()
    return members
      .filter(member => !participantMemberIds.includes(member.id))
      .filter(member => !selectedStaffMemberIds.includes(member.id))
      .filter(member => matchesSearch([member.name_th, member.nickname, member.email, member.position_yec, member.position_committee, member.province], query))
      .slice(0, 10)
  }, [memberSearch, members, participantMemberIds, selectedStaffMemberIds])

  const staffDisplayItems = useMemo(() => {
    const fromUsers = selectedStaffUsers.map(userLabel)
    if (fromUsers.length) return fromUsers
    const fromTaskStaff = task?.task_staff?.map(item => item.users?.name || item.users?.email || '-').filter(Boolean) ?? []
    if (fromTaskStaff.length) return fromTaskStaff
    return task?.task_members?.filter(item => item.role === 'assignee' && item.member_id).map(item => item.members?.name_th || item.members?.email || '-') ?? []
  }, [selectedStaffUsers, task?.task_members, task?.task_staff])

  const participantDisplayItems = useMemo(() => {
    const people = task?.task_members?.filter(item => item.role === 'watcher' && item.member_id).map(item => item.members?.name_th || item.members?.email || '-') ?? []
    const groups = task?.task_members?.filter(item => item.role === 'watcher' && item.committee_id).map(item => item.committees?.name || '-') ?? []
    return [...groups, ...people]
  }, [task?.task_members])

  const liveParticipantItems = useMemo(() => {
    const groups = selectedCommittees.map(committee => `${committee.code ? `${committee.code} ` : ''}${committee.name}`)
    const people = selectedParticipantMembers.map(memberLabel)
    const items = [...groups, ...people]
    return items.length ? items : participantDisplayItems
  }, [participantDisplayItems, selectedCommittees, selectedParticipantMembers])

  useEffect(() => {
    if (!readOnly) titleRef.current?.focus()
  }, [readOnly])

  useEffect(() => {
    supabase
      .from('users')
      .select('*, members(id, name_th, nickname, email, position_committee, province)')
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        if (!data) return
        const loadedUsers = data as UserWithMember[]
        setUsers(loadedUsers)
        if (!task?.owner_id && initialStaffMemberIds.length) {
          const mappedUserIds = loadedUsers.filter(item => item.member_id && initialStaffMemberIds.includes(item.member_id)).map(item => item.id)
          if (mappedUserIds.length) setStaffUserIds(prev => prev.length ? prev : mappedUserIds)
        }
      })

    supabase
      .from('members')
      .select('*, committees(*)')
      .eq('active', true)
      .order('name_th')
      .then(({ data }) => data && setMembers(data as Member[]))

    supabase
      .from('committees')
      .select('*')
      .eq('active', true)
      .order('code')
      .then(({ data }) => data && setCommittees(data as Committee[]))
  }, [initialStaffMemberIds, task?.owner_id])

  useEffect(() => {
    if (!task?.id) return
    supabase
      .from('task_staff')
      .select('*, users(*, members(id, name_th, nickname, email, position_committee, province))')
      .eq('task_id', task.id)
      .order('sort_order')
      .then(({ data }) => {
        if (!data?.length) return
        const rows = data as TaskStaff[]
        const userIds = rows.map(row => row.user_id)
        setStaffUserIds(prev => prev.length === userIds.length && prev.every(id => userIds.includes(id)) ? prev : userIds)
      })
  }, [task?.id])

  useEffect(() => {
    if (!task?.id) return
    supabase
      .from('activity_log')
      .select('id, action, detail, actor_email, created_at')
      .contains('meta', { task_id: task.id })
      .order('created_at', { ascending: false })
      .limit(12)
      .then(({ data }) => data && setActivity(data as ActivityRow[]))
  }, [task?.id])

  const addChecklist = () => {
    const text = newChecklist.trim()
    if (!text) return
    setChecklist(prev => [...prev, { id: crypto.randomUUID(), text, done: false }])
    setNewChecklist('')
  }

  const addFiles = async (files: FileList | File[]) => {
    setError('')
    try {
      const next = await Promise.all(Array.from(files).map(fileToAttachment))
      setAttachments(prev => [...prev, ...next])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดไฟล์ไม่สำเร็จ')
    }
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!readOnly) await addFiles(event.dataTransfer.files)
  }

  const addLink = () => {
    const url = linkUrl.trim()
    if (!/^https?:\/\//i.test(url)) {
      setError('กรุณาใส่ลิงก์ที่ขึ้นต้นด้วย http:// หรือ https://')
      return
    }
    setAttachments(prev => [...prev, {
      id: crypto.randomUUID(),
      name: linkName.trim() || url,
      viewUrl: url,
      mimeType: 'text/uri-list',
      linkType: 'link',
      uploadedAt: new Date().toISOString(),
    }])
    setLinkName('')
    setLinkUrl('')
    setError('')
  }

  const refreshTask = async (id: string) => {
    const { data } = await supabase
      .from('tasks')
      .select('*, sections(*), task_types(*), task_members(*, members(*), committees(*)), task_staff(*, users(*, members(id, name_th, nickname, email, position_committee, province)))')
      .eq('id', id)
      .single()
    return data as Task | null
  }

  const saveMembers = async (taskId: string) => {
    await supabase.from('task_members').delete().eq('task_id', taskId)
    const rows: Partial<TaskMember>[] = [
      ...participantMemberIds.map(member_id => ({ task_id: taskId, member_id, role: 'watcher' as const })),
      ...committeeIds.map(committee_id => ({ task_id: taskId, committee_id, role: 'watcher' as const })),
    ]
    if (rows.length) await supabase.from('task_members').insert(rows)
  }

  const saveStaff = async (taskId: string) => {
    await supabase.from('task_staff').delete().eq('task_id', taskId)
    const rows = staffUserIds.map((user_id, index) => ({ task_id: taskId, user_id, sort_order: index }))
    if (rows.length) await supabase.from('task_staff').insert(rows)
  }

  const handleSave = async () => {
    if (readOnly || saving) return
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('กรุณาใส่ชื่องาน')
      return
    }
    if (!sectionId) {
      setError('กรุณาเลือก Section')
      return
    }

    setSaving(true)
    setError('')
    const payload = {
      section_id: sectionId,
      title: cleanTitle,
      description: description.trim() || null,
      start_date: startDate || null,
      end_date: endDate || null,
      start_time: normalizeTime(startTime) || null,
      end_time: normalizeTime(endTime) || null,
      task_type_id: taskTypeId || null,
      owner_id: staffUserIds[0] || null,
      parent_task_id: parentTaskId || null,
      checklist: checklist.filter(item => item.text.trim()).map(item => ({ ...item, text: item.text.trim() })),
      attachments: attachments.map(cleanAttachment),
      drive_folder_url: driveFolderUrl.trim() || null,
      tags: [],
      updated_at: new Date().toISOString(),
    }

    if (isEdit && task) {
      const { error: updateError } = await supabase.from('tasks').update(payload).eq('id', task.id)
      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }
      await saveMembers(task.id)
      await saveStaff(task.id)
      const fresh = await refreshTask(task.id)
      updateTask(task.id, fresh ?? {
        ...task,
        section_id: payload.section_id,
        title: payload.title,
        description: payload.description ?? undefined,
        start_date: payload.start_date ?? undefined,
        end_date: payload.end_date ?? undefined,
        start_time: payload.start_time ?? undefined,
        end_time: payload.end_time ?? undefined,
        task_type_id: payload.task_type_id ?? undefined,
        owner_id: payload.owner_id ?? undefined,
        parent_task_id: payload.parent_task_id ?? undefined,
        checklist: payload.checklist,
        attachments: payload.attachments,
        drive_folder_url: payload.drive_folder_url ?? undefined,
        tags: [],
        updated_at: payload.updated_at,
      })
      await logActivity(user, 'task.updated', `Updated task: ${cleanTitle}`, { task_id: task.id })
      setMessage('บันทึกการแก้ไขแล้ว')
      setEditing(false)
      setSaving(false)
      return
    }

    const { data, error: insertError } = await supabase
      .from('tasks')
      .insert({ ...payload, completed: false, deleted: false, created_by: user?.id ?? null })
      .select('id')
      .single()

    if (insertError || !data) {
      setError(insertError?.message ?? 'สร้างงานไม่สำเร็จ')
      setSaving(false)
      return
    }

    await saveMembers(data.id)
    await saveStaff(data.id)
    const fresh = await refreshTask(data.id)
    if (fresh) addTask(fresh)
    await logActivity(user, 'task.created', `Created task: ${cleanTitle}`, { task_id: data.id })
    setSaving(false)
    onClose()
  }

  const deleteTask = async () => {
    if (!task?.id || readOnly) return
    setSaving(true)
    const { error: deleteError } = await supabase
      .from('tasks')
      .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
      .eq('id', task.id)
    if (deleteError) {
      setError(deleteError.message)
      setSaving(false)
      return
    }
    removeTask(task.id)
    await logActivity(user, 'task.deleted', `Deleted task: ${task.title}`, { task_id: task.id })
    setSaving(false)
    onClose()
  }

  const syncCalendar = async () => {
    if (!task?.id) return
    setBusy('calendar')
    const { data, error: invokeError } = await supabase.functions.invoke('sync-task-calendar', {
      body: { taskId: task.id, force: true },
    })
    setBusy(null)
    if (invokeError) setError(invokeError.message)
    else {
      const fresh = await refreshTask(task.id)
      if (fresh) updateTask(task.id, fresh)
      setMessage(data?.success ? 'Sync เข้า Calendar กลาง YEC@thaichamber.org แล้ว' : `ยัง Sync Calendar ไม่สำเร็จ: ${data?.status || 'unknown'}`)
    }
  }

  const createDriveFolder = async () => {
    if (!task?.id || driveFolderUrl.trim() || creatingFolder) return
    setCreatingFolder(true)
    setError('')
    const { data, error: invokeError } = await supabase.functions.invoke('drive-bridge', {
      body: { action: 'createTaskFolder', taskId: task.id, title: title.trim() || task.title },
    })
    setCreatingFolder(false)
    if (invokeError || !data?.success || !data?.folder?.url) {
      setError(invokeError?.message || (data as { error?: string } | undefined)?.error || 'สร้างโฟลเดอร์ Drive ไม่สำเร็จ')
      return
    }
    setDriveFolderUrl(data.folder.url)
    setMessage('สร้างโฟลเดอร์ Drive อัตโนมัติแล้ว — กด "บันทึกการแก้ไข" เพื่อเก็บลิงก์นี้ไว้กับงาน')
  }

  const currentCalendarLink = () => buildGoogleCalendarTemplateLink({
    title: title.trim() || task?.title || '',
    description: description.trim() || task?.description || '',
    startDate: startDate || task?.start_date || null,
    endDate: endDate || task?.end_date || null,
    startTime: normalizeTime(startTime) || task?.start_time || null,
    endTime: normalizeTime(endTime) || task?.end_time || null,
    driveFolderUrl: driveFolderUrl.trim() || task?.drive_folder_url || null,
    attachments,
    attendeeEmails,
  })

  const createLineMessage = async () => {
    setBusy('line')
    setError('')
    setMessage('กำลังสร้างข้อความ LINE...')
    const text = [
      `แจ้งงาน / นัดหมาย: ${title.trim() || task?.title || '-'}`,
      `วันที่: ${formatDateRange(startDate || task?.start_date, endDate || task?.end_date)}`,
      `เวลา: ${formatTimeRange(normalizeTime(startTime) || task?.start_time, normalizeTime(endTime) || task?.end_time)}`,
      `กรรมการที่รับผิดชอบ / เข้าร่วม: ${liveParticipantItems.length ? liveParticipantItems.join(', ') : '-'}`,
      `รายละเอียด:\n${description.trim() || task?.description || '-'}`,
    ].filter(Boolean).join('\n\n')

    setLinePreview(text)
    try {
      await navigator.clipboard.writeText(text)
      setMessage('สร้างข้อความ LINE และคัดลอกแล้ว')
      setError('')
    } catch {
      setMessage('สร้างข้อความ LINE แล้ว')
    } finally {
      setBusy(null)
    }
  }

  const sendCalendarInvite = () => {
    const link = currentCalendarLink()
    if (!link) {
      setError('กรุณาระบุวันที่ก่อนส่งนัดหมาย Google Calendar')
      return
    }
    setError('')
    setConfirmingInvite(true)
  }

  const openCalendarTemplateFallback = (note: string) => {
    const link = currentCalendarLink()
    if (!link) {
      setError('กรุณาระบุวันที่ก่อนส่งนัดหมาย Google Calendar')
      return
    }
    window.open(link, '_blank', 'noopener,noreferrer')
    setError('')
    setMessage(note)
  }

  const confirmSendCalendarInvite = async () => {
    setConfirmingInvite(false)
    setBusy('invite')

    if (!task?.id) {
      setBusy(null)
      openCalendarTemplateFallback(attendeeEmails.length ? `เปิดหน้าส่งนัดหมาย Google Calendar พร้อมอีเมลกรรมการ ${attendeeEmails.length} รายการแล้ว` : 'เปิดหน้าส่งนัดหมาย Google Calendar แล้ว แต่ยังไม่พบอีเมลกรรมการที่เข้าร่วม')
      return
    }

    const { data, error: invokeError } = await supabase.functions.invoke('sync-task-calendar', {
      body: { taskId: task.id, attendees: attendeeEmails, notify: true, force: true },
    })
    setBusy(null)

    if (!invokeError && data?.success && data?.status === 'invite_sent') {
      const fresh = await refreshTask(task.id)
      if (fresh) updateTask(task.id, fresh)
      setError('')
      setMessage(`ส่งนัดหมายผ่าน Google Calendar ให้กรรมการ ${data.attendeeCount ?? attendeeEmails.length} รายการแล้ว ไม่ต้องเปิดหน้า Google Calendar`)
      return
    }

    // Server-side send isn't ready yet (e.g. Google service account not configured)
    // or failed — fall back to the manual template-link flow so the feature stays usable.
    openCalendarTemplateFallback(
      attendeeEmails.length
        ? `ส่งอัตโนมัติยังไม่พร้อมใช้งาน (${data?.status ?? invokeError?.message ?? 'unknown'}) — เปิดหน้า Google Calendar พร้อมอีเมลกรรมการ ${attendeeEmails.length} รายการแทน`
        : 'ส่งอัตโนมัติยังไม่พร้อมใช้งาน — เปิดหน้าส่งนัดหมาย Google Calendar แทน แต่ยังไม่พบอีเมลกรรมการที่เข้าร่วม',
    )
  }

  const toggleComplete = async () => {
    if (!task?.id || !canEdit) return
    const completed = !completedState
    const completed_at = completed ? new Date().toISOString() : null
    setCompletedState(completed)
    updateTask(task.id, { completed, completed_at: completed_at ?? undefined })
    await supabase.from('tasks').update({ completed, completed_at }).eq('id', task.id)
    await logActivity(user, completed ? 'task.completed' : 'task.reopened', completed ? `Completed task: ${task.title}` : `Reopened task: ${task.title}`, { task_id: task.id })
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !readOnly) void handleSave()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, title, description, sectionId, taskTypeId, parentTaskId, startDate, endDate, startTime, endTime, checklist, attachments, driveFolderUrl, staffUserIds, participantMemberIds, committeeIds])

  return (
    <div style={backdropStyle} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div style={{ ...modalStyle, borderTopColor: isSubtask ? '#7c3aed' : '#1d4ed8' }}>
        <header style={headerStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: isSubtask ? '#7c3aed' : '#64748b', fontWeight: 900, fontSize: 12, letterSpacing: 0.6, marginBottom: 8 }}>
              {isSubtask ? 'SUB TASK' : readOnly ? 'TASK DETAIL' : isEdit ? 'EDIT TASK' : 'NEW TASK'}
            </div>
            {readOnly ? (
              <h2 style={titleStyle}>{task?.title || 'ไม่มีชื่องาน'}</h2>
            ) : (
              <input ref={titleRef} value={title} onChange={event => setTitle(event.target.value)} placeholder={isSubtask ? 'ชื่อ Sub task' : 'ชื่องาน'} style={{ ...inputStyle, height: 54, fontSize: 20, fontWeight: 900 }} />
            )}
            {parentTask && <div style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>อยู่ใต้: {parentTask.title}</div>}
          </div>
          <button onClick={onClose} style={closeButtonStyle}>x</button>
        </header>

        <main style={{ overflow: 'auto', padding: 24, background: isSubtask ? '#faf5ff' : '#fff' }}>
          {readOnly ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <InfoPill label="ประเภท" value={task?.task_types?.name || 'ยังไม่ระบุ'} color={task?.task_types?.color} />
                <InfoPill label="วันที่" value={`${formatDate(task?.start_date)}${task?.end_date && task.end_date !== task.start_date ? ` - ${formatDate(task.end_date)}` : ''}`} tone="date" />
                <InfoPill label="เวลา" value={`${task?.start_time?.slice(0, 5) || '--:--'} - ${task?.end_time?.slice(0, 5) || '--:--'} น.`} tone="time" />
                <InfoPill label="Calendar" value={task?.calendar_sync_status || 'ยังไม่ sync'} />
              </div>
              {task?.description && <Section title="รายละเอียด"><p style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#475569', lineHeight: 1.7 }}>{task.description}</p></Section>}
              <Section title="เจ้าหน้าที่ที่ดูแล"><ChipList items={staffDisplayItems} empty="ยังไม่ระบุเจ้าหน้าที่" /></Section>
              <Section title="กรรมการที่รับผิดชอบ / เข้าร่วม"><ChipList items={participantDisplayItems} empty="ยังไม่ระบุกรรมการ" /></Section>
              {checklist.length > 0 && <Section title="Checklist">{checklist.map(item => <div key={item.id} style={{ color: item.done ? '#047857' : '#475569', marginBottom: 6 }}>{item.done ? 'Done' : 'Open'} - {item.text}</div>)}</Section>}
              {childTasks.length > 0 && <Section title="Sub task" purple>{childTasks.map(item => <button key={item.id} onClick={() => onOpenTask?.(item)} style={{ ...secondaryButtonStyle, display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>{item.title}<span>{item.completed ? 'เสร็จแล้ว' : 'เปิดอยู่'}</span></button>)}</Section>}
              <FileList attachments={attachments} />
              {task?.drive_folder_url && <DriveBox url={task.drive_folder_url} />}
              {activity.length > 0 && <Section title="ประวัติ">{activity.map(row => <div key={row.id} style={{ color: '#64748b', fontSize: 12.5, marginBottom: 8 }}><strong style={{ color: '#334155' }}>{row.detail || row.action}</strong><br />{row.actor_email || '-'} - {formatDateTime(row.created_at)}</div>)}</Section>}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <Field label="Section"><select value={sectionId} onChange={event => setSectionId(event.target.value)} style={inputStyle}>{sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></Field>
                <Field label="ประเภทงาน"><select value={taskTypeId} onChange={event => setTaskTypeId(event.target.value)} style={inputStyle}><option value="">เลือกประเภทงาน</option>{taskTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
                <Field label="วันเริ่ม"><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} style={inputStyle} /></Field>
                <Field label="วันจบ"><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} style={inputStyle} /></Field>
                <Field label="เวลาเริ่ม"><input value={startTime} onChange={event => setStartTime(event.target.value)} onBlur={event => setStartTime(normalizeTime(event.target.value))} placeholder="09:00" style={inputStyle} /></Field>
                <Field label="เวลาจบ"><input value={endTime} onChange={event => setEndTime(event.target.value)} onBlur={event => setEndTime(normalizeTime(event.target.value))} placeholder="17:00" style={inputStyle} /></Field>
              </div>
              <Field label="รายละเอียด"><textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} placeholder="เพิ่มรายละเอียด..." style={{ ...inputStyle, minHeight: 110, paddingTop: 12, resize: 'vertical' }} /></Field>

              <Section title="Checklist">
                {checklist.map(item => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) 34px', gap: 8, marginBottom: 8 }}><input type="checkbox" checked={item.done} onChange={() => setChecklist(prev => prev.map(row => row.id === item.id ? { ...row, done: !row.done } : row))} /><input value={item.text} onChange={event => setChecklist(prev => prev.map(row => row.id === item.id ? { ...row, text: event.target.value } : row))} style={inputStyle} /><button onClick={() => setChecklist(prev => prev.filter(row => row.id !== item.id))} style={iconButtonStyle}>x</button></div>)}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: 8 }}><input value={newChecklist} onChange={event => setNewChecklist(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addChecklist() }} placeholder="+ เพิ่มรายการ..." style={inputStyle} /><button onClick={addChecklist} style={secondaryButtonStyle}>เพิ่ม</button></div>
              </Section>

              <Section title="เจ้าหน้าที่ที่ดูแล (ดึงจาก Users และเลือกได้หลายคน)">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {selectedStaffUsers.map(item => <RemovableChip key={item.id} label={userLabel(item)} onRemove={() => setStaffUserIds(prev => prev.filter(id => id !== item.id))} />)}
                </div>
                <input value={staffSearch} onChange={event => setStaffSearch(event.target.value)} placeholder="ค้นหาชื่อ / อีเมลจาก Users" style={inputStyle} />
                {staffSearch && <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{availableStaffUsers.map(item => (
                  <button key={item.id} onClick={() => { setStaffUserIds(prev => Array.from(new Set([...prev, item.id]))); setStaffSearch('') }} style={{ ...secondaryButtonStyle, textAlign: 'left' }}>
                    {userLabel(item)} <span style={{ color: '#94a3b8', fontWeight: 700 }}>- {item.email}</span>
                  </button>
                ))}</div>}
              </Section>

              <Section title="กรรมการที่รับผิดชอบ / เข้าร่วม">
                <div style={subLabelStyle}>เลือกทั้งคณะกรรมการ</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>{committees.map(committee => {
                  const selected = committeeIds.includes(committee.id)
                  const color = committee.color || '#047857'
                  return <button key={committee.id} onClick={() => setCommitteeIds(prev => selected ? prev.filter(id => id !== committee.id) : [...prev, committee.id])} style={{ border: `1.5px solid ${selected ? color : '#dbe4ee'}`, background: selected ? `${color}18` : '#fff', color: selected ? color : '#64748b', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontFamily: FONT, fontWeight: 800 }}>{committee.code ? `${committee.code} ` : ''}{committee.name}</button>
                })}</div>
                <div style={subLabelStyle}>เลือกรายบุคคลจาก Members</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {selectedParticipantMembers.map(member => <RemovableChip key={member.id} label={memberLabel(member)} onRemove={() => setParticipantMemberIds(prev => prev.filter(id => id !== member.id))} />)}
                </div>
                <input value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder="ค้นหาชื่อกรรมการ / อีเมล / จังหวัด" style={inputStyle} />
                {memberSearch && <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{availableParticipantMembers.map(member => (
                  <button key={member.id} onClick={() => { setParticipantMemberIds(prev => Array.from(new Set([...prev, member.id]))); setMemberSearch('') }} style={{ ...secondaryButtonStyle, textAlign: 'left' }}>
                    {memberLabel(member)} <span style={{ color: '#94a3b8', fontWeight: 700 }}>- {member.email || member.province || '-'}</span>
                  </button>
                ))}</div>}
              </Section>

              <Section title="Google Drive Folder">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={driveFolderUrl} onChange={event => setDriveFolderUrl(event.target.value)} placeholder="https://drive.google.com/..." style={{ ...inputStyle, flex: 1 }} />
                  {driveFolderUrl.trim() ? (
                    <a href={driveFolderUrl.trim()} target="_blank" rel="noreferrer" style={driveButtonStyle}>
                      <span style={{ fontSize: 16 }}>📂</span> เปิด Drive
                    </a>
                  ) : (
                    isEdit && task?.id && (
                      <button disabled={creatingFolder} onClick={createDriveFolder} style={driveButtonStyle}>
                        <span style={{ fontSize: 16 }}>📁</span> {creatingFolder ? 'กำลังสร้าง...' : 'สร้างโฟลเดอร์อัตโนมัติ'}
                      </button>
                    )
                  )}
                </div>
              </Section>
              <Section title="ไฟล์แนบ & ลิงก์">
                <div onDragOver={event => event.preventDefault()} onDrop={handleDrop} style={dropzoneStyle}>
                  <div>ลากไฟล์มาวาง หรือเลือกหลายไฟล์พร้อมกัน</div>
                  <label style={{ ...secondaryButtonStyle, display: 'inline-flex', marginTop: 10 }}>เลือกไฟล์<input type="file" multiple accept={FILE_ACCEPT} onChange={event => event.target.files && addFiles(event.target.files)} style={{ display: 'none' }} /></label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr) 90px', gap: 8, marginTop: 10 }}><input value={linkName} onChange={event => setLinkName(event.target.value)} placeholder="ชื่อลิงก์" style={inputStyle} /><input value={linkUrl} onChange={event => setLinkUrl(event.target.value)} placeholder="URL" style={inputStyle} /><button onClick={addLink} style={secondaryButtonStyle}>+ ลิงก์</button></div>
                <FileList attachments={attachments} onRemove={id => setAttachments(prev => prev.filter(item => item.id !== id))} />
              </Section>
            </div>
          )}
          {linePreview && (
            <Section title="ข้อความ LINE">
              <textarea readOnly value={linePreview} rows={8} style={{ ...inputStyle, minHeight: 160, paddingTop: 12, resize: 'vertical', lineHeight: 1.6 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => navigator.clipboard.writeText(linePreview).then(() => setMessage('คัดลอกข้อความ LINE แล้ว')).catch(() => undefined)} style={secondaryButtonStyle}>คัดลอกอีกครั้ง</button>
                <button onClick={() => setLinePreview('')} style={secondaryButtonStyle}>ซ่อนข้อความ</button>
              </div>
            </Section>
          )}
          {(error || message) && <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: error ? '#fef2f2' : '#ecfdf5', color: error ? '#b91c1c' : '#047857', fontWeight: 800 }}>{error || message}</div>}
        </main>

        <footer style={footerStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isEdit && canEdit && readOnly && <button onClick={() => setEditing(true)} style={primaryButtonStyle}>แก้ไข</button>}
            {isEdit && canEdit && <button onClick={toggleComplete} style={completedState ? secondaryButtonStyle : successButtonStyle}>{completedState ? 'เปิดงานอีกครั้ง' : 'Complete'}</button>}
            {isEdit && task && <button onClick={() => onCreateSubtask?.(task)} style={purpleButtonStyle}>+ เพิ่ม Subtask</button>}
            {isEdit && <button disabled={busy === 'line'} onClick={createLineMessage} style={linePreview ? successButtonStyle : lineButtonStyle}>{busy === 'line' ? 'กำลังสร้าง LINE...' : linePreview ? '✓ สร้าง LINE แล้ว' : '💬 สร้างข้อความ LINE'}</button>}
            {isEdit && <button disabled={busy === 'invite'} onClick={sendCalendarInvite} style={googleCalButtonStyle}>{busy === 'invite' ? 'กำลังเปิด Calendar...' : `📅 ส่งนัดหมาย${attendeeEmails.length ? ` (${attendeeEmails.length})` : ''}`}</button>}
            {isEdit && <button disabled={busy === 'calendar'} onClick={syncCalendar} style={syncCalButtonStyle}>{busy === 'calendar' ? 'กำลัง Sync...' : '🔄 Sync Calendar YEC'}</button>}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {isEdit && canDelete && !readOnly && (confirmDelete ? <><span style={{ color: '#ef4444', fontWeight: 800 }}>ยืนยันลบ?</span><button onClick={deleteTask} style={dangerButtonStyle}>ลบ</button><button onClick={() => setConfirmDelete(false)} style={secondaryButtonStyle}>ยกเลิก</button></> : <button onClick={() => setConfirmDelete(true)} style={dangerOutlineButtonStyle}>ลบงาน</button>)}
            <button onClick={onClose} style={secondaryButtonStyle}>{readOnly ? 'ปิด' : 'ยกเลิก'}</button>
            {!readOnly && <button disabled={saving} onClick={handleSave} style={primaryButtonStyle}>{saving ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'สร้างงาน'}</button>}
          </div>
        </footer>
      </div>

      {confirmingInvite && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onMouseDown={event => { if (event.target === event.currentTarget) setConfirmingInvite(false) }}>
          <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 440, boxShadow: '0 24px 64px rgba(15,23,42,0.25)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,#1d4ed8,#2563eb)', padding: '14px 18px' }}>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, fontFamily: FONT }}>ยืนยันรายชื่อผู้รับนัดหมาย</div>
            </div>
            <div style={{ padding: 18 }}>
              {attendeeEmails.length ? (
                <>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10, fontFamily: FONT }}>ระบบจะส่งนัดหมายให้กรรมการ/สมาชิกที่เข้าร่วม {attendeeEmails.length} รายการนี้ทันที:</div>
                  <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                    {attendeeEmails.map(email => (
                      <div key={email} style={{ padding: '7px 11px', borderRadius: 10, background: '#f8fafc', color: '#334155', fontSize: 13, fontFamily: FONT }}>{email}</div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', fontFamily: FONT }}>
                  ยังไม่พบอีเมลกรรมการ/สมาชิกที่เข้าร่วม — จะสร้างนัดหมายโดยยังไม่มีผู้รับเชิญ คุณสามารถเพิ่มเองในหน้า Google Calendar ได้
                </div>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmingInvite(false)} style={secondaryButtonStyle}>ยกเลิก</button>
              <button disabled={busy === 'invite'} onClick={confirmSendCalendarInvite} style={{ ...primaryButtonStyle, background: '#1d4ed8' }}>{busy === 'invite' ? 'กำลังส่ง...' : 'ยืนยัน ส่งนัดหมาย'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: 'grid', gap: 7, color: '#64748b', fontWeight: 800, fontSize: 13 }}>{label}{children}</label>
}

function Section({ title, purple, children }: { title: string; purple?: boolean; children: ReactNode }) {
  return <section style={{ ...sectionStyle, borderColor: purple ? '#ddd6fe' : '#e2e8f0', background: purple ? '#faf5ff' : '#fff' }}><h3 style={{ ...sectionTitleStyle, color: purple ? '#6d28d9' : '#334155' }}>{title}</h3>{children}</section>
}

function InfoPill({ label, value, color, tone }: { label: string; value: string; color?: string; tone?: 'date' | 'time' }) {
  const highlight = tone === 'date'
    ? { background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', shadow: '0 8px 20px rgba(249,115,22,0.12)' }
    : tone === 'time'
      ? { background: '#eff6ff', borderColor: '#bfdbfe', color: '#1d4ed8', shadow: '0 8px 20px rgba(37,99,235,0.12)' }
      : null

  return (
    <span style={{
      borderRadius: 999,
      padding: highlight ? '9px 15px' : '7px 11px',
      border: `1.5px solid ${highlight?.borderColor || '#dbe4ee'}`,
      background: highlight?.background || (color ? `${color}18` : '#f8fafc'),
      color: highlight?.color || color || '#334155',
      boxShadow: highlight?.shadow,
      fontWeight: 900,
      fontSize: highlight ? 14 : 13,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
    }}>
      <span style={{ opacity: 0.78 }}>{label}:</span>
      <strong style={{ color: highlight?.color || color || '#334155', fontWeight: 950 }}>{value}</strong>
    </span>
  )
}

function ChipList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <div style={{ color: '#94a3b8' }}>{empty}</div>
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{items.map((item, index) => <span key={`${item}-${index}`} style={chipStyle}>{item}</span>)}</div>
}

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <span style={chipStyle}>{label}<button onClick={onRemove} style={{ marginLeft: 6, border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer' }}>x</button></span>
}

function FileList({ attachments, onRemove }: { attachments: Attachment[]; onRemove?: (id?: string) => void }) {
  if (!attachments.length) return <div style={{ marginTop: 10, color: '#94a3b8' }}>ยังไม่มีไฟล์แนบ</div>
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
      {attachments.map(file => {
        const url = attachmentUrl(file)
        const isDataUrl = url.startsWith('data:')
        const isLink = !isDataUrl && (url.startsWith('http') || url.startsWith('//') || file.linkType === 'link')
        const icon = isLink ? '🔗' : '📎'
        return (
          <div key={file.id ?? file.name} style={fileRowStyle}>
            {url ? (
              <a
                href={url}
                download={isDataUrl ? file.name : undefined}
                target={isLink ? '_blank' : undefined}
                rel={isLink ? 'noreferrer' : undefined}
                style={fileLinkStyle}
                title={isLink ? url : file.name}
              >
                <span style={{ marginRight: 6, fontSize: 14, flexShrink: 0 }}>{icon}</span>
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{file.name}</span>
              </a>
            ) : (
              <span style={{ ...fileLinkStyle, color: '#94a3b8', textDecoration: 'none', cursor: 'default' }}>
                <span style={{ marginRight: 6, fontSize: 14, flexShrink: 0 }}>⚠️</span>
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{file.name}</span>
                {onRemove && <span style={{ marginLeft: 6, fontSize: 11, color: '#ef4444', flexShrink: 0 }}>ลิงก์หาย — ลบแล้ว upload ใหม่</span>}
              </span>
            )}
            {onRemove && <button onClick={() => onRemove(file.id)} style={iconButtonStyle}>x</button>}
          </div>
        )
      })}
    </div>
  )
}

function DriveBox({ url }: { url: string }) {
  return (
    <section style={{ ...sectionStyle, background: '#ecfdf5', borderColor: '#bbf7d0' }}>
      <h3 style={{ ...sectionTitleStyle, color: '#047857' }}>Google Drive Folder</h3>
      <a href={url} target="_blank" rel="noreferrer" style={driveButtonStyle}>
        <span style={{ fontSize: 16 }}>📂</span> เปิด Google Drive
      </a>
    </section>
  )
}

const backdropStyle: CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }
const modalStyle: CSSProperties = { width: 'min(900px, 96vw)', maxHeight: '92vh', overflow: 'hidden', borderRadius: 22, background: '#fff', boxShadow: '0 24px 80px rgba(15,23,42,0.26)', display: 'flex', flexDirection: 'column', borderTop: '7px solid #1d4ed8' }
const headerStyle: CSSProperties = { padding: '22px 26px 18px', borderBottom: '1px solid #e8edf5', display: 'flex', alignItems: 'flex-start', gap: 16 }
const titleStyle: CSSProperties = { margin: 0, fontFamily: FONT, fontSize: 25, lineHeight: 1.25, color: '#0f172a' }
const closeButtonStyle: CSSProperties = { width: 38, height: 38, border: 'none', borderRadius: 999, background: '#f8fafc', color: '#94a3b8', cursor: 'pointer', fontSize: 20, lineHeight: 1 }
const inputStyle: CSSProperties = { width: '100%', minHeight: 44, border: '1.5px solid #dbe4ee', borderRadius: 12, background: '#fff', color: '#0f172a', outline: 'none', padding: '0 12px', fontFamily: FONT, fontSize: 14 }
const sectionStyle: CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 16, background: '#fff', padding: 16 }
const sectionTitleStyle: CSSProperties = { margin: '0 0 10px', fontFamily: FONT, fontSize: 14, fontWeight: 900, color: '#334155' }
const subLabelStyle: CSSProperties = { margin: '3px 0 8px', color: '#64748b', fontSize: 12.5, fontWeight: 900 }
const chipStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '7px 11px', background: '#f8fafc', border: '1px solid #dbe4ee', color: '#475569', fontFamily: FONT, fontWeight: 800, fontSize: 13 }
const footerStyle: CSSProperties = { padding: '15px 24px', borderTop: '1px solid #e8edf5', background: '#fbfdff', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }
const primaryButtonStyle: CSSProperties = { border: 'none', borderRadius: 12, padding: '10px 16px', background: 'linear-gradient(135deg, #1a2744, #2d4a8a)', color: '#fff', cursor: 'pointer', fontFamily: FONT, fontWeight: 900 }
const secondaryButtonStyle: CSSProperties = { border: '1.5px solid #dbe4ee', borderRadius: 12, padding: '9px 13px', background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: FONT, fontWeight: 800 }
const successButtonStyle: CSSProperties = { ...secondaryButtonStyle, borderColor: '#bbf7d0', background: '#ecfdf5', color: '#047857' }
const purpleButtonStyle: CSSProperties = { ...secondaryButtonStyle, borderColor: '#c4b5fd', background: '#f5f3ff', color: '#6d28d9' }
const dangerOutlineButtonStyle: CSSProperties = { ...secondaryButtonStyle, borderColor: '#fecaca', color: '#dc2626' }
const dangerButtonStyle: CSSProperties = { border: 'none', borderRadius: 12, padding: '9px 13px', background: '#dc2626', color: '#fff', cursor: 'pointer', fontFamily: FONT, fontWeight: 900 }
const iconButtonStyle: CSSProperties = { width: 32, height: 32, border: 'none', borderRadius: 9, background: '#f8fafc', color: '#ef4444', cursor: 'pointer', fontWeight: 900 }
const dropzoneStyle: CSSProperties = { border: '2px dashed #c7d2fe', borderRadius: 16, background: '#f8fbff', minHeight: 118, display: 'grid', placeItems: 'center', padding: 18, textAlign: 'center', color: '#64748b', fontWeight: 800 }
const fileRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 12, padding: '9px 11px', background: '#fff' }
const fileLinkStyle: CSSProperties = { display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, color: '#1d4ed8', textDecoration: 'underline', textDecorationColor: 'rgba(29,78,216,0.4)', fontWeight: 700, fontFamily: FONT, fontSize: 13.5, overflow: 'hidden', cursor: 'pointer' }
const driveButtonStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 12, padding: '10px 16px', background: 'linear-gradient(135deg, #16a34a, #22c55e)', color: '#fff', cursor: 'pointer', fontFamily: FONT, fontWeight: 900, fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: '0 3px 10px rgba(34,197,94,0.35)' }
const lineButtonStyle: CSSProperties = { ...secondaryButtonStyle, borderColor: '#4ade80', background: '#f0fdf4', color: '#16a34a' }
const googleCalButtonStyle: CSSProperties = { ...secondaryButtonStyle, borderColor: '#93c5fd', background: '#eff6ff', color: '#1d4ed8' }
const syncCalButtonStyle: CSSProperties = { ...secondaryButtonStyle, borderColor: '#67e8f9', background: '#ecfeff', color: '#0e7490' }
