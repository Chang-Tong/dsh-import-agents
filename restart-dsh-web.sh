#!/bin/bash
# 安全重启 dsh web（加载 dsh-import-agents 插件更新后使用）。
#
# 重启协议（避免崩溃）:
#   1. 先在 launchd 提交本 wrapper（等 3080 释放后自动拉起新服务器，
#      宿主进程死亡不影响接管）;
#   2. 再 kill 旧服务器进程（kill 宿主会中断当前 agent 回合 —— 这是
#      固有限制，agent 运行在宿主进程内；页面刷新即可恢复）;
#   3. 本脚本负责: 等端口释放 → 启动新服务器 → 健康检查 →
#      验证插件 bundle 已进入 boot manifest → 全量输出到日志。
# 用法: launchctl submit -l dsh-web-restart -o /tmp/dsh-web-restart.out \
#         -e /tmp/dsh-web-restart.err -- /bin/bash restart-dsh-web.sh
LOG=/tmp/dsh-web-import.log
exec >> "$LOG" 2>&1
echo "=== restart at $(date) ==="
for i in $(seq 1 40); do
  if ! lsof -iTCP:3080 -sTCP:LISTEN >/dev/null 2>&1; then echo "port 3080 free after ${i}s"; break; fi
  sleep 1
done
cd /Users/dongair/project/05-pr/dsh/deepseek-harness || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
echo "starting dsh web at $(date)"
nohup node --import tsx/esm apps/cli/src/bin.ts web >> "$LOG" 2>&1 &
NEW_PID=$!
echo "new server pid=$NEW_PID"
for i in $(seq 1 60); do
  if curl -s -o /dev/null http://127.0.0.1:3080/; then
    echo "server up after ${i}s (pid $NEW_PID)"
    # 验证插件 client bundle 已进入 boot manifest（名称变化时改这里）。
    if curl -s http://127.0.0.1:3080/ | grep -q "dsh-import-agents"; then
      echo "plugin bundle present in boot manifest"
      exit 0
    fi
    echo "WARNING: plugin bundle missing from boot manifest"
    exit 1
  fi
  sleep 1
done
echo "server did not come up; log tail:"
tail -30 "$LOG"
exit 1
