/**
 * 导入同步按钮（浏览器侧）。
 *
 * 注册到 composer 工具行的 `conversation.input.left` slot：一个小型常驻
 * 控件，点击后通过 `ctx.remote.commands.execute` 执行 `/import-all`
 * （导入 pi/opencode 的会话、agents、skills），并就地显示结果。
 * 不依赖任何 UI 子包——只 import react 与类型，保持 client bundle 最小。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputZone } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the slot registry's Context merge (ctx.slots) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SyncButton } from './SyncButton.tsx'

/** inject 提供的动作面：组件只拿到数据与回调。 */
export interface SyncActions {
  /** 执行一次完整同步（/import-all），返回给用户看的结果文本。 */
  sync: () => Promise<{ ok: boolean; text: string }>
}

/** 本插件的 client 条目名（也用作 slot 注册条目名）。 */
export const name = 'dsh-import-pi-opencode'

/** 需要 slot 注册表；运行时仅 react 被真正 import。 */
export const inject = ['slots']

/**
 * Client plugin body: 在 composer 工具行挂载同步按钮。
 * `slots.inject` 等待 ui-conversation 声明 `conversation.input.left` 后再注册，
 * 声明消失时自动卸载。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    {
      name: 'conversation.input.left',
      id: 'dsh-import-sync-button',
      inject: (sessionId: SessionId | undefined): SyncActions => ({
        sync: async () => {
          if (sessionId === undefined) {
            return { ok: false, text: '当前没有会话' }
          }
          const result = await ctx.remote.commands.execute(sessionId, '/import-all')
          if (!result.ok) {
            return { ok: false, text: `${result.error.code}: ${result.error.message}` }
          }
          if (result.value === undefined) {
            return { ok: true, text: '命令未找到' }
          }
          const outcome = result.value.result
          return { ok: outcome.kind === 'success', text: outcome.text ?? '完成' }
        },
      }),
    },
    SyncButton,
  ))
}
