#!/usr/bin/env bash
set -euo pipefail

# Daily pipeline: fetch -> summarize -> send
# Requirements (can be provided via .env):
#   - OPENAI_API_KEY: your OpenAI key
#   - WECOM_WEBHOOK: WeCom robot webhook URL
# Usage:
#   chmod +x scripts/run-daily.sh
#   ./scripts/run-daily.sh

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

TODAY=$(date +%F)
JSON="out/${TODAY}-news.json"
POST="out/${TODAY}-post.txt"

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
