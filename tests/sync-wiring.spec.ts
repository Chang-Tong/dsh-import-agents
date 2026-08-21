/**
 * Sync 按钮接线测试：apply() 把按钮动作接到 ctx.remote.commands.execute，
 * 必须按 dsh client api 契约传三个业务参数 (sessionId, line, images)。
 * 少传 images 会在运行期报 "expected 3 business argument(s) plus an
 * optional AbortSignal, got 2"（Sync 按钮的同步失败即由此而来）。
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

interface SyncActions {
  sync: () => Promise<{ ok: boolean; text: string }>
}

interface Registration {
  inject: (sessionId: string | undefined) => SyncActions
}

describe('Sync button wiring', () => {
  it('executes /import-all with the images argument (3 business args)', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, value: { result: { kind: 'success', text: 'done' } } })
    let injectSlot: ((sessionId: string | undefined) => unknown) | undefined
    const ctx = {
      slots: {
        inject: (_name: string, callback: (sessionId: string | undefined) => unknown) => {
          injectSlot = callback
        },
        register: (entry: unknown) => entry,
      },
      remote: { commands: { execute } },
    }
    apply(ctx as unknown as Parameters<typeof apply>[0])
    expect(injectSlot).toBeDefined()

    const actions = (injectSlot!('session-1') as Registration).inject('session-1')
    const result = await actions.sync()

    expect(execute).toHaveBeenCalledWith('session-1', '/import-all', [])
    expect(result).toEqual({ ok: true, text: 'done' })
  })

  it('reports a missing session without calling execute', async () => {
    const execute = vi.fn()
    let injectSlot: ((sessionId: string | undefined) => unknown) | undefined
    const ctx = {
      slots: {
        inject: (_name: string, callback: (sessionId: string | undefined) => unknown) => {
          injectSlot = callback
        },
        register: (entry: unknown) => entry,
      },
      remote: { commands: { execute } },
    }
    apply(ctx as unknown as Parameters<typeof apply>[0])

    const actions = (injectSlot!(undefined) as Registration).inject(undefined)
    const result = await actions.sync()

    expect(execute).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })
})
