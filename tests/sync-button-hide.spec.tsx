/**
 * 结果自动隐藏测试（独立文件：独立 jsdom 环境，避免跨测试的 React 调度残留）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncButton } from '../src/client/SyncButton.tsx'

describe('SyncButton auto-clear', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('hides the result after the auto-clear delay', async () => {
    const sync = vi.fn().mockResolvedValue({ ok: true, text: 'done' })
    await act(async () => {
      root.render(<SyncButton sync={sync} resultHideMs={10} />)
    })
    const button = container.querySelector('button')
    if (button === null) throw new Error('button not rendered')
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('done')
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    expect(container.textContent).not.toContain('done')
  })
})
