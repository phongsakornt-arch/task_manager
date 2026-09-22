import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

type PublicDocument = {
  id: string; title: string; description?: string | null
  file_url?: string | null; file_name?: string | null
  version?: number | null; status: string; updated_at?: string | null
}
type PublicApprover = {
  id: string; name: string; email: string; status: string
  actedAt?: string | null; note?: string | null; isCurrent: boolean
}
type ChainApprover = {
  id: string; order_no: number; approver_name: string
  approver_email: string; status: string; acted_at?: string | null; note?: string | null
}
type PublicApprovalData = {
  success: boolean; document: PublicDocument
  approver: PublicApprover; chain: ChainApprover[]; canAct: boolean
}

function fmtDate(v?: string | null) {
  if (!v) return '-'
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v))
}
function parseFiles(url?: string | null, name?: string | null) {
  if (!url) return [] as { name: string; url: string }[]
  try { const p = JSON.parse(url); if (Array.isArray(p)) return p as { name: string; url: string }[] } catch { /* ignore */ }
  return [{ name: name || 'เอกสาร', url }]
}
function isImg(url: string) { return /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url) }
function isPdf(url: string) { return /\.pdf(\?.*)?$/i.test(url) }
// Google Drive share links (e.g. /file/d/ID/view or open?id=ID) don't carry a
// file extension, so isImg/isPdf can't detect them — use Drive's own
// embeddable preview URL instead, which renders PDFs/images/docs inline.
function driveEmbedUrl(url: string): string | null {
  const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/)
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : null
}

const NAVY = '#1a2744'
const GOLD = '#c9a84c'

export default function ApprovalPublicPage() {
  const [params] = useSearchParams()
  const approvalId = params.get('approvalId') ?? ''
  const approverId = params.get('approverId') ?? ''
  const token      = params.get('token') ?? ''

  const [data, setData]         = useState<PublicApprovalData | null>(null)
  const [note, setNote]         = useState('')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [done, setDone]         = useState<'approved' | 'revision_requested' | null>(null)

  const actionRef = useRef<HTMLDivElement>(null)
  const missing = useMemo(() => !approvalId || !approverId || !token, [approvalId, approverId, token])

  const loadData = useCallback(async () => {
    setLoading(true); setError(null)
    if (missing) { setError('ลิงก์ไม่ครบถ้วน'); setLoading(false); return }
    const { data: r, error: e } = await supabase.functions.invoke<PublicApprovalData>('approval-public-data', {
      body: { approvalId, approverId, token },
    })
    if (e || !r?.success) { setError(e?.message ?? 'โหลดเอกสารไม่ได้ ลิงก์อาจหมดอายุ'); setData(null) }
    else setData(r)
    setLoading(false)
  }, [approvalId, approverId, missing, token])

  // Standard fetch-on-mount pattern; loadData sets loading/error state internally.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [loadData])

  const submit = async (action: 'approved' | 'revision_requested') => {
    if (saving || !data?.canAct) return
    setSaving(true); setError(null)
    const { data: r, error: e } = await supabase.functions.invoke('approval-public-action', {
      body: { approvalId, approverId, token, action, note: note.trim() || null },
    })
    if (e || !r) { setError(e?.message ?? 'บันทึกไม่สำเร็จ'); setSaving(false); return }
    setDone(action); setNote(''); setSaving(false)
    await loadData()
  }

  const files = parseFiles(data?.document.file_url, data?.document.file_name)
  const previewFiles = files
    .map(f => {
      const drive = driveEmbedUrl(f.url)
      if (drive) return { ...f, kind: 'embed' as const, embedUrl: drive }
      if (isImg(f.url)) return { ...f, kind: 'img' as const, embedUrl: f.url }
      if (isPdf(f.url)) return { ...f, kind: 'embed' as const, embedUrl: f.url }
      return null
    })
    .filter((f): f is { name: string; url: string; kind: 'img' | 'embed'; embedUrl: string } => f !== null)
  const approved = (data?.chain ?? []).filter(a => a.status === 'approved').length
  const total    = data?.chain.length ?? 0

  return (
    <div style={{ minHeight: '100vh', background: '#eef2f7', fontFamily: 'Anuphan, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* HEADER */}
      <header style={{ background: `linear-gradient(135deg, ${NAVY} 0%, #1e3a6e 100%)`, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, boxShadow: '0 3px 16px rgba(0,0,0,0.3)' }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: 'rgba(201,168,76,0.15)', border: `2px solid ${GOLD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: GOLD, flexShrink: 0 }}>✓</div>
        <div>
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 800 }}>ระบบอนุมัติเอกสาร</div>
          <div style={{ color: GOLD, fontSize: 12.5, fontWeight: 600, letterSpacing: '0.03em' }}>หอการค้าไทย · YEC</div>
        </div>
      </header>

      {/* SCROLLABLE CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 24px' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'grid', gap: 14 }}>

          {/* LOADING */}
          {loading && (
            <div style={{ background: '#fff', borderRadius: 16, padding: 40, textAlign: 'center', color: '#94a3b8', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
              กำลังโหลดเอกสาร...
            </div>
          )}

          {/* ERROR */}
          {!loading && error && (
            <div style={{ background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#b91c1c', marginBottom: 6 }}>เปิดลิงก์ไม่ได้</div>
              <div style={{ color: '#64748b', fontSize: 14 }}>{error}</div>
            </div>
          )}

          {/* SUCCESS BANNER */}
          {done && (
            <div style={{
              borderRadius: 14, padding: '14px 18px', fontWeight: 700, fontSize: 15, textAlign: 'center',
              background: done === 'approved' ? '#ecfdf5' : '#fffbeb',
              color: done === 'approved' ? '#047857' : '#b45309',
              border: `1.5px solid ${done === 'approved' ? '#bbf7d0' : '#fde68a'}`,
            }}>
              {done === 'approved' ? '✅ อนุมัติเอกสารเรียบร้อยแล้ว' : '✏️ ส่งคำขอแก้ไขเรียบร้อยแล้ว'}
            </div>
          )}

          {!loading && data && (
            <>
              {/* DOC INFO */}
              <div style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
                <div style={{ height: 5, background: `linear-gradient(90deg, ${NAVY}, #2d4a8a, ${GOLD})` }} />
                <div style={{ padding: '18px 20px 20px' }}>
                  <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#0f172a', lineHeight: 1.4 }}>{data.document.title}</h1>
                  {data.document.description && <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: 14, lineHeight: 1.65 }}>{data.document.description}</p>}

                  {/* Status + version row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: files.length ? 14 : 0 }}>
                    <span style={{
                      borderRadius: 999, padding: '5px 13px', fontWeight: 700, fontSize: 13,
                      background: data.document.status === 'approved' ? '#ecfdf5' : '#fef3c7',
                      color: data.document.status === 'approved' ? '#047857' : '#92400e',
                      border: `1.5px solid ${data.document.status === 'approved' ? '#86efac' : '#fde68a'}`,
                    }}>
                      {data.document.status === 'approved' ? '✅ อนุมัติแล้ว' : `⏳ รออนุมัติ ${approved}/${total}`}
                    </span>
                    <span style={{ borderRadius: 999, padding: '5px 11px', background: '#f1f5f9', color: '#64748b', fontSize: 13 }}>v{data.document.version ?? 1}</span>
                  </div>

                  {/* File downloads — compact list */}
                  {files.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {files.map((f, i) => (
                        <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          borderRadius: 12, padding: '10px 14px',
                          background: '#f0f9ff', border: '1.5px solid #bae6fd',
                          color: '#0369a1', textDecoration: 'none', fontSize: 13.5, fontWeight: 600,
                        }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                          <span style={{ flexShrink: 0, fontSize: 12, background: '#0369a1', color: '#fff', borderRadius: 6, padding: '2px 8px' }}>เปิด</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* DOCUMENT PREVIEW — images render directly, PDFs/Drive files embed inline so nothing needs a click */}
              {previewFiles.map((f, i) => (
                <div key={i} style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.1)', background: '#fff' }}>
                  {f.kind === 'img' ? (
                    <img src={f.embedUrl} alt={f.name} style={{ width: '100%', display: 'block' }} />
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <span style={{ fontSize: 15 }}>📄</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, color: '#334155' }}>{f.name}</span>
                        <a href={f.url} target="_blank" rel="noreferrer" style={{ flexShrink: 0, fontSize: 12, background: '#0369a1', color: '#fff', borderRadius: 6, padding: '3px 10px', textDecoration: 'none', fontWeight: 700 }}>เปิดเต็มจอ</a>
                      </div>
                      <iframe src={f.embedUrl} title={f.name} style={{ width: '100%', height: '75vh', border: 'none', display: 'block' }} />
                    </>
                  )}
                </div>
              ))}

              {/* APPROVAL CHAIN + ACTION — single card */}
              <div ref={actionRef} style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
                <div style={{ padding: '13px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 17 }}>🏅</span>
                  <span style={{ fontWeight: 800, fontSize: 15, color: '#1e293b' }}>สายการอนุมัติ</span>
                </div>
                <div style={{ padding: '16px 18px', display: 'grid', gap: 0 }}>
                  {data.chain.map((ap, idx, arr) => {
                    const ok   = ap.status === 'approved'
                    const rev  = ap.status === 'revision_requested'
                    const isMe = ap.id === data.approver.id
                    const curr = isMe && data.approver.isCurrent
                    const last = idx === arr.length - 1

                    const dotBg = ok ? '#10b981' : curr ? '#3b82f6' : '#cbd5e1'
                    const tagBg = ok ? '#dcfce7' : rev ? '#fee2e2' : curr ? '#dbeafe' : '#f1f5f9'
                    const tagFg = ok ? '#166534' : rev ? '#991b1b' : curr ? '#1e40af' : '#94a3b8'
                    const tag   = ok ? 'อนุมัติแล้ว' : rev ? 'ขอแก้ไข' : curr ? 'รอการอนุมัติ' : 'รอ'

                    return (
                      <div key={ap.id} style={{ display: 'flex', gap: 14 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 999, background: dotBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, boxShadow: `0 2px 8px ${dotBg}55`, flexShrink: 0 }}>
                            {ok ? '✓' : idx + 1}
                          </div>
                          {!last && <div style={{ width: 2, flex: 1, minHeight: 18, background: '#e2e8f0', margin: '3px 0' }} />}
                        </div>
                        <div style={{ flex: 1, paddingBottom: last ? 0 : 16, paddingTop: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{ap.approver_name}</div>
                              <div style={{ color: '#94a3b8', fontSize: 12 }}>{ap.approver_email}</div>
                              {ok && ap.acted_at && <div style={{ color: '#94a3b8', fontSize: 11.5, marginTop: 1 }}>{fmtDate(ap.acted_at)}</div>}
                              {ap.note && <div style={{ marginTop: 4, padding: '4px 10px', background: '#f8fafc', borderLeft: `3px solid ${dotBg}`, borderRadius: '0 8px 8px 0', color: '#475569', fontSize: 12 }}>{ap.note}</div>}
                            </div>
                            <span style={{ borderRadius: 999, padding: '3px 11px', fontWeight: 700, fontSize: 11.5, background: tagBg, color: tagFg, flexShrink: 0 }}>{tag}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* ACTION SECTION — ต่อท้ายสายอนุมัติ */}
                {data.canAct && !done && (
                  <div style={{ borderTop: '1.5px dashed #e2e8f0', margin: '0 18px', padding: '14px 0 18px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#64748b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>💬</span> ความคิดเห็น / หมายเหตุ
                      <span style={{ fontWeight: 400, color: '#94a3b8' }}>(ไม่บังคับ)</span>
                    </div>
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="พิมพ์เหตุผลหรือข้อสังเกต..."
                      rows={2}
                      style={{
                        width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                        borderRadius: 10, border: '1.5px solid #e2e8f0',
                        fontFamily: 'Anuphan, sans-serif', fontSize: 13.5,
                        resize: 'none', outline: 'none', lineHeight: 1.6,
                        color: '#1e293b', background: '#f8fafc',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#fff' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc' }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button
                        disabled={saving}
                        onClick={() => submit('approved')}
                        style={{
                          flex: 1, border: 'none', borderRadius: 11,
                          padding: '11px 0', cursor: saving ? 'wait' : 'pointer',
                          background: saving ? '#6ee7b7' : 'linear-gradient(135deg,#059669,#047857)',
                          color: '#fff', fontFamily: 'Anuphan, sans-serif',
                          fontSize: 14, fontWeight: 800,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          boxShadow: '0 2px 8px rgba(5,150,105,0.30)',
                          transition: 'opacity 0.15s, transform 0.1s',
                        }}
                        onMouseEnter={e => { if (!saving) { e.currentTarget.style.opacity = '0.87'; e.currentTarget.style.transform = 'translateY(-1px)' } }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}
                      >
                        ✅ อนุมัติเอกสาร
                      </button>
                      <button
                        disabled={saving}
                        onClick={() => submit('revision_requested')}
                        style={{
                          flex: 1, borderRadius: 11, border: '1.5px solid #f59e0b',
                          padding: '11px 0', cursor: saving ? 'wait' : 'pointer',
                          background: '#fffbeb', color: '#92400e',
                          fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 800,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          transition: 'opacity 0.15s, transform 0.1s, background 0.15s',
                        }}
                        onMouseEnter={e => { if (!saving) { e.currentTarget.style.background = '#fef3c7'; e.currentTarget.style.transform = 'translateY(-1px)' } }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#fffbeb'; e.currentTarget.style.transform = 'translateY(0)' }}
                      >
                        ✏️ ขอแก้ไข
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* FOOTER */}
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, paddingTop: 4, paddingBottom: 8 }}>
                ระบบอนุมัติเอกสาร · หอการค้าไทย YEC
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  )
}
