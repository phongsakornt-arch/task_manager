import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logActivity } from '../lib/activityLog'
import { useAuthStore } from '../stores/authStore'
import { useTaskStore } from '../stores/taskStore'
import type { Section } from '../types'

const FONT = 'Anuphan, sans-serif'
const NAVY = '#1a2744'

type ChatRole = 'system' | 'user' | 'assistant' | 'tool'
type ChatMessage = {
  role: ChatRole
  content: string | null
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}
type ProposedCreateTask = {
  type: 'create_task'
  payload: {
    title?: string
    description?: string
    section_id?: string
    start_date?: string
    end_date?: string
    start_time?: string
    end_time?: string
  }
}

export default function AIAssistant() {
  const { user } = useAuthStore()
  const { addTask } = useTaskStore()
  const [sections, setSections] = useState<Section[]>([])
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [proposed, setProposed] = useState<ProposedCreateTask | null>(null)
  const [creating, setCreating] = useState(false)
  const [createdMessage, setCreatedMessage] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [history, proposed])

  useEffect(() => {
    if (!user) return
    // ไม่พึ่ง sections จาก taskStore กลาง เพราะหน้าอื่นที่ยังไม่เคยเข้า Board/Annual จะยังไม่ได้โหลดไว้
    supabase.from('sections').select('*').then(({ data }) => { if (data) setSections(data as Section[]) })
  }, [user])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setError('')
    setCreatedMessage('')
    const nextHistory: ChatMessage[] = [...history, { role: 'user', content: text }]
    setHistory(nextHistory)
    setBusy(true)

    const { data, error: invokeError } = await supabase.functions.invoke<{
      success: boolean; reply: string; messages: ChatMessage[]
      proposedAction: ProposedCreateTask | null; error?: string
    }>('ai-assistant', { body: { messages: nextHistory } })

    setBusy(false)
    if (invokeError || !data?.success) {
      setError(data?.error ?? invokeError?.message ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง')
      return
    }
    setHistory(data.messages)
    setProposed(data.proposedAction)
  }

  const confirmCreateTask = async () => {
    if (!proposed || !user || creating) return
    setCreating(true)
    setError('')
    const p = proposed.payload
    const sectionId = (p.section_id && sections.some(s => s.id === p.section_id)) ? p.section_id : sections[0]?.id
    if (!sectionId) {
      setError('ไม่มี Section ในระบบให้สร้างงาน')
      setCreating(false)
      return
    }
    const { data, error: insertError } = await supabase
      .from('tasks')
      .insert({
        section_id: sectionId,
        title: (p.title ?? 'งานใหม่').trim(),
        description: p.description?.trim() || null,
        start_date: p.start_date || null,
        end_date: p.end_date || null,
        start_time: p.start_time || null,
        end_time: p.end_time || null,
        completed: false,
        deleted: false,
        created_by: user.id,
        tags: [],
      })
      .select('*, sections(*), task_types(*)')
      .single()
    setCreating(false)
    if (insertError || !data) {
      setError(insertError?.message ?? 'สร้างงานไม่สำเร็จ')
      return
    }
    addTask(data)
    await logActivity(user, 'task.created', `Created task: ${data.title}`, { task_id: data.id, source: 'ai-assistant' })
    setCreatedMessage(`✅ สร้างงาน "${data.title}" แล้ว`)
    setProposed(null)
  }

  if (!user) return null

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 900,
          width: 56, height: 56, borderRadius: '50%', border: 'none',
          background: `linear-gradient(135deg, ${NAVY}, #2d4a8a)`, color: '#c9a84c',
          boxShadow: '0 10px 28px rgba(26,39,68,0.4)', cursor: 'pointer', fontSize: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="AI ผู้ช่วย"
      >
        {open ? '✕' : '💬'}
      </button>

      {open && (
        <div
          style={{
            position: 'fixed', bottom: 88, right: 20, zIndex: 900,
            width: 'min(380px, calc(100vw - 32px))', height: 'min(560px, calc(100vh - 140px))',
            background: '#fff', borderRadius: 20, boxShadow: '0 24px 64px rgba(15,23,42,0.3)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <div style={{ background: `linear-gradient(135deg, ${NAVY}, #2d4a8a)`, padding: '14px 18px', flexShrink: 0 }}>
            <div style={{ color: '#fff', fontFamily: FONT, fontWeight: 800, fontSize: 14 }}>💬 AI ผู้ช่วย</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontFamily: FONT, fontSize: 11.5, marginTop: 2 }}>
              ค้นหา/สรุปงานได้ทันที — สร้างงานใหม่ต้องกดยืนยันก่อนเสมอ
            </div>
          </div>

          <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'grid', gap: 10, alignContent: 'start' }}>
            {history.length === 0 && (
              <div style={{ color: '#94a3b8', fontFamily: FONT, fontSize: 13, textAlign: 'center', padding: '20px 8px' }}>
                ลองพิมพ์ เช่น "หางานที่เกี่ยวกับประชุมงบ" หรือ "สร้างงานประชุมทีมวันศุกร์นี้"
              </div>
            )}
            {history.filter(m => m.role === 'user' || m.role === 'assistant').map((m, i) => (
              m.content ? (
                <div
                  key={i}
                  style={{
                    justifySelf: m.role === 'user' ? 'end' : 'start',
                    maxWidth: '85%', padding: '9px 13px', borderRadius: 14,
                    background: m.role === 'user' ? NAVY : '#f1f5f9',
                    color: m.role === 'user' ? '#fff' : '#1e293b',
                    fontFamily: FONT, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                  }}
                >
                  {m.content}
                </div>
              ) : null
            ))}

            {proposed && (
              <div style={{ justifySelf: 'start', maxWidth: '92%', border: '1.5px solid #c9a84c', borderRadius: 14, padding: 12, background: '#fffbeb' }}>
                <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 12.5, color: '#92400e', marginBottom: 6 }}>📋 ข้อเสนอสร้างงานใหม่</div>
                <div style={{ fontFamily: FONT, fontSize: 13.5, color: '#1e293b', fontWeight: 700 }}>{proposed.payload.title}</div>
                {proposed.payload.description && <div style={{ fontFamily: FONT, fontSize: 12.5, color: '#64748b', marginTop: 3 }}>{proposed.payload.description}</div>}
                {(proposed.payload.start_date || proposed.payload.end_date) && (
                  <div style={{ fontFamily: FONT, fontSize: 12, color: '#64748b', marginTop: 3 }}>
                    📅 {proposed.payload.start_date ?? '-'}{proposed.payload.end_date && proposed.payload.end_date !== proposed.payload.start_date ? ` - ${proposed.payload.end_date}` : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    onClick={confirmCreateTask}
                    disabled={creating}
                    style={{ flex: 1, border: 'none', borderRadius: 10, padding: '8px 10px', background: '#1a2744', color: '#fff', fontFamily: FONT, fontWeight: 700, fontSize: 12.5, cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.6 : 1 }}
                  >
                    {creating ? 'กำลังสร้าง...' : '✅ ยืนยันสร้างงาน'}
                  </button>
                  <button
                    onClick={() => setProposed(null)}
                    disabled={creating}
                    style={{ border: '1px solid #e4e8f2', borderRadius: 10, padding: '8px 12px', background: '#fff', color: '#64748b', fontFamily: FONT, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}

            {createdMessage && (
              <div style={{ justifySelf: 'center', padding: '6px 12px', borderRadius: 999, background: '#ecfdf5', color: '#047857', fontFamily: FONT, fontSize: 12, fontWeight: 700 }}>
                {createdMessage}
              </div>
            )}
            {busy && <div style={{ justifySelf: 'start', color: '#94a3b8', fontFamily: FONT, fontSize: 13 }}>กำลังคิด...</div>}
            {error && <div style={{ justifySelf: 'center', color: '#b91c1c', fontFamily: FONT, fontSize: 12.5, textAlign: 'center' }}>{error}</div>}
          </div>

          <div style={{ flexShrink: 0, borderTop: '1px solid #f1f5f9', padding: 10, display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="พิมพ์ข้อความ..."
              disabled={busy}
              style={{ flex: 1, minWidth: 0, height: 42, padding: '0 12px', borderRadius: 12, border: '1.5px solid #e4e8f2', outline: 'none', fontFamily: FONT, fontSize: 13.5 }}
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              style={{ flexShrink: 0, width: 42, height: 42, borderRadius: 12, border: 'none', background: input.trim() ? NAVY : '#cbd5e1', color: '#fff', cursor: input.trim() ? 'pointer' : 'default', fontSize: 16 }}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  )
}
