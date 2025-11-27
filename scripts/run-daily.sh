#!/usr/bin/env bash
set -euo pipefail

# Daily pipeline: fetch -> summarize -> send
# Requirements (can be provided via .env):
#   - OPENAI_API_KEY: your OpenAI key
#   - WECOM_WEBHOOK: WeCom robot webhook URL
# Usage:
#   chmod +x scripts/run-daily.sh
#   ./scripts/run-daily.sh

# 确保在项目根目录运行（基于脚本所在目录计算，无需硬编码绝对路径）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

JSON="out/news.json"
POST="out/post.txt"

echo "== Fetching news (past 24h) to ${JSON} =="
npx ts-node -r tsconfig-paths/register -r dotenv/config src/test-all.ts \
  --windowHours 24 \
  --json "${JSON}" \
  --show 999

echo "== Generating post to ${POST} =="
: "${OPENAI_API_KEY:?Missing OPENAI_API_KEY}"
OPENAI_API_KEY="${OPENAI_API_KEY}" \
npx ts-node -r dotenv/config scripts/prepare-post.ts \
  --input "${JSON}" \
  --output "${POST}" \
  --model gpt-4o-mini

echo "== Sending to WeCom =="
: "${WECOM_WEBHOOK:?Missing WECOM_WEBHOOK}"
WECOM_WEBHOOK="${WECOM_WEBHOOK}" \
npx ts-node -r dotenv/config scripts/send-wecom.ts \
  --file "${POST}"

echo "== Done =="
