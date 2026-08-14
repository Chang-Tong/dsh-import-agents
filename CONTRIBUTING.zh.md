# 贡献指南

English | [中文版](CONTRIBUTING.zh.md)

感谢你对 **dsh-import-agents** 感兴趣！项目还很小，由个人维护，但每一种帮助都很重要。你可以这样参与：

## 参与方式

- **报 Bug** —— 开一个 [issue](https://github.com/Chang-Tong/dsh-import-agents/issues/new)，说明来源工具、你执行的导入命令和报错输出。能附上最小复现步骤最好。
- **提需求** —— 开 issue 或在 [Discussions](https://github.com/Chang-Tong/dsh-import-agents/discussions) 发帖，告诉我们你希望下一个支持导入哪个工具。
- **帮忙传播** —— 给仓库点个 ⭐、写博客、分享给团队。这个插件靠可发现性存活。
- **帮助他人** —— 在 Discussions / Issues 里回答问题。
- **加 topic** —— 如果你也做了 dsh 插件，记得给仓库加 `dsh-plugin` 话题（参考 [deepseek-harness 贡献指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.zh.md)），让生态更容易被发现。

## 开发

环境要求：Node >= 22.19、pnpm。

```sh
pnpm install          # devDependencies（esbuild、vitest）
pnpm run build        # 重建 lib/client.js（同步按钮 bundle）
npx vitest run        # 组件测试
```

### 用真实 dsh 后端验证

```sh
# 在 deepseek-harness 仓库根目录执行
node --import tsx/esm ../dsh-import-agents/verify.mts <sessions根> <skills根>
# 期望输出: SESSIONS ALL PASS / SKILLS ALL PASS

# 插件端到端（在真实 cordis 上下文加载插件）
node --import tsx/esm ../dsh-import-agents/plugin/plugin-test.mts
# 期望输出: PLUGIN TEST PASS
```

### 需要牢记的导入规则

- 会话 id 稳定（`pi-<uuid>` / `oc-<id>` / `codex-<id>` / `claude-<id>`）——导入必须保持幂等。
- 工具调用写成 `tool-call` 块 **并配套** `tool/call` + `tool/result` 事件，保证恢复会话时请求合法。
- 每条 user 消息开启一个 turn，每个 turn 以 `turn/end` 收尾——事件日志必须保持平衡。

## Pull Requests

欢迎 PR。请保持改动聚焦、跑通测试；如果改动对用户可见，请在 CHANGELOG 的 `Unreleased`（或下一版本）下补充记录。

## 行为准则

本项目遵循 [Contributor Covenant](CODE_OF_CONDUCT.md)，参与即表示同意遵守其条款。
