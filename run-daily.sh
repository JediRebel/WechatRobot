#!/bin/bash
# Daily wrapper: load nvm, enter project, log, run full pipeline

# 加载 nvm（按需调整路径）
export NVM_DIR="${NVM_DIR:-/root/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 进入项目目录（按需调整路径）
cd /root/WechatRobot || exit 1

# 确保日志目录存在
mkdir -p logs

# 记录触发时间
echo "[$(date '+%Y-%m-%d %H:%M:%S')] run-daily.sh triggered" >> logs/daily.log

# 运行全流程，输出到日志
npm run run:all >> logs/daily.log 2>&1
