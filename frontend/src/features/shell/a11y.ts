import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * FE-13 键盘可达:给 role=button / role=treeitem 等非原生控件补 Enter/Space 激活。
 * 返回一个 onKeyDown 处理器,按下 Enter 或 Space 时 preventDefault 并执行 handler
 * (Space 默认会滚动页面,必须拦下)。
 */
export function activateOnKey(handler: () => void) {
  return (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      handler()
    }
  }
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * FE-13 模态对话框 a11y:统一提供
 *  · Esc 关闭
 *  · Tab / Shift+Tab 焦点回环(focus trap,不逃出对话框)
 *  · 打开时把焦点移入(data-autofocus 优先,否则首个可聚焦元素,再否则容器)
 *  · 关闭 / 卸载后把焦点还给打开前持有焦点的元素
 *
 * 用法:把返回的 ref 挂到对话框容器(role=dialog、tabIndex=-1)。当组件在关闭时
 * 直接卸载(条件渲染 null)——本 hook 的 cleanup 即完成焦点恢复。
 */
export function useDialogA11y(onClose: () => void, active = true) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!active) return
    const node = ref.current
    const prevFocus = document.activeElement as HTMLElement | null
    const list = () => (node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)) : [])
    const initial = node?.querySelector<HTMLElement>('[data-autofocus]') ?? list()[0] ?? node
    initial?.focus?.()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const f = list()
      if (f.length === 0) {
        e.preventDefault()
        node?.focus?.()
        return
      }
      const first = f[0]
      const last = f[f.length - 1]
      const act = document.activeElement
      if (e.shiftKey && (act === first || act === node)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && act === last) {
        e.preventDefault()
        first.focus()
      }
    }
    node?.addEventListener('keydown', onKey)
    return () => {
      node?.removeEventListener('keydown', onKey)
      prevFocus?.focus?.()
    }
    // active 变化即重挂;onClose 走 ref 不进依赖,避免每次渲染重挂丢焦点
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  return ref
}
