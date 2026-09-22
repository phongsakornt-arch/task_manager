import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activityLog'
import { canEditApprovals } from '../../lib/permissions'
import { useAuthStore } from '../../stores/authStore'
import type { ApprovalApprover, ApprovalDocument, ApprovalLog, ApprovalStatus, Member } from '../../types'

type FilterKey = ApprovalStatus | 'all'

type ApproverDraft = {
  id: string
  name: string
  email: string
  member_id?: string
}

type ApprovalLink = {
  approverId: string
  name: string
  email: string
  status: string
  url: string
}

const SHADOW = '0 10px 30px rgba(26,39,68,0.08), 0 1px 4px rgba(15,23,42,0.05)'

function isImg(url: string) { return /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url) }
function isPdf(url: string) { return /\.pdf(\?.*)?$/i.test(url) }
// Google Drive share links (e.g. /file/d/ID/view or open?id=ID) don't carry a
// file extension, so isImg/isPdf can't detect them — use Drive's own
// embeddable preview URL instead, which renders PDFs/images/docs inline.
function driveEmbedUrl(url: string): string | null {
  const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/)
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : null
}
function parseDocFiles(fileUrl?: string | null, fileName?: string | null): { name: string; url: string }[] {
  if (!fileUrl) return []
  try {
    const parsed = JSON.parse(fileUrl)
    if (Array.isArray(parsed)) return parsed
  } catch { /* ignore */ }
  return [{ name: fileName || 'เปิดไฟล์', url: fileUrl }]
}

const STATUS_META: Record<ApprovalStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'ร่าง', color: '#64748b', bg: '#f8fafc' },
  pending: { label: 'รออนุมัติ', color: '#b45309', bg: '#fffbeb' },
  approved: { label: 'อนุมัติแล้ว', color: '#047857', bg: '#ecfdf5' },
  revision_requested: { label: 'ขอแก้ไข', color: '#b91c1c', bg: '#fef2f2' },
  cancelled: { label: 'ยกเลิก', color: '#475569', bg: '#f1f5f9' },
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'pending', label: 'รออนุมัติ' },
  { key: 'revision_requested', label: 'ขอแก้ไข' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'draft', label: 'ร่าง' },
  { key: 'cancelled', label: 'ยกเลิก' },
]

function normalize(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function nextWaitingApprover(doc?: ApprovalDocument | null) {
  const approvers = [...(doc?.approval_approvers ?? [])].sort((a, b) => a.order_no - b.order_no)
  return approvers.find(item => item.status === 'waiting')
}

function statusFromApprovers(approvers: ApprovalApprover[]): ApprovalStatus {
  if (approvers.some(item => item.status === 'revision_requested')) return 'revision_requested'
  if (approvers.length > 0 && approvers.every(item => item.status === 'approved')) return 'approved'
  return 'pending'
}

function blankApprover(): ApproverDraft {
  return { id: crypto.randomUUID(), name: '', email: '' }
}

function printHtml(title: string, body: string) {
  const win = window.open('', '_blank', 'width=1120,height=760')
  if (!win) return
  win.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #0f172a; padding: 28px; }
          h1 { font-size: 22px; margin: 0 0 14px; }
          .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
          .kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; background: #f8fafc; }
          .num { font-size: 22px; font-weight: 800; }
          .label { font-size: 11px; color: #64748b; }
          .doc { border: 1px solid #dde6f2; border-radius: 12px; margin-bottom: 10px; overflow: hidden; break-inside: avoid; }
          .head { display: flex; justify-content: space-between; gap: 12px; padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
          .title { font-size: 14px; font-weight: 800; }
          .desc, .meta, .ap { font-size: 11px; color: #64748b; }
          .meta { padding: 8px 14px; border-bottom: 1px solid #f1f5f9; }
          .aps { padding: 8px 14px; }
          .ap { padding: 4px 0; border-bottom: 1px solid #f8fafc; }
          .pill { border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 800; background: #e2e8f0; color: #475569; white-space: nowrap; }
          .pending, .waiting { background: #fef3c7; color: #92400e; }
          .approved { background: #dcfce7; color: #047857; }
          .revision_requested { background: #fee2e2; color: #b91c1c; }
          .draft { background: #f1f5f9; color: #64748b; }
          @media print { body { padding: 12mm; } }
        </style>
      </head>
      <body>${body}</body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
}

export default function ApprovalPage() {
  const { user } = useAuthStore()
  const [docs, setDocs] = useState<ApprovalDocument[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [logs, setLogs] = useState<ApprovalLog[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [category, setCategory] = useState<ApprovalDocument['doc_type']>('sign')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [links, setLinks] = useState<ApprovalLink[]>([])
  const [linkLoading, setLinkLoading] = useState(false)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const [versionFileName, setVersionFileName] = useState('')
  const [versionFileUrl, setVersionFileUrl] = useState('')
  const [versionNote, setVersionNote] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [docType, setDocType] = useState<ApprovalDocument['doc_type']>('sign')
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string; type?: string; file?: File }[]>([])
  const [manualUrl, setManualUrl] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [approvers, setApprovers] = useState<ApproverDraft[]>([blankApprover()])
  const [approverSearchId, setApproverSearchId] = useState<string | null>(null)
  const [approverSearchText, setApproverSearchText] = useState('')
  const [actionNote, setActionNote] = useState('')
  const [fileUploading, setFileUploading] = useState(false)
  const [docReading, setDocReading] = useState(false)
  const [docReadFile, setDocReadFile] = useState<File | null>(null)
  const [aiResult, setAiResult] = useState<{
    summary?: string; recommendation?: string; reason?: string;
    risk_level?: string; confidence?: number; error?: string
  } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const canEdit = canEditApprovals(user?.role)

  const loadDocs = async () => {
    setLoading(true)
    setError(null)

    const [docsRes, membersRes] = await Promise.all([
      supabase
        .from('approval_documents')
        .select('*, approval_approvers(*)')
        .eq('deleted', false)
        .order('updated_at', { ascending: false }),
      supabase
        .from('members')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name_th'),
    ])

    const firstError = docsRes.error || membersRes.error
    if (firstError) {
      setError(firstError.message)
      setDocs([])
    } else {
      const nextDocs = (docsRes.data ?? []) as ApprovalDocument[]
      nextDocs.forEach(doc => doc.approval_approvers?.sort((a, b) => a.order_no - b.order_no))
      setDocs(nextDocs)
      setMembers((membersRes.data ?? []) as Member[])
      // ไม่ auto-select — ผู้ใช้คลิกเปิด popup เอง
    }

    setLoading(false)
  }

  useEffect(() => {
    let active = true

    const run = async () => {
      await loadDocs()
      if (!active) return
    }

    run()

    return () => {
      active = false
    }
  }, [])

  const categoryCounts = useMemo(() => {
    return docs.reduce<Record<ApprovalDocument['doc_type'], number>>((acc, doc) => {
      acc[doc.doc_type] = (acc[doc.doc_type] ?? 0) + 1
      return acc
    }, { sign: 0, disbursement: 0 })
  }, [docs])

  const categoryDocs = useMemo(() => docs.filter(doc => doc.doc_type === category), [docs, category])

  const counts = useMemo(() => {
    return categoryDocs.reduce<Record<FilterKey, number>>((acc, doc) => {
      acc.all += 1
      acc[doc.status] += 1
      return acc
    }, { all: 0, draft: 0, pending: 0, approved: 0, revision_requested: 0, cancelled: 0 })
  }, [categoryDocs])

  const filteredDocs = useMemo(() => {
    const keyword = normalize(search)
    return categoryDocs.filter(doc => {
      const matchesFilter = filter === 'all' || doc.status === filter
      const haystack = [
        doc.title,
        doc.description,
        doc.file_name,
        doc.created_by_email,
        ...(doc.approval_approvers ?? []).map(item => `${item.approver_name} ${item.approver_email}`),
      ].map(normalize).join(' ')
      return matchesFilter && (!keyword || haystack.includes(keyword))
    })
  }, [categoryDocs, filter, search])

  const selectedDoc = selectedId ? (docs.find(item => item.id === selectedId) ?? null) : null
  const selectedMeta = selectedDoc ? STATUS_META[selectedDoc.status] : STATUS_META.draft
  const nextApprover = nextWaitingApprover(selectedDoc)
  const selectedFiles = useMemo(
    () => parseDocFiles(selectedDoc?.file_url, selectedDoc?.file_name),
    [selectedDoc?.file_url, selectedDoc?.file_name],
  )
  const selectedPreviewFiles = useMemo(
    () => selectedFiles
      .map(f => {
        const drive = driveEmbedUrl(f.url)
        if (drive) return { ...f, kind: 'embed' as const, embedUrl: drive }
        if (isImg(f.url)) return { ...f, kind: 'img' as const, embedUrl: f.url }
        if (isPdf(f.url)) return { ...f, kind: 'embed' as const, embedUrl: f.url }
        return null
      })
      .filter((f): f is { name: string; url: string; kind: 'img' | 'embed'; embedUrl: string } => f !== null),
    [selectedFiles],
  )
  const canEditSelected = canEdit && (!selectedDoc || selectedDoc.status === 'draft' || selectedDoc.status === 'revision_requested')
  const canSubmitSelected = canEditSelected && approvers.some(item => item.name.trim() && item.email.trim())

  const openEditor = (doc?: ApprovalDocument | null) => {
    setEditing(true)
    setError(null)
    setLogs([])
    setDocReadFile(null)
    setManualUrl('')
    setApproverSearchId(null)
    setApproverSearchText('')
    if (!doc) {
      setSelectedId(null)
      setTitle('')
      setDescription('')
      setDocType(category)
      setUploadedFiles([])
      setApprovers([blankApprover()])
      return
    }

    setSelectedId(doc.id)
    setTitle(doc.title)
    setDescription(doc.description ?? '')
    setDocType(doc.doc_type)
    // โหลด files — รองรับทั้ง JSON array (ใหม่) และ single URL (เก่า)
    const existingFiles = (() => {
      if (!doc.file_url) return []
      try {
        const parsed = JSON.parse(doc.file_url)
        if (Array.isArray(parsed)) return parsed as { name: string; url: string }[]
      } catch { /* ignore */ }
      return [{ name: doc.file_name || 'ไฟล์', url: doc.file_url }]
    })()
    setUploadedFiles(existingFiles)
    const existingApprovers: ApproverDraft[] = (doc.approval_approvers ?? []).map(item => ({
      id: item.id,
      name: item.approver_name,
      email: item.approver_email,
      member_id: item.member_id,
    }))
    setApprovers(existingApprovers.length ? existingApprovers : [blankApprover()])
  }

  const addApproverFromMember = (memberId: string) => {
    const member = members.find(item => item.id === memberId)
    if (!member) return
    setApprovers(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: member.name_th,
        email: member.email ?? '',
        member_id: member.id,
      },
    ])
  }

  const saveDoc = async (submit = false) => {
    if (!user || !canEdit || saving) return
    const cleanApprovers = approvers
      .map(item => ({ ...item, name: item.name.trim(), email: item.email.trim().toLowerCase() }))
      .filter(item => item.name && item.email)

    if (!title.trim()) {
      setError('กรุณาระบุชื่อเอกสาร')
      return
    }
    if (submit && cleanApprovers.length === 0) {
      setError('กรุณาระบุผู้อนุมัติอย่างน้อย 1 คน')
      return
    }

    setSaving(true)
    setError(null)

    // รวม manual URL เข้า uploadedFiles ถ้ามี
    const allFiles = manualUrl.trim()
      ? [...uploadedFiles, { name: manualUrl.trim(), url: manualUrl.trim() }]
      : uploadedFiles
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      file_name: allFiles.length ? allFiles.map(f => f.name).join(', ') : null,
      file_url: allFiles.length ? (allFiles.length === 1 ? allFiles[0].url : JSON.stringify(allFiles)) : null,
      status: submit ? 'pending' : (selectedDoc?.status === 'revision_requested' ? 'draft' : selectedDoc?.status ?? 'draft'),
      doc_type: docType,
      created_by: selectedDoc?.created_by ?? user.id,
      created_by_email: selectedDoc?.created_by_email ?? user.email,
    }

    const docResult = selectedDoc?.id
      ? await supabase.from('approval_documents').update(payload).eq('id', selectedDoc.id).select('*').single()
      : await supabase.from('approval_documents').insert(payload).select('*').single()

    if (docResult.error || !docResult.data) {
      setError(docResult.error?.message ?? 'บันทึกเอกสารไม่สำเร็จ')
      setSaving(false)
      return
    }

    const doc = docResult.data as ApprovalDocument

    if (cleanApprovers.length) {
      await supabase.from('approval_approvers').delete().eq('approval_id', doc.id)
      const rows = cleanApprovers.map((item, index) => ({
        approval_id: doc.id,
        order_no: index + 1,
        approver_name: item.name,
        approver_email: item.email,
        member_id: item.member_id || null,
        status: 'waiting',
      }))
      const approverResult = await supabase.from('approval_approvers').insert(rows).select('*')
      if (approverResult.error) {
        setError(approverResult.error.message)
        setSaving(false)
        return
      }
    }

    await supabase.from('approval_logs').insert({
      approval_id: doc.id,
      action: submit ? 'submitted' : (selectedDoc ? 'updated' : 'created'),
      detail: submit ? 'ส่งเอกสารเข้ากระบวนการอนุมัติ' : 'บันทึกข้อมูลเอกสาร',
      actor_email: user.email,
    })
    await logActivity(user, submit ? 'approval.submitted' : 'approval.saved', doc.title, { approval_id: doc.id })

    setSelectedId(doc.id)
    setEditing(false)
    setSaving(false)
    await loadDocs()
  }

  const cancelDoc = async () => {
    if (!user || !selectedDoc || !canEdit || selectedDoc.status === 'approved' || selectedDoc.status === 'cancelled') return
    setSaving(true)
    const { error } = await supabase.from('approval_documents').update({ status: 'cancelled' }).eq('id', selectedDoc.id)
    if (error) setError(error.message)
    else {
      await supabase.from('approval_logs').insert({ approval_id: selectedDoc.id, action: 'cancelled', detail: 'ยกเลิกเอกสาร', actor_email: user.email })
      await logActivity(user, 'approval.cancelled', selectedDoc.title, { approval_id: selectedDoc.id })
      await loadDocs()
    }
    setSaving(false)
  }

  const deleteDoc = async () => {
    if (!user || !selectedDoc || !canEdit) return
    setSaving(true)
    const { error } = await supabase.from('approval_documents').update({ deleted: true, deleted_at: new Date().toISOString() }).eq('id', selectedDoc.id)
    if (error) setError(error.message)
    else {
      await logActivity(user, 'approval.deleted', selectedDoc.title, { approval_id: selectedDoc.id })
      setSelectedId(null)
      await loadDocs()
    }
    setSaving(false)
  }

  const actOnApprover = async (approver: ApprovalApprover, status: 'approved' | 'revision_requested') => {
    if (!user || !selectedDoc || !canEdit) return
    setSaving(true)
    setError(null)

    const { error } = await supabase
      .from('approval_approvers')
      .update({ status, acted_at: new Date().toISOString(), note: actionNote.trim() || null })
      .eq('id', approver.id)

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    const updatedApprovers = (selectedDoc.approval_approvers ?? []).map(item => item.id === approver.id ? { ...item, status, note: actionNote, acted_at: new Date().toISOString() } : item)
    const nextStatus = statusFromApprovers(updatedApprovers)
    await supabase.from('approval_documents').update({ status: nextStatus }).eq('id', selectedDoc.id)
    await supabase.from('approval_logs').insert({
      approval_id: selectedDoc.id,
      approver_id: approver.id,
      action: status,
      detail: status === 'approved' ? 'อนุมัติเอกสาร' : 'ขอแก้ไขเอกสาร',
      actor_email: user.email,
      meta: { note: actionNote.trim() || null },
    })
    await logActivity(user, `approval.${status}`, selectedDoc.title, { approval_id: selectedDoc.id, approver_id: approver.id })
    setActionNote('')
    setSaving(false)
    await loadDocs()
  }

  const loadLogs = async () => {
    if (!selectedDoc) return
    const { data, error } = await supabase
      .from('approval_logs')
      .select('*')
      .eq('approval_id', selectedDoc.id)
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setLogs((data ?? []) as ApprovalLog[])
  }

  const loadApprovalLinks = async () => {
    if (!selectedDoc) return
    setLinkLoading(true)
    setError(null)
    setCopiedLink(null)

    const { data, error } = await supabase.functions.invoke<{ success: boolean; links: ApprovalLink[] }>('approval-links', {
      body: { approvalId: selectedDoc.id },
    })

    if (error) {
      setError(error.message)
      setLinks([])
    } else {
      setLinks(data?.links ?? [])
    }

    setLinkLoading(false)
  }

  const copyApprovalLink = async (link: ApprovalLink) => {
    await navigator.clipboard.writeText(link.url)
    setCopiedLink(link.approverId)
  }

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    if (!fileArr.length) return
    setFileUploading(true)
    setError(null)
    const results: { name: string; url: string; type?: string; file?: File }[] = []
    for (const file of fileArr) {
      try {
        const ext = (file.name.split('.').pop() ?? 'bin').replace(/[^a-zA-Z0-9]/g, '')
        const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const path = `approvals/${uid}.${ext}`
        const { error: upErr } = await supabase.storage.from('receipts').upload(path, file, {
          contentType: file.type, upsert: false,
        })
        if (upErr) {
          setError(`อัปโหลด "${file.name}" ไม่สำเร็จ: ${upErr.message}`)
        } else {
          const { data } = supabase.storage.from('receipts').getPublicUrl(path)
          results.push({ name: file.name, url: data.publicUrl, type: file.type, file })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ')
      }
    }
    if (results.length) setUploadedFiles(prev => [...prev, ...results])
    setFileUploading(false)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) await uploadFiles(e.target.files)
    e.target.value = ''
  }

  const readDocWithAI = async (file: File) => {
    setDocReading(true)
    setError(null)
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1] ?? '')
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const { data, error: fnErr } = await supabase.functions.invoke('extract-doc-info', {
        body: { imageBase64: b64, mimeType: file.type },
      })
      if (fnErr) {
        setError(`AI อ่านเอกสารไม่สำเร็จ: ${fnErr.message}`)
      } else if (data?.error) {
        setError(`AI: ${data.error}`)
      } else {
        if (data?.title)       setTitle(data.title)
        if (data?.description) setDescription(data.description)
      }
    } catch (err) {
      setError(`AI อ่านเอกสารไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`)
    }
    setDocReading(false)
  }

  const analyzeWithAI = async () => {
    if (!selectedDoc || aiLoading) return
    setAiLoading(true)
    setAiResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('ai-approval', {
        body: {
          title: selectedDoc.title,
          description: selectedDoc.description,
          fileName: selectedDoc.file_name,
          version: selectedDoc.version ?? 1,
          approvers: (selectedDoc.approval_approvers ?? []).map(a => ({
            name: a.approver_name,
            email: a.approver_email,
            status: a.status,
            note: a.note ?? null,
          })),
        },
      })
      if (error) {
        setAiResult({ error: `เรียก AI ไม่สำเร็จ: ${error.message}` })
      } else if (data?.error) {
        setAiResult({ error: data.error })
      } else {
        setAiResult(data as typeof aiResult)
      }
    } catch (err) {
      setAiResult({ error: `เรียก AI ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}` })
    }
    setAiLoading(false)
  }

  const uploadNewVersion = async () => {
    if (!user || !selectedDoc || saving) return
    if (!versionFileName.trim() && !versionFileUrl.trim()) {
      setError('กรุณาระบุชื่อไฟล์หรือลิงก์ไฟล์เวอร์ชันใหม่')
      return
    }

    setSaving(true)
    setError(null)

    const { error } = await supabase.functions.invoke('upload-approval-version', {
      body: {
        approvalId: selectedDoc.id,
        fileName: versionFileName.trim() || null,
        fileUrl: versionFileUrl.trim() || null,
        changeNote: versionNote.trim() || null,
      },
    })

    if (error) {
      setError(error.message)
    } else {
      await logActivity(user, 'approval.version.uploaded', selectedDoc.title, { approval_id: selectedDoc.id })
      setVersionFileName('')
      setVersionFileUrl('')
      setVersionNote('')
      setLinks([])
      await loadDocs()
    }

    setSaving(false)
  }

  const exportApprovalReport = () => {
    const reportDocs = filteredDocs.length ? filteredDocs : docs
    const counts = {
      all: reportDocs.length,
      pending: reportDocs.filter(doc => doc.status === 'pending').length,
      revision: reportDocs.filter(doc => doc.status === 'revision_requested').length,
      approved: reportDocs.filter(doc => doc.status === 'approved').length,
      draft: reportDocs.filter(doc => doc.status === 'draft').length,
    }
    const docCards = reportDocs.map(doc => {
      const approvers = (doc.approval_approvers ?? []).map((approver, index) => `
        <div class="ap">${index + 1}. <strong>${approver.approver_name}</strong> (${approver.approver_email}) <span class="pill ${approver.status}">${approver.status}</span>${approver.note ? ` - ${approver.note}` : ''}</div>
      `).join('') || '<div class="ap">No approvers</div>'
      return `
        <section class="doc">
          <div class="head">
            <div><div class="title">${doc.title}</div>${doc.description ? `<div class="desc">${doc.description}</div>` : ''}</div>
            <span class="pill ${doc.status}">${STATUS_META[doc.status].label}</span>
          </div>
          <div class="meta">ID: ${doc.id} | Version: ${doc.version ?? 1}${doc.file_name ? ` | File: ${doc.file_name}` : ''} | Updated: ${formatDate(doc.updated_at)}</div>
          <div class="aps">${approvers}</div>
        </section>
      `
    }).join('')
    printHtml('Approval Report', `
      <h1>Approval Report</h1>
      <div class="kpis">
        <div class="kpi"><div class="num">${counts.all}</div><div class="label">All</div></div>
        <div class="kpi"><div class="num">${counts.pending}</div><div class="label">Pending</div></div>
        <div class="kpi"><div class="num">${counts.revision}</div><div class="label">Revision</div></div>
        <div class="kpi"><div class="num">${counts.approved}</div><div class="label">Approved</div></div>
        <div class="kpi"><div class="num">${counts.draft}</div><div class="label">Draft</div></div>
      </div>
      ${docCards || '<div>No approval documents</div>'}
    `)
  }

  const inputStyle: React.CSSProperties = {
    padding: '10px 13px', borderRadius: 12, border: '1.5px solid #e4e8f2',
    fontFamily: 'Anuphan, sans-serif', fontSize: 14, outline: 'none',
    background: '#f8fafc', color: '#0f172a', width: '100%', boxSizing: 'border-box',
  }

  const btnPrimary: React.CSSProperties = {
    border: 'none', borderRadius: 11, padding: '10px 18px',
    background: '#1a2744', color: '#fff', cursor: 'pointer',
    fontFamily: 'Anuphan, sans-serif', fontWeight: 700, fontSize: 14,
  }

  const btnGhost = (color = '#334155', bg = '#f1f5f9'): React.CSSProperties => ({
    border: 'none', borderRadius: 10, padding: '8px 14px',
    background: bg, color, cursor: 'pointer',
    fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 600,
  })

  const STATUS_BORDER: Record<string, string> = {
    draft: '#94a3b8', pending: '#f59e0b', approved: '#10b981',
    revision_requested: '#ef4444', cancelled: '#cbd5e1',
  }

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#f0f4fa' }}>

      {/* ── TOP BAR ── */}
      <div
        className="flex flex-col md:flex-row md:items-center"
        style={{
          gap: 14, padding: '14px 24px',
          background: '#fff', borderBottom: '1px solid #e4e8f2',
          boxShadow: '0 2px 10px rgba(0,0,0,0.05)', flexShrink: 0,
        }}
      >
        <div className="flex items-center" style={{ gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: 'linear-gradient(135deg, #1a2744, #2d4a8a)',
            color: '#c9a84c', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Anuphan, sans-serif', fontWeight: 800, fontSize: 18,
            boxShadow: '0 4px 12px rgba(26,39,68,0.25)',
          }}>◎</div>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 18, fontWeight: 800, color: '#1e293b' }}>เอกสารอนุมัติ</h1>
            <p style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#94a3b8' }}>{filteredDocs.length} จาก {categoryDocs.length} เอกสาร</p>
          </div>
        </div>
        <div className="flex flex-wrap md:ml-auto" style={{ gap: 10, alignItems: 'center' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍  ค้นหาเอกสาร ผู้อนุมัติ ไฟล์..."
            className="w-full md:w-[280px]"
            style={{ ...inputStyle, minHeight: 40, minWidth: 0 }}
          />
          <button onClick={exportApprovalReport} style={btnGhost()}>📄 รายงาน PDF</button>
          {canEdit && (
            <button onClick={() => { openEditor(null); setSelectedId('__new__') }} style={btnPrimary}>+ สร้างเอกสาร</button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 24px' }}>

        {/* ── CATEGORY TABS ── */}
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: '#e2e8f0', marginBottom: 16, width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
          {([
            { key: 'sign' as const, label: '📝 เอกสารเสนอเซ็น' },
            { key: 'disbursement' as const, label: '💵 เอกสารอนุมัติเบิกจ่าย' },
          ]).map(item => {
            const active = category === item.key
            return (
              <button
                key={item.key}
                onClick={() => { setCategory(item.key); setFilter('all'); setSelectedId(null) }}
                style={{
                  border: 'none', borderRadius: 11, padding: '10px 16px',
                  background: active ? '#fff' : 'transparent',
                  color: active ? '#1e293b' : '#64748b',
                  boxShadow: active ? '0 2px 8px rgba(15,23,42,0.08)' : 'none',
                  cursor: 'pointer', fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label} <span style={{ opacity: 0.65, fontWeight: 600 }}>({categoryCounts[item.key]})</span>
              </button>
            )
          })}
        </div>

        {/* ── STATUS FILTER CARDS ── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {FILTERS.map(item => {
            const meta = item.key === 'all' ? { color: '#1a2744', bg: '#e8edf8' } : STATUS_META[item.key]
            const active = filter === item.key
            return (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                style={{
                  border: active ? `2px solid ${meta.color}` : '2px solid transparent',
                  borderRadius: 14, padding: '10px 18px',
                  background: active ? meta.bg : '#fff',
                  boxShadow: active ? `0 4px 14px ${meta.color}22` : '0 1px 4px rgba(0,0,0,0.06)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  fontFamily: 'Anuphan, sans-serif', fontSize: 20, fontWeight: 800,
                  color: active ? meta.color : '#64748b', lineHeight: 1,
                }}>{counts[item.key]}</span>
                <span style={{
                  fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: active ? 700 : 400,
                  color: active ? meta.color : '#64748b',
                }}>{item.label}</span>
              </button>
            )
          })}
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 12, background: '#fff7ed', color: '#9a3412', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, border: '1px solid #fed7aa' }}>
            ⚠️ {error}
          </div>
        )}
        {loading && (
          <div style={{ padding: 36, borderRadius: 18, background: '#fff', color: '#94a3b8', textAlign: 'center', fontFamily: 'Anuphan, sans-serif', boxShadow: SHADOW }}>
            กำลังโหลดเอกสาร...
          </div>
        )}

        {!loading && (
          <div>
            {/* ── DOCUMENT CARD GRID ── */}
            {filteredDocs.length === 0 ? (
              <div style={{ padding: 48, borderRadius: 18, background: '#fff', color: '#94a3b8', textAlign: 'center', fontFamily: 'Anuphan, sans-serif', fontSize: 14, boxShadow: SHADOW }}>
                ไม่พบเอกสาร
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                {filteredDocs.map(doc => {
                  const meta = STATUS_META[doc.status]
                  const approverCount = doc.approval_approvers?.length ?? 0
                  const done = doc.approval_approvers?.filter(item => item.status === 'approved').length ?? 0
                  const pct = approverCount > 0 ? Math.round(done / approverCount * 100) : 0
                  return (
                    <button
                      key={doc.id}
                      onClick={() => { setSelectedId(doc.id); setEditing(false); setLogs([]) }}
                      style={{
                        width: '100%', border: `1.5px solid #e2e8f0`, textAlign: 'left', cursor: 'pointer',
                        borderRadius: 16, background: '#fff', padding: 0,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)', transition: 'all 0.15s', outline: 'none',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 24px rgba(26,39,68,0.14)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = STATUS_BORDER[doc.status] }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = '#e2e8f0' }}
                    >
                      {/* Top color bar */}
                      <div style={{ height: 4, borderRadius: '14px 14px 0 0', background: STATUS_BORDER[doc.status] }} />
                      <div style={{ padding: '14px 16px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                          <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#0f172a', fontSize: 14.5, fontWeight: 700, lineHeight: 1.4, textAlign: 'left' }}>
                            {doc.title}
                          </div>
                          <span style={{
                            flexShrink: 0, borderRadius: 999, padding: '3px 10px',
                            background: meta.bg, color: meta.color,
                            fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 700,
                          }}>{meta.label}</span>
                        </div>
                        <div style={{ marginTop: 6, fontFamily: 'Anuphan, sans-serif', color: '#94a3b8', fontSize: 12.5, textAlign: 'left' }}>
                          {doc.file_name || 'ไม่มีไฟล์แนบ'} · v{doc.version ?? 1}
                        </div>
                        {approverCount > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ height: 5, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: pct === 100 ? '#10b981' : '#3b82f6' }} />
                            </div>
                            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#94a3b8' }}>
                              <span>{done}/{approverCount} ผู้อนุมัติ</span>
                              <span>อัปเดต {formatDate(doc.updated_at)}</span>
                            </div>
                          </div>
                        )}
                        {!approverCount && (
                          <div style={{ marginTop: 8, fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#94a3b8', textAlign: 'left' }}>
                            อัปเดต {formatDate(doc.updated_at)}
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── DOCUMENT DETAIL MODAL ── */}
      {(selectedDoc || (selectedId === '__new__' && editing)) && (
        <div
          onClick={() => { setSelectedId(null); setEditing(false); setLogs([]); setAiResult(null) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(15,23,42,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 780, maxHeight: '92vh',
              borderRadius: 20, background: '#f0f4fa',
              boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Modal inner scroll */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ display: 'grid', gap: 14, padding: 20 }}>

            {/* editor or detail */}
            {editing ? (
                /* ── EDITOR PANEL ── */
                <div style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid #e4e8f2', overflow: 'hidden' }}>
                  <div style={{ height: 4, background: 'linear-gradient(90deg, #1a2744, #2d4a8a, #c9a84c)' }} />
                  <div style={{ padding: 22 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                      <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', fontSize: 17, fontWeight: 800, color: '#1e293b' }}>
                        {selectedDoc ? '✏️ แก้ไขเอกสาร' : '📝 สร้างเอกสารใหม่'}
                      </h2>
                      <button onClick={() => { setEditing(false); if (!selectedDoc) { setSelectedId(null) } }} style={btnGhost('#64748b')}>ปิด ×</button>
                    </div>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div>
                        <div style={{ marginBottom: 6, fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>ประเภทเอกสาร</div>
                        <select value={docType} onChange={e => setDocType(e.target.value as ApprovalDocument['doc_type'])} style={inputStyle}>
                          <option value="sign">📝 เอกสารเสนอเซ็น</option>
                          <option value="disbursement">💵 เอกสารอนุมัติเบิกจ่าย</option>
                        </select>
                      </div>
                      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="ชื่อเอกสาร *" style={inputStyle} />
                      <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="รายละเอียดเพิ่มเติม" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                      {/* ── แนบไฟล์เอกสาร (drag & drop + multiple + AI อ่าน) ── */}
                      <div
                        onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
                        onDragEnter={e => { e.preventDefault(); setIsDragOver(true) }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={async e => { e.preventDefault(); setIsDragOver(false); if (e.dataTransfer.files.length) await uploadFiles(e.dataTransfer.files) }}
                        style={{
                          borderRadius: 14, border: `2px dashed ${isDragOver ? '#3b82f6' : '#c7d2e7'}`,
                          background: isDragOver ? '#eff6ff' : '#f8fafc',
                          padding: '13px 15px', display: 'grid', gap: 10,
                          transition: 'all 0.15s',
                        }}
                      >
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 700, color: '#475569' }}>
                              📎 แนบไฟล์เอกสาร {isDragOver ? '— วางไฟล์ที่นี่ 📂' : ''}
                            </div>
                            {!isDragOver && (
                              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                                ลากวางไฟล์ หรือคลิกเลือก · รองรับหลายไฟล์ · รูปภาพ AI อ่านได้
                              </div>
                            )}
                          </div>
                          <label style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            borderRadius: 10, padding: '8px 14px', cursor: fileUploading ? 'wait' : 'pointer',
                            background: fileUploading ? '#e2e8f0' : '#eff6ff', color: fileUploading ? '#94a3b8' : '#1d4ed8',
                            fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 700,
                            border: `1.5px solid ${fileUploading ? '#e2e8f0' : '#bfdbfe'}`,
                          }}>
                            {fileUploading ? '⏳ กำลังอัปโหลด...' : '⬆️ เลือกไฟล์'}
                            <input type="file" style={{ display: 'none' }} multiple disabled={fileUploading} onChange={handleFileUpload}
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.zip" />
                          </label>
                        </div>

                        {/* File list */}
                        {uploadedFiles.length > 0 && (
                          <div style={{ display: 'grid', gap: 6 }}>
                            {uploadedFiles.map((f, i) => {
                              const isImage = f.type?.startsWith('image/') ?? false
                              const isReadingThis = docReading && docReadFile === f.file
                              const wasRead = !docReading && docReadFile === f.file
                              return (
                                <div key={i} style={{
                                  borderRadius: 10, border: `1px solid ${wasRead ? '#ddd6fe' : '#bbf7d0'}`,
                                  background: wasRead ? '#faf5ff' : '#ecfdf5', overflow: 'hidden',
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px' }}>
                                    <span style={{ fontSize: 14 }}>{isImage ? '🖼️' : '📄'}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600, color: wasRead ? '#6d28d9' : '#047857', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                      <a href={f.url} target="_blank" rel="noreferrer" style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: wasRead ? '#7c3aed' : '#059669', textDecoration: 'none' }}>เปิด ↗</a>
                                    </div>
                                    {/* AI อ่านปุ่ม — เฉพาะรูปภาพ */}
                                    {isImage && f.file && (
                                      <button
                                        type="button"
                                        disabled={docReading}
                                        onClick={() => { setDocReadFile(f.file!); readDocWithAI(f.file!) }}
                                        style={{
                                          border: 'none', borderRadius: 8, padding: '5px 10px', cursor: docReading ? 'wait' : 'pointer',
                                          background: isReadingThis ? '#ede9fe' : wasRead ? '#ede9fe' : 'linear-gradient(90deg,#7c3aed,#a855f7)',
                                          color: (isReadingThis || wasRead) ? '#6d28d9' : '#fff',
                                          fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 700, flexShrink: 0,
                                          boxShadow: isReadingThis || wasRead ? 'none' : '0 2px 8px #a855f744',
                                        }}
                                      >
                                        {isReadingThis ? '⏳ AI อ่าน...' : wasRead ? '✅ อ่านแล้ว' : '🤖 AI อ่าน'}
                                      </button>
                                    )}
                                    <button type="button" onClick={() => { setUploadedFiles(prev => prev.filter((_, idx) => idx !== i)); if (docReadFile === f.file) setDocReadFile(null) }}
                                      style={{ border: 'none', background: '#fef2f2', color: '#b91c1c', borderRadius: 7, width: 26, height: 26, cursor: 'pointer', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>×</button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Manual URL */}
                        <input value={manualUrl} onChange={e => setManualUrl(e.target.value)}
                          placeholder="หรือวางลิงก์ไฟล์ (URL) โดยตรง"
                          style={{ ...inputStyle, fontSize: 12.5, background: '#fff' }} />
                      </div>

                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>ผู้อนุมัติ (เรียงตามลำดับ)</div>
                        <select
                          onChange={e => { addApproverFromMember(e.target.value); e.target.value = '' }}
                          style={{ ...inputStyle, marginBottom: 10 }}
                        >
                          <option value="">+ เพิ่มจากรายชื่อสมาชิก...</option>
                          {members.filter(m => m.email).map(m => (
                            <option key={m.id} value={m.id}>{m.name_th}{m.nickname ? ` (${m.nickname})` : ''} — {m.email}</option>
                          ))}
                        </select>
                        <div style={{ display: 'grid', gap: 8 }}>
                          {approvers.map((approver, index) => {
                            const isSearchOpen = approverSearchId === approver.id
                            const filteredMembers = members.filter(m => m.email && (
                              normalize(m.name_th).includes(normalize(approverSearchText)) ||
                              normalize(m.nickname ?? '').includes(normalize(approverSearchText)) ||
                              normalize(m.email ?? '').includes(normalize(approverSearchText))
                            )).slice(0, 6)
                            return (
                              <div key={approver.id}>
                                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
                                  <div style={{
                                    width: 28, height: 28, borderRadius: 999,
                                    background: '#eff6ff', color: '#1d4ed8',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 700,
                                  }}>{index + 1}</div>
                                  {/* Name input with member search */}
                                  <div style={{ position: 'relative' }}>
                                    <input
                                      value={isSearchOpen ? approverSearchText : approver.name}
                                      onChange={e => {
                                        if (isSearchOpen) {
                                          setApproverSearchText(e.target.value)
                                        } else {
                                          setApprovers(prev => prev.map(item => item.id === approver.id ? { ...item, name: e.target.value } : item))
                                        }
                                      }}
                                      onFocus={() => { setApproverSearchId(approver.id); setApproverSearchText('') }}
                                      placeholder="ค้นหาชื่อ..."
                                      style={{ ...inputStyle, fontSize: 13 }}
                                      autoComplete="off"
                                    />
                                    {/* Dropdown */}
                                    {isSearchOpen && filteredMembers.length > 0 && (
                                      <div style={{
                                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
                                        background: '#fff', borderRadius: 12, marginTop: 4,
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.15)', border: '1px solid #e4e8f2',
                                        overflow: 'hidden',
                                      }}>
                                        {filteredMembers.map(m => (
                                          <button
                                            key={m.id}
                                            type="button"
                                            onMouseDown={e => {
                                              e.preventDefault()
                                              setApprovers(prev => prev.map(item => item.id === approver.id ? {
                                                ...item, name: m.name_th, email: m.email ?? '', member_id: m.id,
                                              } : item))
                                              setApproverSearchId(null)
                                              setApproverSearchText('')
                                            }}
                                            style={{
                                              display: 'flex', alignItems: 'center', gap: 10,
                                              width: '100%', padding: '9px 12px', border: 'none',
                                              background: 'transparent', cursor: 'pointer', textAlign: 'left',
                                              borderBottom: '1px solid #f1f5f9',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                                          >
                                            <div style={{
                                              width: 30, height: 30, borderRadius: 999, flexShrink: 0,
                                              background: 'linear-gradient(135deg,#1a2744,#2d4a8a)',
                                              color: '#c9a84c', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                              fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 700,
                                            }}>{m.name_th.charAt(0)}</div>
                                            <div>
                                              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                                                {m.name_th}{m.nickname ? ` (${m.nickname})` : ''}
                                              </div>
                                              <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 11.5, color: '#94a3b8' }}>{m.email}</div>
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <input
                                    value={approver.email}
                                    onChange={e => setApprovers(prev => prev.map(item => item.id === approver.id ? { ...item, email: e.target.value } : item))}
                                    onFocus={() => { if (approverSearchId === approver.id) { setApproverSearchId(null) } }}
                                    placeholder="อีเมล"
                                    style={{ ...inputStyle, fontSize: 13 }}
                                  />
                                  <button
                                    onClick={() => setApprovers(prev => prev.filter(item => item.id !== approver.id))}
                                    style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer', fontWeight: 700 }}
                                  >×</button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <button
                          onClick={() => setApprovers(prev => [...prev, blankApprover()])}
                          style={{ ...btnGhost('#1d4ed8', '#eff6ff'), marginTop: 10, fontSize: 13 }}
                        >+ เพิ่มผู้อนุมัติ</button>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                        <button disabled={saving} onClick={() => saveDoc(false)} style={btnGhost()}>💾 บันทึกร่าง</button>
                        <button
                          disabled={saving || !canSubmitSelected}
                          onClick={() => saveDoc(true)}
                          style={{ ...btnPrimary, background: canSubmitSelected ? '#1a2744' : '#cbd5e1', cursor: canSubmitSelected ? 'pointer' : 'default' }}
                        >📤 ส่งอนุมัติ</button>
                      </div>
                    </div>
                  </div>
                </div>

              ) : selectedDoc ? (
                <>
                  {/* ── DOC DETAIL CARD ── */}
                  <div style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid #e4e8f2', overflow: 'hidden' }}>
                    <div style={{ height: 4, background: `linear-gradient(90deg, ${STATUS_BORDER[selectedDoc.status]}, ${STATUS_BORDER[selectedDoc.status]}88)` }} />
                    <div style={{ padding: '18px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <h2 style={{ margin: 0, fontFamily: 'Anuphan, sans-serif', color: '#0f172a', fontSize: 17, fontWeight: 800, lineHeight: 1.35 }}>
                            {selectedDoc.title}
                          </h2>
                          <p style={{ margin: '5px 0 0', fontFamily: 'Anuphan, sans-serif', color: '#64748b', fontSize: 13.5 }}>
                            {selectedDoc.description || 'ไม่มีรายละเอียด'}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                          <span style={{
                            borderRadius: 999, padding: '5px 12px',
                            background: selectedMeta.bg, color: selectedMeta.color,
                            fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 800,
                            border: `1.5px solid ${STATUS_BORDER[selectedDoc.status]}55`,
                          }}>{selectedMeta.label}</span>
                          <button
                            onClick={() => { setSelectedId(null); setEditing(false); setLogs([]); setAiResult(null) }}
                            style={{ width: 32, height: 32, borderRadius: 10, border: 'none', background: '#f1f5f9', color: '#64748b', cursor: 'pointer', fontWeight: 700, fontSize: 18 }}
                          >×</button>
                        </div>
                      </div>

                      {/* File + meta chips */}
                      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {selectedFiles.length === 0 && (
                          <span style={{ borderRadius: 999, padding: '6px 12px', background: '#f1f5f9', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>ไม่มีไฟล์แนบ</span>
                        )}
                        {selectedFiles.map((f, i) => (
                          <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{
                            borderRadius: 999, padding: '6px 12px',
                            background: '#ecfdf5', color: '#047857',
                            textDecoration: 'none', fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 600,
                            border: '1px solid #bbf7d0',
                          }}>📎 {f.name}</a>
                        ))}
                        <span style={{ borderRadius: 999, padding: '6px 12px', background: '#f1f5f9', color: '#475569', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>
                          เวอร์ชัน {selectedDoc.version ?? 1}
                        </span>
                        <span style={{ borderRadius: 999, padding: '6px 12px', background: '#f1f5f9', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 12.5 }}>
                          อัปเดต {formatDate(selectedDoc.updated_at)}
                        </span>
                      </div>

                      {/* Inline preview — images and PDFs render directly on the page */}
                      {selectedPreviewFiles.length > 0 && (
                        <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                          {selectedPreviewFiles.map((f, i) => (
                            <div key={i} style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                              {f.kind === 'img' ? (
                                <img src={f.embedUrl} alt={f.name} style={{ width: '100%', display: 'block' }} />
                              ) : (
                                <>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                    <span style={{ fontSize: 14 }}>📄</span>
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 700, color: '#334155' }}>{f.name}</span>
                                    <a href={f.url} target="_blank" rel="noreferrer" style={{ flexShrink: 0, fontSize: 11.5, background: '#0369a1', color: '#fff', borderRadius: 6, padding: '3px 9px', textDecoration: 'none', fontWeight: 700 }}>เปิดเต็มจอ</a>
                                  </div>
                                  <iframe src={f.embedUrl} title={f.name} style={{ width: '100%', height: '65vh', border: 'none', display: 'block' }} />
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Action buttons */}
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                          {canEditSelected && (
                            <button onClick={() => openEditor(selectedDoc)} style={btnGhost('#1d4ed8', '#eff6ff')}>✏️ แก้ไข</button>
                          )}
                          {selectedDoc.status !== 'approved' && selectedDoc.status !== 'cancelled' && (
                            <button disabled={saving} onClick={cancelDoc} style={btnGhost('#c2410c', '#fff7ed')}>⊘ ยกเลิก</button>
                          )}
                          {(selectedDoc.status === 'draft' || selectedDoc.status === 'cancelled' || selectedDoc.status === 'approved') && (
                            <button disabled={saving} onClick={deleteDoc} style={btnGhost('#b91c1c', '#fef2f2')}>🗑 ลบ</button>
                          )}
                          <button onClick={loadLogs} style={btnGhost()}>📋 ประวัติ</button>
                          {selectedDoc.status === 'pending' && (
                            <button disabled={linkLoading} onClick={loadApprovalLinks} style={btnGhost('#047857', '#ecfdf5')}>
                              🔗 ลิงก์อนุมัติ
                            </button>
                          )}
                          <button
                            disabled={aiLoading}
                            onClick={analyzeWithAI}
                            style={btnGhost('#6d28d9', '#f5f3ff')}
                          >
                            {aiLoading ? '🤖 กำลังวิเคราะห์...' : '🤖 วิเคราะห์ด้วย AI'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── AI ANALYSIS RESULT ── */}
                  {(aiLoading || aiResult) && (
                    <div style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid #ddd6fe', overflow: 'hidden' }}>
                      {/* Header */}
                      <div style={{
                        height: 4, background: 'linear-gradient(90deg, #7c3aed, #a855f7, #ec4899)',
                      }} />
                      <div style={{ padding: '13px 18px', background: '#faf5ff', borderBottom: '1px solid #ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 800, color: '#6d28d9' }}>🤖 AI วิเคราะห์เอกสาร</span>
                        {aiResult && !aiLoading && (
                          <button onClick={() => setAiResult(null)} style={{ border: 'none', background: 'transparent', color: '#a78bfa', cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>×</button>
                        )}
                      </div>

                      {aiLoading && (
                        <div style={{ padding: '24px 18px', textAlign: 'center', fontFamily: 'Anuphan, sans-serif', color: '#7c3aed', fontSize: 13.5 }}>
                          <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
                          กำลังวิเคราะห์เอกสาร...
                        </div>
                      )}

                      {aiResult && !aiLoading && (
                        <div style={{ padding: 18, display: 'grid', gap: 12 }}>
                          {aiResult.error ? (
                            <div style={{ color: '#b91c1c', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5 }}>
                              ⚠️ {aiResult.error}
                            </div>
                          ) : (
                            <>
                              {/* Recommendation badge */}
                              {aiResult.recommendation && (() => {
                                const recMap: Record<string, { label: string; color: string; bg: string; icon: string }> = {
                                  approve:  { label: 'แนะนำ: อนุมัติ',   color: '#047857', bg: '#ecfdf5', icon: '✅' },
                                  revise:   { label: 'แนะนำ: ขอแก้ไข',  color: '#b91c1c', bg: '#fef2f2', icon: '↩️' },
                                  pending:  { label: 'แนะนำ: รอดูก่อน', color: '#b45309', bg: '#fffbeb', icon: '⏳' },
                                }
                                const rec = recMap[aiResult.recommendation] ?? { label: aiResult.recommendation, color: '#475569', bg: '#f1f5f9', icon: '🔍' }
                                const riskMap: Record<string, { label: string; color: string }> = {
                                  low:    { label: 'ความเสี่ยง: ต่ำ',   color: '#047857' },
                                  medium: { label: 'ความเสี่ยง: ปานกลาง', color: '#b45309' },
                                  high:   { label: 'ความเสี่ยง: สูง',   color: '#b91c1c' },
                                }
                                const risk = aiResult.risk_level ? (riskMap[aiResult.risk_level] ?? { label: aiResult.risk_level, color: '#475569' }) : null
                                return (
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{
                                      borderRadius: 999, padding: '6px 14px',
                                      background: rec.bg, color: rec.color,
                                      fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 800,
                                      border: `1.5px solid ${rec.color}33`,
                                    }}>{rec.icon} {rec.label}</span>
                                    {risk && (
                                      <span style={{
                                        borderRadius: 999, padding: '6px 12px',
                                        background: '#f8fafc', color: risk.color,
                                        fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 700,
                                        border: `1.5px solid ${risk.color}33`,
                                      }}>⚠️ {risk.label}</span>
                                    )}
                                    {aiResult.confidence != null && (
                                      <span style={{
                                        borderRadius: 999, padding: '6px 12px',
                                        background: '#f5f3ff', color: '#6d28d9',
                                        fontFamily: 'Anuphan, sans-serif', fontSize: 12.5, fontWeight: 600,
                                      }}>
                                        ความมั่นใจ {Math.round((aiResult.confidence ?? 0) * 100)}%
                                      </span>
                                    )}
                                  </div>
                                )
                              })()}

                              {/* Summary */}
                              {aiResult.summary && (
                                <div style={{ background: '#faf5ff', borderRadius: 12, padding: '12px 14px', border: '1px solid #ede9fe' }}>
                                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>สรุปเนื้อหา</div>
                                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#1e293b', lineHeight: 1.6 }}>{aiResult.summary}</div>
                                </div>
                              )}

                              {/* Reason */}
                              {aiResult.reason && (
                                <div style={{ background: '#f8fafc', borderRadius: 12, padding: '12px 14px', border: '1px solid #e4e8f2' }}>
                                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>เหตุผล</div>
                                  <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, color: '#334155', lineHeight: 1.6 }}>{aiResult.reason}</div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── NEW VERSION ── */}
                  {canEdit && (selectedDoc.status === 'draft' || selectedDoc.status === 'revision_requested') && (
                    <div style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid #e4e8f2', overflow: 'hidden' }}>
                      <div style={{ padding: '12px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 700, color: '#92400e' }}>
                        📤 อัปโหลดเวอร์ชันใหม่
                      </div>
                      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <input value={versionFileName} onChange={e => setVersionFileName(e.target.value)} placeholder="ชื่อไฟล์" style={inputStyle} />
                        <input value={versionFileUrl} onChange={e => setVersionFileUrl(e.target.value)} placeholder="ลิงก์ไฟล์ (URL)" style={inputStyle} />
                        <input value={versionNote} onChange={e => setVersionNote(e.target.value)} placeholder="บันทึกการเปลี่ยนแปลง" style={{ ...inputStyle, gridColumn: '1 / -1' }} />
                        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                          <button disabled={saving} onClick={uploadNewVersion} style={btnPrimary}>
                            {saving ? 'กำลังบันทึก...' : '✓ บันทึกเวอร์ชันใหม่'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── APPROVAL LINKS ── */}
                  {links.length > 0 && (
                    <div style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid #e4e8f2', overflow: 'hidden' }}>
                      <div style={{ padding: '12px 18px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 700, color: '#047857' }}>
                        🔗 ลิงก์อนุมัติสาธารณะ
                      </div>
                      {links.map(link => (
                        <div key={link.approverId} style={{ padding: '12px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 14, fontWeight: 600 }}>{link.name}</div>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {link.email}
                            </div>
                          </div>
                          <button
                            onClick={() => copyApprovalLink(link)}
                            style={btnGhost(copiedLink === link.approverId ? '#047857' : '#1d4ed8', copiedLink === link.approverId ? '#ecfdf5' : '#eff6ff')}
                          >
                            {copiedLink === link.approverId ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── APPROVAL CHAIN ── */}
                  <div style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid #e4e8f2', overflow: 'hidden' }}>
                    <div style={{ padding: '13px 18px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2', fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 800, color: '#1e293b' }}>
                      สายอนุมัติ
                    </div>
                    <div style={{ padding: '14px 18px', display: 'grid', gap: 0 }}>
                      {(selectedDoc.approval_approvers ?? []).map((approver, index, arr) => {
                        const isNext = nextApprover?.id === approver.id
                        const isApproved = approver.status === 'approved'
                        const isRevision = approver.status === 'revision_requested'
                        const dotColor = isApproved ? '#10b981' : isRevision ? '#ef4444' : isNext ? '#f59e0b' : '#cbd5e1'
                        const labelColor = isApproved ? '#047857' : isRevision ? '#b91c1c' : isNext ? '#b45309' : '#64748b'
                        const labelBg = isApproved ? '#ecfdf5' : isRevision ? '#fef2f2' : isNext ? '#fffbeb' : '#f1f5f9'
                        const labelText = isApproved ? '✓ อนุมัติ' : isRevision ? '↩ ขอแก้ไข' : isNext ? '⌛ รอคนนี้' : 'รอ'
                        const isLast = index === arr.length - 1
                        return (
                          <div key={approver.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                            {/* Timeline dot + line */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                              <div style={{
                                width: 32, height: 32, borderRadius: 999,
                                background: dotColor, color: '#fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 700,
                                boxShadow: `0 2px 8px ${dotColor}55`,
                                flexShrink: 0,
                              }}>
                                {isApproved ? '✓' : isRevision ? '!' : index + 1}
                              </div>
                              {!isLast && <div style={{ width: 2, flex: 1, minHeight: 20, background: '#e2e8f0', margin: '4px 0' }} />}
                            </div>
                            {/* Approver info */}
                            <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                                <div>
                                  <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#0f172a', fontSize: 14, fontWeight: 600 }}>{approver.approver_name}</div>
                                  <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#94a3b8', fontSize: 12.5 }}>{approver.approver_email}</div>
                                  {approver.note && (
                                    <div style={{ marginTop: 4, fontFamily: 'Anuphan, sans-serif', color: '#64748b', fontSize: 12.5, background: '#f8fafc', borderRadius: 8, padding: '5px 10px', borderLeft: `3px solid ${dotColor}` }}>
                                      {approver.note}
                                    </div>
                                  )}
                                </div>
                                <span style={{
                                  flexShrink: 0, borderRadius: 999, padding: '4px 10px',
                                  background: labelBg, color: labelColor,
                                  fontFamily: 'Anuphan, sans-serif', fontSize: 12, fontWeight: 700,
                                }}>{labelText}</span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {!(selectedDoc.approval_approvers ?? []).length && (
                        <div style={{ padding: '12px 0', color: '#94a3b8', fontFamily: 'Anuphan, sans-serif', fontSize: 13 }}>ยังไม่มีผู้อนุมัติในสายนี้</div>
                      )}
                    </div>

                    {/* Action area */}
                    {canEdit && selectedDoc.status === 'pending' && nextApprover && (
                      <div style={{ padding: '14px 18px', borderTop: '1px solid #e4e8f2', background: '#fffbeb' }}>
                        <div style={{ fontFamily: 'Anuphan, sans-serif', fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 10 }}>
                          ⌛ รอการตัดสินใจ: {nextApprover.approver_name}
                        </div>
                        <textarea
                          value={actionNote}
                          onChange={e => setActionNote(e.target.value)}
                          placeholder="หมายเหตุ (ไม่บังคับ)"
                          rows={2}
                          style={{ ...inputStyle, marginBottom: 10 }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                          <button disabled={saving} onClick={() => actOnApprover(nextApprover, 'revision_requested')} style={btnGhost('#b91c1c', '#fef2f2')}>
                            ↩ ขอแก้ไข
                          </button>
                          <button disabled={saving} onClick={() => actOnApprover(nextApprover, 'approved')} style={{ ...btnPrimary, background: '#047857' }}>
                            ✓ อนุมัติ
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── LOGS ── */}
                  {logs.length > 0 && (
                    <div style={{ borderRadius: 18, background: '#fff', boxShadow: SHADOW, border: '1px solid #e4e8f2', overflow: 'hidden' }}>
                      <div style={{ padding: '13px 18px', background: '#f8fafc', borderBottom: '1px solid #e4e8f2', fontFamily: 'Anuphan, sans-serif', fontSize: 13.5, fontWeight: 700, color: '#1e293b' }}>
                        📋 ประวัติการดำเนินการ
                      </div>
                      {logs.map((log, idx) => (
                        <div key={log.id} style={{
                          padding: '12px 18px',
                          borderBottom: idx < logs.length - 1 ? '1px solid #f1f5f9' : 'none',
                          display: 'flex', gap: 14, alignItems: 'flex-start',
                        }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: 999,
                            background: '#94a3b8', marginTop: 7, flexShrink: 0,
                          }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#1e293b', fontSize: 13.5, fontWeight: 600 }}>
                              {log.detail || log.action}
                            </div>
                            <div style={{ fontFamily: 'Anuphan, sans-serif', color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                              {log.actor_email} · {formatDate(log.created_at)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
