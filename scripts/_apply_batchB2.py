# -*- coding: utf-8 -*-
"""第二批后端（续）：
 2) outline.js —— 策略「发布时间表」落库 + AI 初稿吃真实数据（读平台 30 天 + 已发标题）
 3) index.js   —— 注册 keys/knowledge 接口 + 「内容与发布保护」真开关 + 生成建议排期时间
 4) comments.js—— 禁用词默认专业词表 + 人设卡继承运营大纲人设（不再各说各话）
 5) generate.js—— emoji 小红书风格 + 跟随大纲选题 + 查重开关可关
"""
import io

ROOT = r"C:\Users\12543\xhs-ops-platform\server\src"

def load(n):
    with io.open(f"{ROOT}\\{n}", "r", encoding="utf-8", newline="") as f:
        return f.read()

def save(n, d, must):
    for m in must:
        assert m in d, f"{n} 校验失败：缺 {m!r}"
    with io.open(f"{ROOT}\\{n}", "w", encoding="utf-8", newline="") as f:
        f.write(d)
    print("  ✔", n)

def sub1(t, old, new, tag):
    crlf = "\r\n" in t
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert t.count(o) == 1, f"[{tag}] 锚点 count={t.count(o)}"
    return t.replace(o, n, 1)

# ========== 1) outline.js ==========
O = load("outline.js")
if "post_time" not in O:
    O = sub1(O, "      phases      TEXT,            -- 分阶段策略（JSON：[{name,goal,topics:[]}]）\n      source      TEXT,",
                "      phases      TEXT,            -- 分阶段策略（JSON：[{name,goal,topics:[]}]）\n      post_time   TEXT,            -- 发布时间表（如 19:30）：生成后自动排期就按它\n      source      TEXT,", "out.create")
    O = sub1(O, "  `);\n}\n\nfunction safeParse", "  `);\n  try { db.exec('ALTER TABLE strategy ADD COLUMN post_time TEXT'); } catch { /* 列已存在 */ }\n}\n\nfunction safeParse", "out.alter")
    O = sub1(O, "  if (!row) return { howTo: '', goals: '', phases: [], source: '', updatedAt: null, exists: false };",
                "  if (!row) return { howTo: '', goals: '', phases: [], postTime: '', source: '', updatedAt: null, exists: false };", "out.empty")
    O = sub1(O, "  return {\n    howTo: row.how_to || '',\n    goals: row.goals || '',",
                "  return {\n    howTo: row.how_to || '',\n    goals: row.goals || '',\n    postTime: row.post_time || '',", "out.get")
    O = sub1(O, "    phases: patch.phases !== undefined ? (Array.isArray(patch.phases) ? patch.phases : cur.phases) : cur.phases,\n  };",
                "    phases: patch.phases !== undefined ? (Array.isArray(patch.phases) ? patch.phases : cur.phases) : cur.phases,\n    postTime: patch.postTime !== undefined ? String(patch.postTime || '') : (cur.postTime || ''),\n  };", "out.next")
    O = sub1(O, "db.prepare('UPDATE strategy SET how_to=?, goals=?, phases=?, source=?, updated_at=? WHERE id=?')\n      .run(next.howTo, next.goals, JSON.stringify(next.phases), source, now(), row.id);",
                "db.prepare('UPDATE strategy SET how_to=?, goals=?, phases=?, post_time=?, source=?, updated_at=? WHERE id=?')\n      .run(next.howTo, next.goals, JSON.stringify(next.phases), next.postTime, source, now(), row.id);", "out.update")
    O = sub1(O, "db.prepare('INSERT INTO strategy (how_to, goals, phases, source, updated_at) VALUES (?,?,?,?,?)')\n      .run(next.howTo, next.goals, JSON.stringify(next.phases), source, now());",
                "db.prepare('INSERT INTO strategy (how_to, goals, phases, post_time, source, updated_at) VALUES (?,?,?,?,?,?)')\n      .run(next.howTo, next.goals, JSON.stringify(next.phases), next.postTime, source, now());", "out.insert")
    O = sub1(O, "  if (s.goals) lines.push('【多长时间达到什么目标】\\n' + s.goals);",
                "  if (s.goals) lines.push('【多长时间达到什么目标】\\n' + s.goals);\n  if (s.postTime) lines.push('【发布时间】每天 ' + s.postTime + ' 发布');", "out.text")
    O = sub1(O, "  if (patch.goals !== undefined) norm.goals = String(patch.goals || '');",
                "  if (patch.goals !== undefined) norm.goals = String(patch.goals || '');\n    if (patch.post_time !== undefined) norm.postTime = String(patch.post_time || '');", "out.patch")
    O = sub1(O, "  const saved = saveStrategy({ howTo: j.how_to || '', goals: j.goals || '', phases }, 'ai');",
                "  const saved = saveStrategy({ howTo: j.how_to || '', goals: j.goals || '', phases, postTime: j.post_time || '' }, 'ai');", "out.save")
    O = sub1(O, "    const r = saveStrategy({ howTo: b.howTo, goals: b.goals, phases: b.phases }, 'manual');",
                "    const r = saveStrategy({ howTo: b.howTo, goals: b.goals, phases: b.phases, postTime: b.postTime }, 'manual');", "out.route")
    # AI 初稿：吃真实数据 + 给时间表 + 反空话
    O = sub1(O, "  const sys = `你是小红书账号增长顾问。给一个美业/化妆培训类账号写一份**完整可执行**的运营策略。",
                """  // 真实数据（平台 30 天 + 本机已发标题）——策略必须贴着它写，不许写通用套话
  let plat = '';
  try {
    const rr = await fetch('http://127.0.0.1:8787/api/creator/overview', { signal: AbortSignal.timeout(15000) }).then((x) => x.json());
    const w = (rr && (rr.thirty || rr.seven)) || null;
    if (w && w.summary) plat = '平台近 30 天真实数据：' + w.summary.map((x) => `${x.label} ${x.total}`).join('、');
  } catch { /* 拿不到就不硬编 */ }
  let localTitles = '';
  try {
    const rows = db.prepare('SELECT title FROM contents WHERE title IS NOT NULL ORDER BY id DESC LIMIT 30').all();
    localTitles = rows.length ? '本机已有内容标题（选题不要重复这些角度）：' + rows.map((x) => x.title).join('；') : '';
  } catch { /* ignore */ }

  const sys = `你是小红书账号增长顾问。给一个美业/化妆培训类账号写一份**贴合账号真实数据、能直接落地**的运营策略。""", "out.sys")
    O = sub1(O, "phases 给 3 个阶段，每阶段 3-5 个具体选题（中文、可直接当笔记标题）。`;",
                """phases 给 3 个阶段，每阶段 3-5 个具体选题（中文、可直接当笔记标题）。
"how_to" 必须能直接执行（内容形态 / 每天几条 / 怎么互动 / 怎么转化），禁止"提升影响力"这类空话。
"post_time" 给一个具体发布时间（HH:MM，按目标人群刷小红书高峰）。
若真实数据很差（浏览量极低等），策略要**正视现状**：先解决什么、预期多少，不要吹大目标。
只输出 JSON：{"how_to":"…","goals":"…","post_time":"19:30","phases":[{"name":"","goal":"","topics":[]}]}`;""", "out.ask")
    O = sub1(O, "${userIntent ? `用户补充要求：${userIntent}` : ''}`;",
                "${userIntent ? `用户补充要求：${userIntent}` : ''}\n${plat ? '\\n' + plat : ''}\n${localTitles ? '\\n' + localTitles : ''}`;", "out.usr")
save("outline.js", O, ["post_time", "postTime", "plat ?"])

# ========== 2) index.js ==========
I = load("index.js")
if "registerKeysApi" not in I:
    I = sub1(I, "import { registerLibraryApi } from './library.js';",
                "import { registerLibraryApi } from './library.js';\nimport { registerKnowledgeApi } from './knowledge.js';\nimport { registerKeysApi } from './keys.js';\nimport { reloadKeys as reloadDeepseekKeys, chat as deepseekChatOnce } from './deepseek.js';", "idx.import")
    I = sub1(I, "import { generateImage, expandPrompt, imagegenReady, TIERS } from './imagegen.js';",
                "import { generateImage, expandPrompt, imagegenReady, TIERS, reloadKeys as reloadImageKeys, testImageChannel } from './imagegen.js';", "idx.import2")
    I = sub1(I, "await registerLibraryApi(app);",
                """await registerLibraryApi(app);
await registerKnowledgeApi(app);
await registerKeysApi(app, {
    deepseekInfo,
    reloadDeepseek: reloadDeepseekKeys,
    chatOnce: (msgs, opt) => deepseekChatOnce(msgs, opt),
    imageStatus: imagegenReady,
    reloadImage: reloadImageKeys,
    testImageChannel,
  });""", "idx.register")

    # 「内容与发布保护」真开关
    guard = """
/* ---------- 「内容与发布保护」开关（原来是三个「未接入」死框） ---------- */
function getSettingRow(key, dflt) {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!r) return dflt;
    try { return JSON.parse(r.value); } catch { return r.value; }
  } catch { return dflt; }
}
function putSettingRow(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(value), now());
  return value;
}
app.get('/api/guard/settings', async () => ({
  ok: true,
  dedupeRewrite: getSettingRow('dedupe_rewrite', true) !== false,   // 相似度超限自动重写
  autoSend: getSettingRow('auto_send', '1') !== '0',                // 无人值守发布
  protect: getSettingRow('publish_protect', '1') !== '0',           // 发布保护
}));
app.post('/api/guard/settings', async (req) => {
  const b = req.body || {};
  if (b.dedupeRewrite !== undefined) putSettingRow('dedupe_rewrite', !!b.dedupeRewrite);
  if (b.autoSend !== undefined) putSettingRow('auto_send', b.autoSend ? '1' : '0');
  if (b.protect !== undefined) putSettingRow('publish_protect', b.protect ? '1' : '0');
  return {
    ok: true,
    dedupeRewrite: getSettingRow('dedupe_rewrite', true) !== false,
    autoSend: getSettingRow('auto_send', '1') !== '0',
    protect: getSettingRow('publish_protect', '1') !== '0',
  };
});

app.get('/api/health'"""
    I = sub1(I, "app.get('/api/health'", guard, "idx.guard")

    # 生成：没传 schedule 时给「按策略时间表」的建议
    I = sub1(I, "  if (!b.dryRun && b.schedule && Array.isArray(gen.items) && gen.items.length) {",
                """  // 没显式给排期 → 用运营策略里的发布时间表（post_time）给一个建议
  if (!b.dryRun && !b.schedule) {
    try {
      const st = getStrategy();
      const hhmm = (st && st.postTime) || '';
      if (hhmm) {
        const d = new Date(); d.setDate(d.getDate() + 1);
        const p = (n) => String(n).padStart(2, '0');
        gen.suggestedSchedule = { startDate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: hhmm, fromStrategy: true };
      }
    } catch { /* ignore */ }
  }
  if (!b.dryRun && b.schedule && Array.isArray(gen.items) && gen.items.length) {""", "idx.suggest")
save("index.js", I, ["registerKeysApi", "registerKnowledgeApi", "api/guard/settings"])

# ========== 3) comments.js ==========
C = load("comments.js")
if "DEFAULT_FORBIDDEN" not in C:
    C = sub1(C, "export function getForbidden() {",
                """/** 默认禁用词：美业/广告法高危词（首次自动写入，用户可改可加） */
const DEFAULT_FORBIDDEN = [
  '最好', '第一', '唯一', '绝对', '保证', '根治', '永久', '无痛', '零风险', '包治',
  '100%', '百分百', '无效退款', '立竿见影', '立马见效', '最便宜', '最低价', '全网最低',
  '国家级', '顶级', '第一品牌', '专家推荐', '治愈', '治疗', '药效', '特效',
];

export function getForbidden() {""", "cm.defhead")
    C = sub1(C, "export function getForbidden() {\n  return getSetting('forbidden_words', [])",
                "export function getForbidden() {\n  const saved = getSetting('forbidden_words', null);\n  if (!saved || !saved.length) { setSetting('forbidden_words', DEFAULT_FORBIDDEN); return DEFAULT_FORBIDDEN; }\n  return saved", "cm.defbody")
    C = sub1(C, "export function getPersona() {\n  return getSetting('persona_card', {",
                """/* 人设卡 = **评论回复**的人设（跟运营大纲的账号人设不是一回事，但默认继承它，避免两边打架） */
function inheritedPersona() {
  let pos = {};
  try {
    const p = db.prepare('SELECT * FROM positioning ORDER BY id DESC LIMIT 1').get();
    if (p) pos = { persona: p.persona, audience: p.audience, tone: p.tone };
  } catch { /* ignore */ }
  return {
    name: pos.persona || '',
    role: pos.persona ? `${pos.persona}（面向 ${pos.audience || '目标人群'}）` : '',
    tone: pos.tone || '亲切、口语化、像真人回复',
    taboo: [],
    inheritedFrom: 'positioning',
  };
}

export function getPersona() {
  return getSetting('persona_card', {""", "cm.persona")
    C = sub1(C, "export function getPersona() {\n  return getSetting('persona_card', {",
                "export function getPersona() {\n  const saved = getSetting('persona_card', null);\n  if (saved && (saved.name || saved.role || saved.tone)) return saved;\n  return inheritedPersona();\n}\n\nfunction __unusedPersonaDefault() {\n  return ({", "cm.persona2")
    C = sub1(C, "function __unusedPersonaDefault() {\n  return ({", "function __unusedPersonaDefault() {\n  return ({", "noop")
save("comments.js", C, ["DEFAULT_FORBIDDEN", "inheritedPersona", "inheritedFrom"])

# ========== 4) generate.js ==========
G = load("generate.js")
if "dedupe_rewrite" not in G:
    G = sub1(G, "async function enforceDedupe(item, context, keyword = '') {",
                """function dedupeRewriteEnabled() {
  try {
    const r = db.prepare("SELECT value FROM settings WHERE key='dedupe_rewrite'").get();
    return !r || (r.value !== 'false' && r.value !== '0');
  } catch { return true; }
}

async function enforceDedupe(item, context, keyword = '') {
  if (!dedupeRewriteEnabled()) {
    log('info', 'generate', '「相似度超限自动重写」已关闭 → 本条跳过查重重写（仍会记录分数）');
  }""", "gen.gate")
    G = sub1(G, "  if (!dedupeRewriteEnabled()) {\n    log('info', 'generate', '「相似度超限自动重写」已关闭 → 本条跳过查重重写（仍会记录分数）');\n  }",
                "  if (!dedupeRewriteEnabled()) {\n    log('info', 'generate', '「相似度超限自动重写」已关闭 → 本条跳过查重重写（仍会记录分数）');\n    try { return { ...item, dupSkipped: true }; } catch { return item; }\n  }", "gen.gateRet")
    G = sub1(G, "1. 每条标题 ≤ 20 字，要有钩子（疑问式/数字式/结果前置式），口语化，不写广告腔",
                """1. 每条标题 ≤ 20 字，要有钩子（疑问式/数字式/结果前置式），口语化，不写广告腔
1.5 **小红书原生感（硬要求）**：正文大量使用 emoji（每条 6–15 个，放在要点前或句末，如 👇✅😭🥹💄），短句分行（每段 1–3 行），可用 1–2 个颜文字；标题可带 1 个 emoji。不要写成说明书或广告稿""", "gen.emoji")
    G = sub1(G, "【任务】\n生成 ${days} 天 × 每天 ${postsPerDay} 条 = **共 ${total} 条**小红书笔记。",
                """【任务】\n生成 ${days} 天 × 每天 ${postsPerDay} 条 = **共 ${total} 条**小红书笔记。
**选题来源优先级**：若【完整运营策略】里给了「分阶段选题」，**按它的顺序逐条写**（一天一条往前推），不要另起炉灶；策略没写选题时才用下面的七天叙事。""", "gen.topics")
save("generate.js", G, ["dedupeRewriteEnabled", "小红书原生感", "选题来源优先级"])
print("batchB2 完成")
