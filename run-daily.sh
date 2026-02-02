# !/bin/bash

export NPM_CONFIG_LOGLEVEL=error
# Daily wrapper: enter project, log, run full pipeline
set -euo pipefail

# 基于脚本位置推导项目根目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

# 确保 PATH 包含常用目录（避免 cron 下找不到 node/npm）
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# 日志文件（同时输出到终端和文件）
mkdir -p "$ROOT_DIR/logs"
LOG_FILE="$ROOT_DIR/logs/daily.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] run-daily.sh triggered"

# 运行全流程
npm run run:all
