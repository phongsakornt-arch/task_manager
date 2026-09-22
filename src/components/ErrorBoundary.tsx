import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo })
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  reset = () => this.setState({ error: null, errorInfo: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: 32,
          background: '#fef2f2',
        }}>
          <div style={{
            maxWidth: 620,
            width: '100%',
            background: '#fff',
            borderRadius: 20,
            border: '1.5px solid #fecaca',
            padding: 28,
            boxShadow: '0 10px 36px rgba(220,38,38,0.10)',
          }}>
            <div style={{ color: '#b91c1c', fontWeight: 900, fontSize: 18, marginBottom: 8, fontFamily: 'Anuphan, sans-serif' }}>
              เกิดข้อผิดพลาด
            </div>
            <div style={{ color: '#475569', fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
              {this.state.error.message}
            </div>
            {this.state.errorInfo?.componentStack && (
              <pre style={{
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 12,
                color: '#7f1d1d',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflow: 'auto',
                marginBottom: 16,
              }}>
                {this.state.errorInfo.componentStack}
              </pre>
            )}
            <button
              onClick={this.reset}
              style={{
                border: 'none',
                borderRadius: 10,
                padding: '10px 20px',
                background: '#1a2744',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 800,
                fontFamily: 'Anuphan, sans-serif',
              }}
            >
              ลองใหม่
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
