/**
 * 把已导入的 pi/opencode/codex/claude-code 会话挂到对应工作区。
 *
 * 在 deepseek-harness 仓库根运行（挂真实 storage/workspace 服务，
 * 直接作用于 ~/.dsh 的持久化状态）：
 *
 *   node --import tsx/esm scripts/attach-all.mts
 *
 * 运行前请确保 dsh web 服务器已停止（workspace.json 由服务器进程持有，
 * 并发写会被覆盖；执行后重启服务器加载新的工作区归属）。
 */
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import {
  attachSessionsToWorkspaces,
  listImportedSessions,
  unifyWorkspaceTitles,
} from '../../dsh-import-agents/plugin/attach-workspaces.mjs'

const home = process.env.HOME ?? ''
const ctx = new Context()
await ctx.plugin(Storage)
await ctx.plugin(StorageJson, { root: `${home}/.dsh/storages` })
await ctx.plugin(StorageDomain, { backend: 'json' })
await ctx.plugin(SessionStore)
await ctx.plugin(JsonlSessionPersistence, { root: `${home}/.dsh/sessions`, compression: 'zstd' })
await ctx.plugin(WorkspaceRegistry)

const sessions = await listImportedSessions(ctx)
console.log(`imported sessions: ${sessions.length}`)
const lines = await attachSessionsToWorkspaces(ctx, sessions)
console.log(lines.join('\n'))
// 删除 cwd 为根目录的工作区（用户不想要 `/ (/)`）。
const registry = ctx.workspaceRegistry
for (const workspace of registry.list()) {
  if (workspace.path === '/') {
    await registry.delete(workspace.id)
    console.log('removed root workspace / (/)')
  }
}
const renamed = await unifyWorkspaceTitles(ctx)
console.log(`unified ${renamed} default-named workspace titles`)
const workspaces = ctx.workspaceRegistry.list()
console.log(`workspaces now: ${workspaces.length}`)
for (const workspace of workspaces) {
  console.log(`  ${workspace.title}  ${workspace.path}  sessions=${workspace.sessionIds.length}`)
}
