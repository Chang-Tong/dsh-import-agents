/**
 * 插件回归验证：在真实 cordis 上下文上加载插件并端到端执行。
 *
 * 在 deepseek-harness 仓库根运行（tsx 需要仓库 tsconfig paths 解析
 * @deepseek-ai/* 工作区包）：
 *
 *   node --import tsx/esm ../import-pi-opencode/plugin/plugin-test.mts
 *
 * 覆盖：
 *   1. 四个斜杠命令注册与执行（import-pi / import-opencode / import-agents）
 *   2. session-start 迁移询问（maybeOfferMigration）：假 userQuestions provider
 *      自动回答，断言按选择导入、注入完成通知、状态文件落盘、二次询问去重。
 *
 * 会话与状态写入 /tmp/dsh-plugin-test（staging，DSH_HOME 重定向），
 * 不碰真实 ~/.dsh；import-agents 的 skillsRoot 也在 staging。
 */
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as ImportPlugin from './index.mjs'
import { maybeOfferMigration } from './migrate-on-start.mjs'
import { rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

process.env.DSH_HOME = '/tmp/dsh-plugin-test/home'
const root = '/tmp/dsh-plugin-test/sessions'
const skillsRoot = '/tmp/dsh-plugin-test/skills'
rmSync('/tmp/dsh-plugin-test', { recursive: true, force: true })

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
await ctx.plugin(CommandRuntime)
await ctx.plugin(UserQuestionService)
await ctx.plugin(ImportPlugin, { limit: 2, skillsRoot })

// --- 1. slash commands ---
const session = ctx.sessions.prepare(SessionId('cmd-test-session'))
const agent = { session }

const before = await ctx.sessionPersistence.list()
console.log(`before: ${before.length} sessions`)

for (const [name, input] of [['import-pi', '--limit 1'], ['import-opencode', '--limit 1'], ['import-agents', '']]) {
  const def = ctx.commands.find(agent, name)
  if (def === undefined) throw new Error(`command ${name} not registered`)
  const result = await def.handler({ commandId: 'cmd-test-1', agent, rawInput: input, signal: new AbortController().signal })
  console.log(`--- /${name} ${input} -> ${result.kind} ---`)
  console.log(result.text.split('\n').slice(-3).join('\n'))
}

const afterCommands = await ctx.sessionPersistence.list()
console.log(`after commands: ${afterCommands.length} sessions`)
for (const header of afterCommands) {
  const { events } = await ctx.sessionPersistence.load(header.id)
  console.log(`OK loaded ${header.id}: ${events.length} events, cwd=${header.cwd}`)
}
if (afterCommands.length <= before.length) throw new Error('commands did not import anything')

// --- 2. session-start migration offer ---
const seenQuestions = []
ctx.userQuestions.registerProvider({
  ask: async (request) => {
    seenQuestions.push(request.questions.map(q => q.id))
    const choices = {
      'migrate-sessions': ['只导入本项目'],
      'migrate-agents': ['导入 agents/skills'],
    }
    return { answers: request.questions.map(q => ({ id: q.id, selected: choices[q.id] ?? [] })) }
  },
})

const offerSession = ctx.sessions.prepare(SessionId('offer-test-session'), {
  meta: { cwd: '/Users/dongair/project/Tributo/Tributo' },
})
const injected = []
const offerAgent = { session: offerSession, inject: message => injected.push(message) }

await maybeOfferMigration(ctx, offerAgent, {
  piRoot: `${process.env.HOME}/.pi/agent/sessions`,
  piAgentRoot: `${process.env.HOME}/.pi/agent`,
  opencodeDb: `${process.env.HOME}/.local/share/opencode/opencode.db`,
  opencodeConfig: `${process.env.HOME}/.config/opencode`,
  skillsRoot,
})

const afterOffer = await ctx.sessionPersistence.list()
console.log(`after offer: ${afterOffer.length} sessions`)
const newIds = afterOffer.map(h => h.id).filter(id => !afterCommands.some(h => h.id === id))
console.log(`newly imported by offer: ${newIds.join(', ')}`)
if (newIds.length === 0) throw new Error('migration offer imported nothing')
if (newIds.some(id => !id.includes('/') && !/^(pi|oc)-/.test(id))) throw new Error('unexpected session id')
if (injected.length !== 1) throw new Error(`expected 1 completion notice, got ${injected.length}`)
console.log(`notice: ${injected[0].content[0].text}`)
if (!seenQuestions[0]?.includes('migrate-sessions')) throw new Error('sessions question not asked')

// --- 3. second offer for the same project must not re-ask sessions ---
const offerSession2 = ctx.sessions.prepare(SessionId('offer-test-session-2'), {
  meta: { cwd: '/Users/dongair/project/Tributo/Tributo' },
})
await maybeOfferMigration(ctx, { session: offerSession2, inject: () => {} }, {
  piRoot: `${process.env.HOME}/.pi/agent/sessions`,
  piAgentRoot: `${process.env.HOME}/.pi/agent`,
  opencodeDb: `${process.env.HOME}/.local/share/opencode/opencode.db`,
  opencodeConfig: `${process.env.HOME}/.config/opencode`,
  skillsRoot,
})
const statePath = join(process.env.DSH_HOME, 'import-pi-opencode-state.json')
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
console.log(`state file: ${JSON.stringify(state)}`)
if (state.projects?.['/Users/dongair/project/Tributo/Tributo']?.sessions !== 'imported') {
  throw new Error('state did not record imported decision')
}
if (state.agents !== 'imported') throw new Error('state did not record agents decision')
// Second offer: sessions already imported -> pending for this project is empty,
// so no new question is asked (seenQuestions stays at 1).
if (seenQuestions.length !== 1) {
  throw new Error(`expected no second ask, got ${seenQuestions.length} asks`)
}

console.log('PLUGIN TEST PASS')
