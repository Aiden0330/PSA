import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 自定义兜底 UI;缺省给出「模块加载失败 + 重试」。 */
  fallback?: (reset: () => void, error: Error) => ReactNode
}
interface State { error: Error | null }

/**
 * FE-13 / 审查 §4:App 级懒页与懒加载弹窗的错误边界。chunk 加载失败(网络中断 / 离线 /
 * 版本漂移)或子树渲染抛错时,给出可见文案 + 重试,绝不留白屏、绝不永久停在加载态。
 * 失败照实 console.error(监管工具:错误必须可见,不吞静默)。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (error) {
      if (this.props.fallback) return this.props.fallback(this.reset, error)
      return (
        <div role="alert" style={fallbackBox}>
          <div style={{ fontWeight: 700 }}>模块加载失败</div>
          <div style={{ color: 'var(--psa-muted)', fontSize: 12, maxWidth: 360, textAlign: 'center', lineHeight: 1.6 }}>
            该页面模块未能加载(可能是网络中断或离线)。请点「重试」重新加载;若持续失败,请刷新页面。
          </div>
          <button type="button" className="psa-btn" onClick={this.reset}>重试</button>
        </div>
      )
    }
    return this.props.children
  }
}

const fallbackBox = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 24,
  background: '#fff',
  color: 'var(--psa-danger-strong)',
  fontSize: 13,
}
