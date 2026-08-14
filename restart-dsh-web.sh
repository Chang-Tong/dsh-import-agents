#!/bin/bash
# 重启 dsh web（加载 import-pi-opencode 插件后使用）。
# 用法: bash restart-dsh-web.sh [grace-seconds]
# 默认等 25 秒（给当前 agent 回合留出完成时间）再 kill 旧进程，
# 随后在仓库根以相同方式启动新服务器并健康检查 3080 端口。
LOG=/tmp/dsh-web-restart.log
GRACE=${1:-25}
exec >> "$LOG" 2>&1
echo "=== restart at $(date) grace=${GRACE}s ==="
sleep "$GRACE"
pkill -f "apps/cli/src/bin.ts web" || true
for i in $(seq 1 20); do
  if ! lsof -iTCP:3080 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port 3080 free after ${i}s"
    break
  fi
  sleep 1
done
cd /Users/dongair/project/05-pr/dsh/deepseek-harness || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
nohup node --import tsx/esm apps/cli/src/bin.ts web >> "$LOG" 2>&1 &
NEW_PID=$!
echo "new server pid=$NEW_PID"
for i in $(seq 1 40); do
  if curl -s -o /dev/null http://127.0.0.1:3080/; then
    echo "server up after ${i}s (pid $NEW_PID)"
    grep -c "import-pi-opencode" /tmp/dump-config.json >/dev/null 2>&1
    exit 0
  fi
  sleep 1
done
echo "server did not come up; log tail:"
tail -30 "$LOG"
exit 1
