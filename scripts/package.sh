#!/usr/bin/env bash
# 打出可直接上传 Chrome 应用商店与 Edge 加载项的 zip。同一个包投两边即可，
# 两个商店对包结构的要求一致（manifest.json 在顶层、不带 update_url）。
#
# 用白名单而不是「排除若干目录」：漏排一个新目录只是包大了，
# 漏排一份密钥或调试文件却是事故，白名单让新增文件默认不进包。
set -euo pipefail

cd "$(dirname "$0")/.."

# 运行时真正被加载的文件。改动 manifest 引用时记得同步这里，
# 末尾的自检会在漏了文件时报错。
FILES=(
  manifest.json
  background.js
  content-shared.js
  content-bilibili.js
  content-youtube.js
  settings.js
  sidepanel.html
  sidepanel.css
  sidepanel.js
  custom-select.css
  custom-select.js
  options.html
  options.css
  options.js
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
  icons/tab-assistant-video-icon.svg
  assets/icons/check.svg
  assets/icons/chevron-down.svg
  LICENSE
)
DIRS=(lib prompts vendor)

version=$(node -p "require('./manifest.json').version")
out="dist/video-assistant-${version}.zip"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

for file in "${FILES[@]}"; do
  [ -f "$file" ] || { echo "缺少文件：$file" >&2; exit 1; }
  mkdir -p "$stage/$(dirname "$file")"
  cp "$file" "$stage/$file"
done

for dir in "${DIRS[@]}"; do
  [ -d "$dir" ] || { echo "缺少目录：$dir" >&2; exit 1; }
  cp -r "$dir" "$stage/$dir"
done

# manifest 引用了却没进包的文件，会让浏览器直接拒绝加载整个扩展，
# 而商店的报错通常只指向清单本身，很难定位。
missing=$(cd "$stage" && node -e '
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const referenced = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page,
  ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
  ...Object.values(manifest.action?.default_icon || {}),
  ...Object.values(manifest.icons || {}),
].filter(Boolean);
const sw = fs.readFileSync(manifest.background.service_worker, "utf8");
const block = sw.match(/importScripts\(([\s\S]*?)\);/);
if (block) referenced.push(...[...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
for (const entry of manifest.web_accessible_resources || []) {
  referenced.push(...(entry.resources || []));
}
for (const page of [manifest.side_panel?.default_path, manifest.options_ui?.page]) {
  if (!page) continue;
  const html = fs.readFileSync(page, "utf8");
  referenced.push(...[...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]));
  referenced.push(...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]));
}
// HTML 样式表间接引用的本地图标同样是运行时依赖，不能只校验 HTML/manifest。
for (const stylesheet of [...new Set(referenced.filter((file) => file?.endsWith(".css")))]) {
  // 第三方 KaTeX CSS 枚举了 woff2/woff/ttf 多级回退，而 vendored 发行包只带
  // 首选 woff2；这些后备 URL 缺失不影响运行，也不应被当成项目漏包。
  if (stylesheet.replaceAll("\\", "/").startsWith("vendor/")) continue;
  if (!fs.existsSync(stylesheet)) continue;
  const css = fs.readFileSync(stylesheet, "utf8");
  for (const match of css.matchAll(/url\(["\x27]?([^"\x27)]+)["\x27]?\)/g)) {
    const asset = match[1].trim();
    if (/^(?:data:|https?:|#)/.test(asset)) continue;
    referenced.push(require("path").join(require("path").dirname(stylesheet), asset));
  }
}
console.log(referenced.filter((file) => !fs.existsSync(file)).join(" "));
')
[ -z "$missing" ] || { echo "这些文件被清单引用但没打进包：$missing" >&2; exit 1; }

# CRLF 会让 prompts/*.md 的代码块解析不出来，「概览」随之失效，
# 而这种失效只有把包装进浏览器才看得见。宁可在这里拦住。
# 注意：$'\r' 字面量不能直接写进 $(...) —— MSYS bash 5.2 会把它吞成空串，
# 导致 grep 变成匹配一切、把所有文件误报成 CRLF。先赋值再展开不受影响。
CR=$'\r'
crlf=$(cd "$stage" && grep -rlU "$CR" . --exclude='*.png' --exclude='*.woff2' --exclude='*.woff' --exclude='*.ttf' || true)
[ -z "$crlf" ] || {
  echo "包内有 CRLF 换行的文件，会导致提示词解析失败：" >&2
  echo "$crlf" >&2
  echo "跑 bash scripts/normalize-eol.sh 修复。" >&2
  exit 1
}

mkdir -p dist
rm -f "$out"
absolute_out="$(pwd)/$out"
# MSYS_NO_PATHCONV=1（Hermes 终端等）下原生 zip.exe 收到 /f/... 字面路径会
# I/O error；原生工具一律只认 Windows 路径，先转换再传。
if command -v cygpath >/dev/null 2>&1; then
  absolute_out="$(cygpath -w "$absolute_out")"
fi

# zip 不是所有环境都装了（WSL 默认就没有），python3 的 zipfile 模块可以顶上。
if command -v zip >/dev/null 2>&1; then
  (cd "$stage" && zip -q -r -X "$absolute_out" .)
elif command -v python3 >/dev/null 2>&1; then
  # 传 * 而不是 . ，这样条目直接落在压缩包根部——商店要求 manifest.json 在顶层。
  (cd "$stage" && python3 -m zipfile -c "$absolute_out" *)
else
  echo "需要 zip 或 python3 其中之一来打包。" >&2
  exit 1
fi

echo "$out"
echo "版本 ${version}，大小 $(du -h "$out" | cut -f1)，$(unzip -l "$out" 2>/dev/null | tail -1 | awk '{print $2}' || echo '?') 个文件"
