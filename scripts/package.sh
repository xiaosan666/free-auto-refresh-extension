#!/usr/bin/env bash
#
# 打包扩展为 Chrome 应用商店上传用的 ZIP。
# 用法：bash scripts/package.sh
# 产物：dist/free-auto-refresh-extension-<version>.zip
# 说明：只打包扩展运行必需的文件，排除 .git / 文档 / IDE 技能目录，减小审核面。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 从 manifest.json 读取版本号（优先用 node，没有就用 sed 兜底）
VERSION="$(node -p "require('$ROOT/manifest.json').version" 2>/dev/null || \
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/manifest.json" | head -1)"
if [ -z "$VERSION" ]; then
  echo "无法从 manifest.json 读取版本号" >&2
  exit 1
fi

OUT_DIR="$ROOT/dist"
ZIP_FILE="$OUT_DIR/free-auto-refresh-extension-$VERSION.zip"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.zip

zip -r -q "$ZIP_FILE" . \
  -x ".git/*" \
  -x ".gitignore" \
  -x ".DS_Store" \
  -x ".codebuddy/*" \
  -x ".claude/*" \
  -x ".agents/*" \
  -x "dist/*" \
  -x "scripts/*" \
  -x "*.md" \
  -x "skills-lock.json"

echo "已生成：$ZIP_FILE"
echo "文件清单："
unzip -l "$ZIP_FILE" | sed -n '4,20p'
