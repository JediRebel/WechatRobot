#!/bin/bash
# Daily wrapper: enter project, optional nvm, log, run full pipeline
set -euo pipefail

# 基于脚本位置推导项目根目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

# 可选：加载 nvm（如需固定 Node 版本，在服务器调整路径）
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # nvm 可选，失败不终止
  set +e
  \. "$NVM_DIR/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || true
  set -e
fi

# 日志文件（同时输出到终端和文件）
mkdir -p "$ROOT_DIR/logs"
LOG_FILE="$ROOT_DIR/logs/daily.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] run-daily.sh triggered"

# 运行全流程
npm run run:all
