import { useToastStore } from '../stores/toastStore'

export default function ToastHost() {
  const { toasts, dismiss } = useToastStore()
  if (!toasts.length) return null

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 2000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        width: 'min(440px, calc(100vw - 32px))', pointerEvents: 'none',
      }}
    >
      {toasts.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          style={{
            pointerEvents: 'auto', width: '100%', textAlign: 'left', cursor: 'pointer',
            border: `1px solid ${t.kind === 'success' ? '#bbf7d0' : '#fecaca'}`,
            background: t.kind === 'success' ? '#f0fdf4' : '#fef2f2',
            color: t.kind === 'success' ? '#166534' : '#991b1b',
            borderRadius: 14, padding: '11px 16px', boxShadow: '0 12px 32px rgba(15,23,42,0.18)',
            fontFamily: 'Anuphan, sans-serif', fontSize: 14, fontWeight: 700, lineHeight: 1.5,
          }}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}
