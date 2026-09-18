# -*- coding: utf-8 -*-
"""
交付打包脚本（R16）

产出一个可直接给客户的 zip：
  - 排除：server/.env（含 DeepSeek Key）、server/data/（测试数据）、
          node_modules、logs、.git、.sdd/（内部规格，含技术内幕）
  - 包含：后端源码、前端构建产物、Mac 启动脚本、交付说明、Mac 版 MCP 程序
  - 打包前强制做「密钥泄露扫描」，发现 sk- 立即中止

用法：
    python scripts/package-delivery.py                 # 打 Windows+Mac 通用包
    python scripts/package-delivery.py --out 输出.zip
"""
import os
import re
import sys
import shutil
import zipfile
import argparse
from datetime import datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# 打包时排除的路径（相对 ROOT，前缀匹配）
EXCLUDE_DIRS = [
    'server/node_modules', 'web/node_modules', 'node_modules',
    'server/data', 'logs', '.git', '.sdd', 'dist_delivery',
    'server/test-scrape.mjs', 'server/test-dedupe.mjs',
]
EXCLUDE_FILE_PATTERNS = [
    r'^server/\.env$', r'\.env$', r'\.db$', r'\.log$', r'\.pid$',
    r'^\.gitignore$', r'\.zip$',
]
# 允许进入交付包但需要提醒的文件
WARN_IF_PRESENT = ['.env', 'cookies.json']

# 密钥特征：DeepSeek / APIKIKI / 通用 sk-
KEY_PATTERNS = [
    (re.compile(r'sk-[A-Za-z0-9]{16,}'), '疑似 API Key（sk- 开头）'),
    (re.compile(r'DEEPSEEK_API_KEY\s*=\s*\S+'), 'DeepSeek Key 明文赋值'),
    (re.compile(r'APIKIKI_API_KEY\s*=\s*\S+'), 'APIKIKI Key 明文赋值'),
]

# 只扫描这些文本后缀
TEXT_EXT = {'.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.txt',
            '.command', '.bat', '.sh', '.env', '.yml', '.yaml'}


def rel(p):
    return os.path.relpath(p, ROOT).replace('\\', '/')


def should_skip(relpath, is_dir=False):
    for d in EXCLUDE_DIRS:
        if relpath == d or relpath.startswith(d + '/'):
            return True
    for pat in EXCLUDE_FILE_PATTERNS:
        if re.search(pat, relpath if not is_dir else relpath + '/'):
            return True
    return False


def collect():
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        r = rel(dirpath)
        if r == '.':
            r = ''
        dirnames[:] = [d for d in dirnames if not should_skip((r + '/' + d).lstrip('/'), True)]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rp = rel(full)
            if should_skip(rp):
                continue
            files.append(full)
    return files


def scan_keys(files):
    """扫描文本文件里的密钥特征，返回命中列表"""
    hits = []
    for f in files:
        ext = os.path.splitext(f)[1].lower()
        base = os.path.basename(f).lower()
        if ext not in TEXT_EXT and base != '.env':
            continue
        try:
            txt = open(f, 'r', encoding='utf-8', errors='ignore').read()
        except Exception:
            continue
        for pat, why in KEY_PATTERNS:
            for m in pat.finditer(txt):
                snippet = m.group(0)
                masked = snippet[:10] + '…' + snippet[-4:] if len(snippet) > 16 else snippet
                hits.append((rel(f), why, masked))
    return hits


def main():
    ap = argparse.ArgumentParser()
    stamp = datetime.now().strftime('%Y%m%d')
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist_delivery', f'绮点小红书运营系统_交付包_{stamp}.zip'))
    ap.add_argument('--skip-key-scan', action='store_true')
    args = ap.parse_args()

    print('=' * 62)
    print(' 交付打包')
    print('=' * 62)
    print(f'项目根目录: {ROOT}')
    print()

    files = collect()
    print(f'1) 收集到 {len(files)} 个文件（已排除 .env / data / node_modules / .sdd）')

    # 关键文件存在性检查
    must = ['server/src/index.js', 'server/package.json', 'mac/启动.command']
    missing = [m for m in must if not os.path.exists(os.path.join(ROOT, m))]
    if missing:
        print('   ⚠️ 缺少关键文件:', ', '.join(missing))

    # 前端构建产物
    web_dist = os.path.join(ROOT, 'web', 'dist', 'index.html')
    if not os.path.exists(web_dist):
        print('   ⚠️ web/dist 不存在 —— 交付前必须先执行：cd web && npm run build')
    else:
        print('   ✅ 前端构建产物已就绪（web/dist）')

    # Mac MCP
    mac_mcp = []
    for n in ['xiaohongshu-mcp-darwin-amd64', 'xiaohongshu-mcp-darwin-arm64']:
        p = os.path.join(ROOT, 'mcp', n)
        if os.path.exists(p):
            mac_mcp.append((n, os.path.getsize(p) // 1024 // 1024))
    if mac_mcp:
        for n, mb in mac_mcp:
            print(f'   ✅ Mac 版连接程序: {n}（{mb} MB）')
    else:
        print('   ⚠️ 未找到 Mac 版连接程序（mcp/xiaohongshu-mcp-darwin-*）—— 发布功能在客户机上不可用')

    # 依赖检查
    if not os.path.exists(os.path.join(ROOT, 'server', 'package.json')):
        print('   ❌ server/package.json 缺失')

    print()
    print('2) 密钥泄露扫描…')
    hits = scan_keys(files)
    if hits and not args.skip_key_scan:
        print(f'   ❌ 发现 {len(hits)} 处疑似密钥 —— 已中止打包！')
        for f, why, masked in hits[:20]:
            print(f'      {f}  ←  {why}  [{masked}]')
        print()
        print('   处理方式：删除或改为从环境变量读取，然后重新打包。')
        sys.exit(2)
    elif hits:
        print(f'   ⚠️ 发现 {len(hits)} 处疑似密钥（--skip-key-scan 已跳过中止）')
    else:
        print('   ✅ 未发现密钥泄露')

    # 检查是否误带 .env
    if os.path.exists(os.path.join(ROOT, 'server', '.env')):
        print('   ℹ️ server/.env 存在于工程里（含 Key），但已从包中排除')
    if os.path.exists(os.path.join(ROOT, 'server', 'data')):
        print('   ℹ️ server/data 存在于工程里（测试数据），但已从包中排除')

    print()
    print('3) 写入 zip…')
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    total = 0
    with zipfile.ZipFile(args.out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in files:
            arc = '绮点小红书运营系统/' + rel(f)
            rp = rel(f)
            # 保证 Mac 脚本/程序在解压后直接可执行（Windows 上无法设 unix 权限位，只能在 zip 元数据里写）
            need_exec = rp.endswith(('.command', '.sh')) or '/mcp/' in rp
            zi = zipfile.ZipInfo.from_file(f, arc)
            zi.compress_type = zipfile.ZIP_DEFLATED
            if need_exec:
                # 0644 基础上加执行位 → 0755
                zi.external_attr = (0o755 << 16) | 0o20
            with open(f, 'rb') as fh:
                z.writestr(zi, fh.read())
            total += os.path.getsize(f)
    size_mb = os.path.getsize(args.out) / 1024 / 1024
    print(f'   ✅ 已生成：{args.out}')
    print(f'      原始 {total / 1024 / 1024:.1f} MB → 压缩后 {size_mb:.1f} MB')
    print()
    print('4) 交付前人工确认清单：')
    print('   [ ] server/.env 已不在包内（本脚本已自动排除）')
    print('   [ ] 客户机上会重新生成空的 data 目录')
    print('   [x] mac/启动.command 已写入 0755 执行位（解压即用）；说明文档含 chmod 兜底方案')
    print('   [ ] 包内含《交付说明_MacIntel.md》5 步指引')
    print()
    print('完成。')
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
