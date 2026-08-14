/**
 * 同步按钮组件：composer 工具行里的常驻控件。
 * 纯展示：动作经 props.sync 注入，状态为组件内局部 state（无外部订阅）。
 */
import { useRef, useState, type MutableRefObject, type ReactElement } from 'react'
import type { SyncActions } from './index.ts'

/** 结果提示的自动隐藏延迟。 */
const RESULT_HIDE_MS = 6000

/** 内联样式：复用 dsh 全局 CSS 变量（--dsw-*），失败时回退字面值。 */
const styles = {
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    height: '24px',
    padding: '0 8px',
    border: '1px solid var(--dsw-border-subtle, #e0e0e0)',
    borderRadius: '6px',
    background: 'var(--dsw-surface-subtle, transparent)',
    color: 'var(--dsw-text-secondary, #666)',
    fontSize: '12px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  } as const,
  busy: { opacity: 0.6, cursor: 'progress' } as const,
  result: {
    maxWidth: '260px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '12px',
  } as const,
  ok: { color: 'var(--dsw-text-success, #2e7d32)' } as const,
  error: { color: 'var(--dsw-text-danger, #c62828)' } as const,
}

/** 等待几秒后清除结果提示。 */
function scheduleClear(timer: MutableRefObject<number | undefined>, set: (v: string | undefined) => void): void {
  if (timer.current !== undefined) window.clearTimeout(timer.current)
  timer.current = window.setTimeout(() => {
    set(undefined)
    timer.current = undefined
  }, RESULT_HIDE_MS)
}

/**
 * 同步按钮。
 * @param props.sync - 由注册处 inject 注入的同步动作。
 */
export function SyncButton({ sync }: SyncActions): ReactElement {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | undefined>(undefined)
  const timer = useRef<number | undefined>(undefined)

  const onClick = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setResult(undefined)
    try {
      const outcome = await sync()
      setResult(outcome)
      scheduleClear(timer, () => setResult(undefined))
    } catch {
      setResult({ ok: false, text: '同步失败' })
      scheduleClear(timer, () => setResult(undefined))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <button
        type="button"
        title="同步 pi / opencode 的历史会话、agents、skills（/import-all）"
        style={{ ...styles.button, ...(busy ? styles.busy : {}) }}
        onClick={() => void onClick()}
        disabled={busy}
      >
        {busy ? '同步中…' : '同步'}
      </button>
      {result !== undefined && (
        <span style={{ ...styles.result, ...(result.ok ? styles.ok : styles.error) }}>{result.text}</span>
      )}
    </span>
  )
}
