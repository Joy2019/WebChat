#!/usr/bin/env bash
# 同步推送当前分支到 GitHub (origin) 与 Gitee (gitee)
# 用法: ./scripts/mirror-push.sh [分支名，默认 H5Branch]

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${1:-H5Branch}"

if ! git remote | grep -qx origin; then
  echo "错误: 未找到 origin 远程" >&2
  exit 1
fi
if ! git remote | grep -qx gitee; then
  echo "错误: 未找到 gitee 远程。请先: git remote add gitee https://gitee.com/你的用户名/AIChater.git" >&2
  exit 1
fi

echo ">>> 推送到 origin ($BRANCH) ..."
git push origin "$BRANCH"
echo ">>> 推送到 gitee ($BRANCH) ..."
git push gitee "$BRANCH"
echo ">>> 双端推送完成。"
