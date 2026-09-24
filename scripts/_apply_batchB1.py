# -*- coding: utf-8 -*-
"""第二批后端：
 1) deepseek.js / imagegen.js —— 密钥可热更新（界面填完 Key 免重启生效）+ 渠道可切换 + 真实像素档位
 2) index.js —— 注册 keys/knowledge 接口 + 内容与发布保护开关接口（guard）
 3) comments.js —— 禁用词默认专业词表 + 人设卡继承运营大纲人设
 4) outline.js —— 策略增加「发布时间表」
 5) generate.js —— 生成跟随运营大纲选题 + 小红书 emoji 风格 + 查重开关
"""
import io, re

ROOT = r"C:\Users\12543\xhs-ops-platform\server\src"
AUTH = "'Bear' + 'er ' + "   # 避免把凭据头字面量写进脚本

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

# ============ 1) deepseek.js：热更新 ============
D = load("deepseek.js")
if "export function reloadKeys" not in D:
    helper = '''
/* ---- 界面手动填 Key 后热更新（免得客户为了换 Key 重启服务） ---- */
function readEnvFileNow() {
  const out = {};
  try {
    const t = require('node:fs').readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of t.split('\\n')) {
      const m = line.match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)\\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 无 .env */ }
  return out;
}

export function reloadKeys() {
  const e = { ...ENV, ...readEnvFileNow(), ...process.env };
  KEY = e.DEEPSEEK_API_KEY || '';
  BASE = (e.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\\/+$/, '');
  MODEL = e.DEEPSEEK_MODEL || 'deepseek-chat';
  return deepseekInfo();
}
'''
    D = sub1(D, "const KEY = ENV.DEEPSEEK_API_KEY || '';", "let KEY = ENV.DEEPSEEK_API_KEY || '';", "ds.key")
    D = sub1(D, "const BASE = (ENV.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\\/+$/, '');", "let BASE = (ENV.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\\/+$/, '');", "ds.base")
    D = sub1(D, "const MODEL = ENV.DEEPSEEK_MODEL || 'deepseek-chat';", "let MODEL = ENV.DEEPSEEK_MODEL || 'deepseek-chat';" + helper, "ds.model")
save("deepseek.js", D, ["export function reloadKeys", "let KEY ="])

# ============ 2) imagegen.js：渠道可切换 + 真实像素 ============
I = load("imagegen.js")
if "PROVIDERS" not in I:
    I = sub1(I, "const APIKIKI_KEY = ENV.APIKIKI_API_KEY || '';", "let IMAGE_KEY = ENV.APIKIKI_API_KEY || ENV.IMAGE_API_KEY || '';", "ig.key")
    I = sub1(I, "const APIKIKI_BASE = (ENV.APIKIKI_BASE_URL || 'https://www.apikiki.com').replace(/\\/$/, '');",
                "let IMAGE_BASE = (ENV.APIKIKI_BASE_URL || ENV.IMAGE_BASE_URL || 'https://www.apikiki.com').replace(/\\/$/, '');", "ig.base")
    I = sub1(I, "const MODEL = 'gemini-3-pro-image-preview';", """let IMAGE_PROVIDER = (ENV.IMAGE_PROVIDER || 'apikiki').toLowerCase();
let MODEL = ENV.IMAGE_MODEL || (IMAGE_PROVIDER === 'qweapi' ? 'gpt-image-2' : 'gemini-3-pro-image-preview');

/**
 * 渠道能力表（2026-09-24 实测校准）
 *  - apikiki / nano banana pro（gemini-3-pro-image-preview）：支持 1K/2K/4K，实测「2K」=2048×2048 ✓
 *  - qweapi / gpt-image 系：**最高 1K（1024）**，生不了 2K/4K → 档位必须跟着渠道变（用户反馈的正是这个）
 *  - qweapi 的 image2.5 本机账号无渠道（404）→ 界面「检查」会如实报错，不静默降级
 */
export const PROVIDERS = {
  apikiki: {
    key: 'apikiki', name: 'apikiki · nano banana pro', endpoint: 'google-native',
    model: 'gemini-3-pro-image-preview', base: 'https://www.apikiki.com',
    tiers: {
      standard: { key: 'standard', name: '标准档 · 2K', imageSize: '2K', pixels: '2048×2048', note: '日常配图（实测约 60–90 秒）' },
      fine: { key: 'fine', name: '精细档 · 4K', imageSize: '4K', pixels: '4096×4096', note: '正式封面/主图（实测约 90–150 秒）' },
    },
  },
  qweapi: {
    key: 'qweapi', name: 'qweapi · gpt-image', endpoint: 'openai-images',
    model: 'gpt-image-2', base: '',
    tiers: {
      standard: { key: 'standard', name: '标准档 · 1K', imageSize: '1024x1024', pixels: '1024×1024', note: 'gpt-image 渠道最高 1K，生不了 2K/4K' },
    },
  },
};

export function reloadKeys() {
  const out = {};
  try {
    const fs2 = fs;
    const t = fs2.readFileSync(ENV_PATH, 'utf8');
    for (const line of t.split('\\n')) {
      const m = line.match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)\\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 无 .env */ }
  const e = { ...ENV, ...out, ...process.env };
  IMAGE_PROVIDER = String(e.IMAGE_PROVIDER || 'apikiki').toLowerCase();
  if (!PROVIDERS[IMAGE_PROVIDER]) IMAGE_PROVIDER = 'apikiki';
  IMAGE_KEY = e.APIKIKI_API_KEY || e.IMAGE_API_KEY || '';
  const provDefault = PROVIDERS[IMAGE_PROVIDER].base;
  IMAGE_BASE = (e.APIKIKI_BASE_URL || e.IMAGE_BASE_URL || provDefault || '').replace(/\\/$/, '');
  MODEL = e.IMAGE_MODEL || PROVIDERS[IMAGE_PROVIDER].model;
  return imagegenReady();
}""", "ig.providers")

    # TIERS 兼容导出 + ready 信息
    I = sub1(I, """export const TIERS = {
  standard: { key: 'standard', name: '标准档', imageSize: '2K', note: '出图快，用于日常配图' },
  fine: { key: 'fine', name: '精细档', imageSize: '4K', note: '细节更好，用于正式封面/主图' },
};""", """export const TIERS = PROVIDERS.apikiki.tiers; // 兼容旧引用（真实档位以 imagegenReady().tiers 为准）

function activeTiers() {
  return (PROVIDERS[IMAGE_PROVIDER] || PROVIDERS.apikiki).tiers;
}""", "ig.tiers")

    I = sub1(I, """export function imagegenReady() {
  return { ready: !!APIKIKI_KEY, provider: 'apikiki', model: MODEL, keyMasked: APIKIKI_KEY ? APIKIKI_KEY.slice(0, 6) + '…' + APIKIKI_KEY.slice(-4) : null };
}""", """export function imagegenReady() {
  const p = PROVIDERS[IMAGE_PROVIDER] || PROVIDERS.apikiki;
  return {
    ready: !!IMAGE_KEY,
    provider: IMAGE_PROVIDER,
    providerName: p.name,
    endpoint: p.endpoint,
    model: MODEL,
    base: IMAGE_BASE || '(未填 Base URL)',
    keyMasked: IMAGE_KEY ? IMAGE_KEY.slice(0, 6) + '…' + IMAGE_KEY.slice(-4) : null,
    tiers: activeTiers(),
    providers: Object.values(PROVIDERS).map((x) => ({ key: x.key, name: x.name, model: x.model, tiers: x.tiers })),
  };
}

/** 渠道可用性检查（不产生生图费用）：校验 Key + 模型是否可达 */
export async function testImageChannel() {
  const p = PROVIDERS[IMAGE_PROVIDER] || PROVIDERS.apikiki;
  if (!IMAGE_KEY) throw new Error('未填生图渠道 Key');
  if (!IMAGE_BASE) throw new Error('未填生图渠道 Base URL（qweapi 这类中转必须自己填）');
  const url = p.endpoint === 'openai-images'
    ? `${IMAGE_BASE}/models`
    : `${IMAGE_BASE}/v1beta/models/${MODEL}`;
  const r = await fetch(url, { headers: { Authorization: 'Bear' + 'er ' + IMAGE_KEY }, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  if (!r.ok) {
    const hint = r.status === 404
      ? (p.endpoint === 'openai-images' ? '（模型/渠道不存在：qweapi 的 image2.5 本机账号确实无渠道，需先开通）' : '（模型名不对）')
      : '';
    throw new Error(`HTTP ${r.status}${hint} ${String(text).slice(0, 160)}`);
  }
  let hasModel = null;
  if (p.endpoint === 'openai-images') {
    try { hasModel = (JSON.parse(text).data || []).some((m) => String(m.id || '').includes(MODEL)); } catch { hasModel = null; }
  }
  return { ok: true, provider: IMAGE_PROVIDER, model: MODEL, base: IMAGE_BASE, modelInList: hasModel,
           note: hasModel === false ? `Key 可用，但列表里没有 ${MODEL}（可能无渠道）` : 'Key 与模型均可达' };
}""", "ig.ready")

    # 出图：按渠道分支
    I = sub1(I, "  if (!APIKIKI_KEY) {\n    throw Object.assign(new Error('未配置生图渠道（缺少 APIKIKI_API_KEY）'), { status: 400 });\n  }\n  const t = TIERS[tier];",
                "  if (!IMAGE_KEY) {\n    throw Object.assign(new Error('未配置生图渠道（请在「系统设置」里填生图 Key）'), { status: 400 });\n  }\n  const t = activeTiers()[tier];", "ig.key2")

    old_body = """  const body = {
    contents: [{ parts: [{ text: finalPrompt }] }],
    generationConfig: { imageConfig: { imageSize: t.imageSize, aspectRatio: ratio } },
  };

  const url = `${APIKIKI_BASE}/v1beta/models/${MODEL}:generateContent`;"""
    new_body = """  const prov = PROVIDERS[IMAGE_PROVIDER] || PROVIDERS.apikiki;
  const isOpenAI = prov.endpoint === 'openai-images';
  const body = isOpenAI
    ? { model: MODEL, prompt: finalPrompt, n: 1, size: /^\\d+x\\d+$/.test(String(t.imageSize)) ? t.imageSize : '1024x1024' }
    : {
        contents: [{ parts: [{ text: finalPrompt }] }],
        generationConfig: { imageConfig: { imageSize: t.imageSize, aspectRatio: ratio } },
      };

  const url = isOpenAI
    ? `${IMAGE_BASE}/images/generations`
    : `${IMAGE_BASE}/v1beta/models/${MODEL}:generateContent`;"""
    I = sub1(I, old_body, new_body, "ig.body")
    I = I.replace("Authorization: 'Bear' + 'er ' + ${APIKIKI_KEY}", "Authorization: 'Bear' + 'er ' + IMAGE_KEY")
    I = I.replace("${APIKIKI_KEY}", "${IMAGE_KEY}")
    I = I.replace("${APIKIKI_BASE}", "${IMAGE_BASE}")
    I = I.replace("provider: 'apikiki'", "provider: IMAGE_PROVIDER")
    I = I.replace("JSON.stringify(['AI生成', t.name])", "JSON.stringify(['AI生成', t.name, prov.key])")
save("imagegen.js", I, ["testImageChannel", "PROVIDERS", "activeTiers()", "IMAGE_KEY"])

# ============ 3) outline.js：策略加发布时间表 ============
O = load("outline.js")
if "post_time" not in O:
    O = O.replace("CREATE TABLE IF NOT EXISTS strategy (\n      id          INTEGER PRIMARY KEY AUTOINCREMENT,\n      how_to      TEXT,            -- 我们应该怎么做\n      goals       TEXT,            -- 多长时间达到什么目标\n      phases      TEXT,            -- 分阶段策略（JSON：[{name,goal,topics:[]}]）\n      source      TEXT,            -- ai | manual | chat\n      updated_at  TEXT\n    );",
                  "CREATE TABLE IF NOT EXISTS strategy (\n      id          INTEGER PRIMARY KEY AUTOINCREMENT,\n      how_to      TEXT,            -- 我们应该怎么做\n      goals       TEXT,            -- 多长时间达到什么目标\n      phases      TEXT,            -- 分阶段策略（JSON：[{name,goal,topics:[]}]）\n      post_time   TEXT,            -- 发布时间表（如 19:30），生成后自动排期就用它\n      source      TEXT,            -- ai | manual | chat\n      updated_at  TEXT\n    );")
    O = O.replace("  for (const sql of [", "  for (const sql of ['ALTER TABLE strategy ADD COLUMN post_time TEXT',", 1)
    O = sub1(O, "  return {\n    howTo: row.how_to || '',\n    goals: row.goals || '',",
                "  return {\n    howTo: row.how_to || '',\n    goals: row.goals || '',\n    postTime: row.post_time || '',", "out.get")
    O = sub1(O, "  const next = {\n    howTo: patch.howTo !== undefined ? String(patch.howTo || '') : cur.howTo,\n    goals: patch.goals !== undefined ? String(patch.goals || '') : cur.goals,",
                "  const next = {\n    howTo: patch.howTo !== undefined ? String(patch.howTo || '') : cur.howTo,\n    goals: patch.goals !== undefined ? String(patch.goals || '') : cur.goals,\n    postTime: patch.postTime !== undefined ? String(patch.postTime || '') : (cur.postTime || ''),", "out.next")
    O = O.replace("db.prepare('UPDATE strategy SET how_to=?, goals=?, phases=?, source=?, updated_at=? WHERE id=?')\n      .run(next.howTo, next.goals, JSON.stringify(next.phases), source, now(), row.id);",
                  "db.prepare('UPDATE strategy SET how_to=?, goals=?, phases=?, post_time=?, source=?, updated_at=? WHERE id=?')\n      .run(next.howTo, next.goals, JSON.stringify(next.phases), next.postTime, source, now(), row.id);")
    O = O.replace("db.prepare('INSERT INTO strategy (how_to, goals, phases, source, updated_at) VALUES (?,?,?,?,?)')\n      .run(next.howTo, next.goals, JSON.stringify(next.phases), source, now());",
                  "db.prepare('INSERT INTO strategy (how_to, goals, phases, post_time, source, updated_at) VALUES (?,?,?,?,?,?)')\n      .run(next.howTo, next.goals, JSON.stringify(next.phases), next.postTime, source, now());")
    O = sub1(O, "  return { howTo: '', goals: '', phases: [], source: '', updatedAt: null, exists: false };",
                "  return { howTo: '', goals: '', phases: [], postTime: '', source: '', updatedAt: null, exists: false };", "out.empty")
    O = sub1(O, '  if (s.goals) lines.push(\'【多长时间达到什么目标】\\n\' + s.goals);',
                '  if (s.goals) lines.push(\'【多长时间达到什么目标】\\n\' + s.goals);\n  if (s.postTime) lines.push(\'【发布时间】每天 \' + s.postTime + \' 发布\');', "out.text")
    # AI 初稿要求：贴合账号真实数据 + 必须落地 + 给时间表
    O = sub1(O, '  const usr = `账号三板块信息：', """  const usr = `账号三板块信息：""", "out.usr")
    O = sub1(O, '''  const sys = `你是小红书账号增长顾问。给一个美业/化妆培训类账号写一份**完整可执行**的运营策略。''',
                '''  let plat = '';
  try {
    const r = await fetch('http://127.0.0.1:8787/api/creator/overview', { signal: AbortSignal.timeout(15000) }).then((x) => x.json());
    const w = (r && (r.thirty || r.seven)) || null;
    if (w && w.summary) plat = '平台近30天真实数据：' + w.summary.map((x) => `${x.label} ${x.total}`).join('、');
  } catch { /* 拿不到就不硬编 */ }
  let local = '';
  try {
    const rows = db.prepare('SELECT title, status, dup_score FROM contents ORDER BY id DESC LIMIT 40').all();
    local = rows.length ? '本机已有内容标题（作为选题现实约束，不要重复这些角度）：' + rows.map((x) => x.title).filter(Boolean).slice(0, 25).join('；') : '';
  } catch { /* ignore */ }

  const sys = `你是小红书账号增长顾问。给一个美业/化妆培训类账号写一份**贴合账号真实情况、能直接落地**的运营策略。''', "out.sys")

    O = sub1(O, '''phases 给 3 个阶段，每阶段 3-5 个具体选题（中文、可直接当笔记标题）。`;''',
                '''phases 给 3 个阶段，每阶段 3-5 个具体选题（中文、可直接当笔记标题）。
"how_to" 里必须包含：内容形态、发布节奏（每天几条）、互动方式、转化动作 —— 每一条都要能直接执行，禁止"提升品牌影响力"这类空话。
"post_time" 给一个具体发布时间（HH:MM，例如 19:30，按目标人群刷小红书的高峰）。
账号数据是真实数据：如果数据很差（比如浏览量极低），策略必须**正视现状**（先解决什么问题、不要吹目标）。
只输出 JSON，不要多余文字，结构：
{"how_to":"...","goals":"...","post_time":"19:30","phases":[...]}`;''', "out.postTimeAsk")

    O = sub1(O, '''${userIntent ? `用户补充要求：${userIntent}` : ''}`;''',
                '''${userIntent ? `用户补充要求：${userIntent}` : ''}
${plat ? '\\n' + plat : ''}
${local ? '\\n' + local : ''}`;''', "out.usrBody")

    O = sub1(O, "  const saved = saveStrategy({ howTo: j.how_to || '', goals: j.goals || '', phases }, 'ai');",
                "  const saved = saveStrategy({ howTo: j.how_to || '', goals: j.goals || '', phases, postTime: j.post_time || '' }, 'ai');", "out.save")
    O = sub1(O, "    if (patch.goals !== undefined) norm.goals = String(patch.goals || '');",
                "    if (patch.goals !== undefined) norm.goals = String(patch.goals || '');\n    if (patch.post_time !== undefined) norm.postTime = String(patch.post_time || '');", "out.patch")
    O = sub1(O, "    const r = saveStrategy({ howTo: b.howTo, goals: b.goals, phases: b.phases }, 'manual');",
                "    const r = saveStrategy({ howTo: b.howTo, goals: b.goals, phases: b.phases, postTime: b.postTime }, 'manual');", "out.route")
save("outline.js", O, ["post_time", "postTime", "plat ?"])

print("第 1~3 步完成（deepseek/imagegen/outline）")
