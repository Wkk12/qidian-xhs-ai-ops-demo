#!/usr/bin/env bash
# 交付前密钥铲除（安全版）
#
# ⚠️ 血泪教训：本脚本必须保证 F1/F2 非空。
#    2026-09-24 曾因为变量未定义 → grep 匹配空串 → perl 把**每个文件每个字符**都插入了占位符，
#    把整个工作区写坏（后靠 git bundle 备份整仓还原）。所以下面第一件事就是“空模式 = 直接退出”。
#
# 用法：bash scripts/purge-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# 片段运行时拼接（脚本正文里不出现明文，避免脚本自身成为泄露源）
F1="s""k-""796"
F2="s""k-""YJh"
PLACE="sk-REPLACED-BY-CUSTOMER-KEY"
[ -n "$F1" ] && [ -n "$F2" ] && [ -n "$PLACE" ] || { echo "❌ 模式为空，拒绝执行"; exit 1; }
export F1 F2 PLACE

# 仓库外的过滤器（放在 .hermes-tmp；放仓库里会让脚本自己成为扫描命中）
FILTER="${PURGE_FILTER:-$HOME/.hermes-tmp/purge_filter.sh}"
if [ ! -f "$FILTER" ]; then
  mkdir -p "$(dirname "$FILTER")"
  cat > "$FILTER" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
: "${F1:?F1 未定义 —— 拒绝执行}"
: "${F2:?F2 未定义 —— 拒绝执行}"
PLACE="${PLACE:-sk-REPLACED-BY-CUSTOMER-KEY}"
export F1 F2 PLACE
grep -rl -I -e "$F1" -e "$F2" . --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null | while read -r f; do
  F1="$F1" F2="$F2" PLACE="$PLACE" perl -CSD -pi -e 's/\Q$ENV{F1}\E[^ \t\r\n"<>|)]*/$ENV{PLACE}/g; s/\Q$ENV{F2}\E[^ \t\r\n"<>|)]*/$ENV{PLACE}/g' "$f"
done
EOS
fi

STAMP="$(date +%Y%m%d-%H%M)"
echo "== 1/4 备份（出问题可整仓还原） =="
git bundle create "../$(basename "$(pwd)")-beforePurge-${STAMP}.bundle" --all >/dev/null
echo "   已备份到 ../$(basename "$(pwd)")-beforePurge-${STAMP}.bundle"

echo "== 2/4 重写历史 =="
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --tree-filter "bash \"$FILTER\"" -- --all

echo "== 3/4 清备份引用 + reflog + gc =="
git for-each-ref --format="%(refname)" refs/original/ | while read -r r; do git update-ref -d "$r"; done
git reflog expire --expire=now --all
git gc --prune=now --quiet

echo "== 4/4 验证（两个都应为 0） =="
echo -n "  提交数（不应翻倍）: "; git rev-list --all --count
echo -n "  全历史扫描命中: "
git rev-list --objects --all | awk '{print $1}' \
  | git cat-file --batch-check='%(objecttype) %(objectname)' | awk '$1=="blob"{print $2}' \
  | git cat-file --batch 2>/dev/null | grep -ac -e "${F1}" -e "${F2}" || true
