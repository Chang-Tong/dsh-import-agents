/**
 * SyncButton 组件测试：渲染、点击执行注入动作、成功/失败/忙碌状态。
 * 环境为 jsdom；动作经 props 注入（纯展示组件，无外部订阅）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncButton } from '../src/client/SyncButton.tsx'

describe('SyncButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    // pin the UI language so the locale-aware labels are deterministic
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = async (sync: () => Promise<{ ok: boolean; text: string }>): Promise<HTMLButtonElement> => {
    await act(async () => {
      root.render(<SyncButton sync={sync} />)
    })
    const button = container.querySelector('button')
    if (button === null) throw new Error('button not rendered')
    return button
  }

  const click = async (button: HTMLButtonElement): Promise<void> => {
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
  }



  it('renders the sync control in idle state', async () => {
    const button = await render(() => Promise.resolve({ ok: true, text: '' }))
    expect(button.textContent).toBe('Sync')
    expect(button.disabled).toBe(false)
    expect(button.title).toContain('/import-all')
  })

  it('runs the injected action on click and shows the success text', async () => {
    const sync = vi.fn().mockResolvedValue({ ok: true, text: '[pi] 结果: 新导入 0，已存在跳过 36' })
    const button = await render(sync)
    await click(button)
    expect(sync).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('[pi] 结果: 新导入 0')
    expect(button.textContent).toBe('Sync')
  })

  it('shows the error text when the action reports failure', async () => {
    const sync = vi.fn().mockResolvedValue({ ok: false, text: 'command/run append failed' })
    const button = await render(sync)
    await click(button)
    expect(container.textContent).toContain('command/run append failed')
  })

  it('shows a fallback error when the action rejects', async () => {
    const sync = vi.fn().mockRejectedValue(new Error('rpc failed'))
    const button = await render(sync)
    await click(button)
    expect(container.textContent).toContain('Sync failed')
  })

  it('shows the busy state and ignores clicks while running', async () => {
    let release: () => void = () => {}
    const sync = vi.fn().mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, text: 'done' })
    }))
    const button = await render(sync)
    const pending = click(button)
    await act(async () => { await Promise.resolve() })
    expect(button.textContent).toBe('Syncing…')
    expect(button.disabled).toBe(true)
    // 忙碌中再次点击不应触发第二次执行。
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await act(async () => { await Promise.resolve() })
    expect(sync).toHaveBeenCalledOnce()
    await act(async () => { release() })
    await pending
    expect(button.textContent).toBe('Sync')
  })
})

