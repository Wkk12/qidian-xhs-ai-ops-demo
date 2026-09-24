# -*- coding: utf-8 -*-
"""一批后端补丁：
  1) comments.js  —— R23 自动回复总开关（默认关；关=不自动发，进人工待办）+ 命中的知识来源可追溯
  2) generate.js  —— §0 参考系补强：完整运营策略进入提示词 + 平台真实浏览量进入「平时数据」
  3) index.js     —— 注册 outline / library 路由 + 新增 /api/reply/settings（互动区开关）
"""
import io, re

ROOT = r"C:\Users\12543\xhs-ops-platform\server\src"

def load(name):
    with io.open(f"{ROOT}\\{name}", "r", encoding="utf-8", newline="") as f:
        return f.read()

def save(name, data, must_have):
    for m in must_have:
        assert m in data, f"{name} 落盘前校验失败：缺少 {m!r}"
    with io.open(f"{ROOT}\\{name}", "w", encoding="utf-8", newline="") as f:
        f.write(data)
    print(f"  ✔ {name} 已写")

def sub1(text, old, new, tag):
    crlf = "\r\n" in text
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert text.count(o) == 1, f"[{tag}] 锚点不唯一/不存在：count={text.count(o)}"
    return text.replace(o, n, 1)

# ---------------- 1) comments.js ----------------
c = load("comments.js")

old = """function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(value), now());
}
"""
new = old + """
/**
 * R23：评论自动回复总开关（默认**关**）
 *  - 关：命中的评论也不自动发，一律进「人工待办」等人工确认（收集/匹配/生成照常跑，互动区仍能看到）
 *  - 开：命中知识库且过禁用词/观察期后自动发出
 * 开关挂在「运营大纲 · 互动区」顶部。
 */
export function isReplyEnabled() {
  return getSetting('reply_auto_enabled', false) === true;
}

export function setReplyEnabled(v) {
  setSetting('reply_auto_enabled', !!v);
  log('info', 'comments', '自动回复开关 → ' + (isReplyEnabled() ? '开' : '关'));
  return { ok: true, enabled: isReplyEnabled() };
}
"""
c = sub1(c, old, new, "comments.setSetting")

old = """  // ⑥ 发送
  const sent = await sendReply({ commentId: cid, noteId, content: reply });"""
new = """  // ⑤.5 R23：自动回复总开关（关 → 只生成不发送，转人工待办）
  if (!isReplyEnabled()) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, replyText: reply, status: 'pending_review', skipReason: '自动回复开关已关闭 → 转人工确认' });
    return { ok: true, decision: 'pending_review', reason: '自动回复开关已关闭（回复已生成，等人工发）' };
  }

  // ⑥ 发送
  const sent = await sendReply({ commentId: cid, noteId, content: reply });"""
c = sub1(c, old, new, "comments.gate")

old = """  return bestScore >= 1.5 ? { item: best, score: bestScore } : null;"""
new = """  // R24：命中的知识来源可追溯（'library' = 来自「资料库」上传的文档）
  return bestScore >= 1.5 ? { item: best, score: bestScore, source: best.source || 'manual' } : null;"""
c = sub1(c, old, new, "comments.matchSource")
save("comments.js", c, ["isReplyEnabled", "自动回复开关已关闭", "best.source || 'manual'"])

# ---------------- 2) generate.js ----------------
g = load("generate.js")

old = """export function buildPrompt({ userIntent, postsPerDay, days, startDay, includeRoles }) {"""
new = """/**
 * §0 参考系③补强：自己账号在平台上的真实表现（创作者中心每日浏览量）
 * 走本机服务自己的 /api/creator/overview（已经带缓存+重试），避免重复实现取 cookie 的逻辑。
 */
let _platformRef = { at: 0, text: '' };

export function platformText() {
  return _platformRef.text || '  （平台数据未取到：登录态失效或平台尚未积累数据）';
}

export async function refreshPlatformRef({ ttlMs = 30 * 60 * 1000 } = {}) {
  if (_platformRef.text && Date.now() - _platformRef.at < ttlMs) return _platformRef.text;
  try {
    const r = await fetch('http://127.0.0.1:8787/api/creator/overview', { signal: AbortSignal.timeout(20000) }).then((x) => x.json());
    const win = r.thirty || r.seven || null;
    const series = (win && win.series && win.series.view_count) || [];
    const total = series.reduce((a, p) => a + (Number(p.count) || 0), 0);
    const peak = series.reduce((a, p) => ((Number(p.count) || 0) > (Number(a.count) || 0) ? p : a), { date: '', count: 0 });
    const sum = (win && win.summary ? win.summary : []).map((x) => `${x.label} ${x.total}`).join(' / ');
    _platformRef = {
      at: Date.now(),
      text: series.length
        ? `  近 ${series.length} 天浏览量合计 ${total}｜单日最高 ${peak.count}（${String(peak.date).slice(5)}）｜30 天汇总：${sum}\\n  每日序列：${series.map((p) => `${String(p.date).slice(5)}:${p.count}`).join(' ')}`
        : '',
    };
  } catch (e) {
    _platformRef = { at: Date.now(), text: '' };
    log('error', 'generate', '平台数据参考系取数失败: ' + e.message);
  }
  return _platformRef.text;
}

export function buildPrompt({ userIntent, postsPerDay, days, startDay, includeRoles }) {"""
g = sub1(g, old, new, "generate.platformRef")

old = """  内容支柱占比：
${pillarText}
"""
new = """  内容支柱占比：
${pillarText}

【完整运营策略】同属参考系②（运营大纲里定的「怎么做 / 多长时间什么目标 / 分阶段选题」，生成方向必须服从它）
${strategyText()}
"""
g = sub1(g, old, new, "generate.strategyInPrompt")

old = """${goodText}

【参考系④·当前行业热点】"""
new = """${goodText}

【参考系③补·自己账号在平台上的真实表现】权重同属 0.20（创作者中心官方数据：先看什么内容真的有人看）
${platformText()}

【参考系④·当前行业热点】"""
g = sub1(g, old, new, "generate.platformInPrompt")

old = """export async function generateWeek({ userIntent = '', postsPerDay = 1, days = 7, startDay = 1, dryRun = false } = {}) {"""
new = old + """
  await refreshPlatformRef(); // §0：先把「平时数据」取到手，再拼提示词"""
g = sub1(g, old, new, "generate.awaitPlatform")

# 顶部补 import（outline 的 strategyText）
m = re.search(r"(import \{[^}]*\} from '\./deepseek\.js';?\n)", g)
if m:
    g = g[:m.end()] + "import { strategyText } from './outline.js';\n" + g[m.end():]
else:
    m2 = re.search(r"^import .*\n", g, re.M)
    g = g[:m2.end()] + "import { strategyText } from './outline.js';\n" + g[m2.end():]
assert "import { strategyText } from './outline.js';" in g
save("generate.js", g, ["strategyText()", "platformText()", "refreshPlatformRef", "import { strategyText }"])

# ---------------- 3) index.js ----------------
i = load("index.js")

old = "import { registerAnalyticsApi } from './analytics.js';"
new = old + "\nimport { registerOutlineApi } from './outline.js';\nimport { registerLibraryApi } from './library.js';\nimport { isReplyEnabled, setReplyEnabled } from './comments.js';"
i = sub1(i, old, new, "index.import")

# 注册：跟在 registerAnalyticsApi(app) 之后
m = re.search(r"^(\s*)(await )?registerAnalyticsApi\(app\);", i, re.M)
assert m, "找不到 registerAnalyticsApi(app) 调用"
indent = m.group(1)
i = i[:m.end()] + f"\n{indent}await registerOutlineApi(app);\n{indent}await registerLibraryApi(app);" + i[m.end():]

# 互动区开关接口
old = "app.get('/api/settings', async () => {"
new = """// ---------- R23 互动区：评论自动回复总开关 ----------
app.get('/api/reply/settings', async () => ({ ok: true, enabled: isReplyEnabled() }));
app.post('/api/reply/settings', async (req) => setReplyEnabled(!!(req.body || {}).enabled));

app.get('/api/settings', async () => {"""
i = sub1(i, old, new, "index.replySettings")
save("index.js", i, ["registerOutlineApi(app)", "registerLibraryApi(app)", "app.get('/api/reply/settings'"])

print("全部补丁完成")
