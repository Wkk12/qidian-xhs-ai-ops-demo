/**
 * 运营大纲（R22）后端
 *  ① 三板块（人物设定 / 目标人群 / 核心要求）—— 读写 positioning 表（和内容生成的参考系是同一份数据）
 *  ② 完整运营策略（怎么做 / 多长时间达到什么目标 / 分阶段 + 每阶段选题）→ strategy 表
 *  ③ AI 对话调整运营方向 —— 对话历史落表（带记忆），AI 返回 {reply, strategy_patch}，
 *     服务端把 patch **真实写进 strategy**（不是只在聊天里说说），并记一条 changelog
 */
import { db, now, log } from './db.js';
import { chat, deepseekReady, parseJson } from './deepseek.js';
import { getPositioning } from './generate.js';

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      how_to      TEXT,            -- 我们应该怎么做
      goals       TEXT,            -- 多长时间达到什么目标
      phases      TEXT,            -- 分阶段策略（JSON：[{name,goal,topics:[]}]）
      source      TEXT,            -- ai | manual | chat
      updated_at  TEXT
    );
    CREATE TABLE IF NOT EXISTS outline_chat (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      role        TEXT,            -- user | assistant
      content     TEXT,
      applied     TEXT,            -- 本轮真实改了什么（JSON）
      created_at  TEXT
    );
  `);
}

function safeParse(s, def) {
  try { const v = JSON.parse(s || 'null'); return v == null ? def : v; } catch { return def; }
}

export function getStrategy() {
  ensureTables();
  const row = db.prepare('SELECT * FROM strategy ORDER BY id DESC LIMIT 1').get();
  if (!row) return { howTo: '', goals: '', phases: [], source: '', updatedAt: null, exists: false };
  const phases = safeParse(row.phases, []);
  return {
    howTo: row.how_to || '',
    goals: row.goals || '',
    phases: Array.isArray(phases) ? phases : [],
    source: row.source || '',
    updatedAt: row.updated_at || null,
    exists: !!(row.how_to || row.goals || (Array.isArray(phases) && phases.length)),
  };
}

/** 保存/增量合并策略（只覆盖传进来的字段） */
export function saveStrategy(patch = {}, source = 'manual') {
  ensureTables();
  const cur = getStrategy();
  const next = {
    howTo: patch.howTo !== undefined ? String(patch.howTo || '') : cur.howTo,
    goals: patch.goals !== undefined ? String(patch.goals || '') : cur.goals,
    phases: patch.phases !== undefined ? (Array.isArray(patch.phases) ? patch.phases : cur.phases) : cur.phases,
  };
  const row = db.prepare('SELECT id FROM strategy ORDER BY id DESC LIMIT 1').get();
  if (row) {
    db.prepare('UPDATE strategy SET how_to=?, goals=?, phases=?, source=?, updated_at=? WHERE id=?')
      .run(next.howTo, next.goals, JSON.stringify(next.phases), source, now(), row.id);
  } else {
    db.prepare('INSERT INTO strategy (how_to, goals, phases, source, updated_at) VALUES (?,?,?,?,?)')
      .run(next.howTo, next.goals, JSON.stringify(next.phases), source, now());
  }
  const changed = [];
  if (patch.howTo !== undefined && String(patch.howTo || '') !== cur.howTo) changed.push('howTo');
  if (patch.goals !== undefined && String(patch.goals || '') !== cur.goals) changed.push('goals');
  if (patch.phases !== undefined) changed.push('phases');
  return { strategy: getStrategy(), changed };
}

/** 给提示词用的策略文本块 */
export function strategyText() {
  const s = getStrategy();
  if (!s.exists) return '（运营策略还没写 —— 只能按三板块与历史数据推进，策略级目标暂缺）';
  const lines = [];
  if (s.howTo) lines.push('【我们应该怎么做】\n' + s.howTo);
  if (s.goals) lines.push('【多长时间达到什么目标】\n' + s.goals);
  if (s.phases.length) {
    lines.push('【分阶段策略】\n' + s.phases.map((p, i) => {
      const topics = Array.isArray(p.topics) && p.topics.length ? `\n    选题：${p.topics.join('、')}` : '';
      return `  第${i + 1}阶段 ${p.name || ''}｜目标：${p.goal || '—'}${topics}`;
    }).join('\n'));
  }
  return lines.join('\n\n');
}

/* ---------------- AI 初稿 ---------------- */

export async function draftStrategy({ userIntent = '' } = {}) {
  if (!deepseekReady()) throw Object.assign(new Error('未配置 DeepSeek API Key'), { status: 400 });
  const p = getPositioning() || {};
  const pillars = Array.isArray(p.pillars) ? p.pillars.map((x) => `${x.name}(${x.ratio}%)`).join('、') : '—';
  const sys = `你是小红书账号增长顾问。给一个美业/化妆培训类账号写一份**完整可执行**的运营策略。
只输出 JSON，不要多余文字，结构：
{"how_to":"我们应该怎么做（3-6 条，分点写，每点一行，讲清内容形态/发布节奏/互动方式/转化动作）",
 "goals":"多长时间达到什么目标（用阶段时间+可量化指标，例如 30 天：涨粉 300、单篇收藏率 3%）",
 "phases":[{"name":"第一阶段（第1-2周）","goal":"阶段目标","topics":["选题1","选题2","选题3"]}]}
phases 给 3 个阶段，每阶段 3-5 个具体选题（中文、可直接当笔记标题）。`;
  const usr = `账号三板块信息：
- 人物设定：${p.persona || '—'}｜语气：${p.tone || '—'}
- 目标人群：${p.audience || '—'}
- 核心要求：卖点 ${p.selling || '—'}｜转化目标 ${p.goal || '—'}
- 内容支柱占比：${pillars}
${userIntent ? `用户补充要求：${userIntent}` : ''}`;
  const r = await chat([{ role: 'system', content: sys }, { role: 'user', content: usr }], { json: true });
  const j = parseJson(r.content) || {};
  const phases = Array.isArray(j.phases) ? j.phases.map((x) => ({
    name: String(x.name || ''), goal: String(x.goal || ''),
    topics: Array.isArray(x.topics) ? x.topics.map(String) : [],
  })) : [];
  const saved = saveStrategy({ howTo: j.how_to || '', goals: j.goals || '', phases }, 'ai');
  log('info', 'outline', `AI 策略初稿已生成（phases ${phases.length}）`);
  return { ok: true, strategy: saved.strategy, usage: r.usage || null };
}

/* ---------------- AI 对话（带记忆，真实改策略） ---------------- */

export function listChat(limit = 40) {
  ensureTables();
  const rows = db.prepare('SELECT * FROM outline_chat ORDER BY id DESC LIMIT ?').all(Number(limit) || 40);
  return rows.reverse().map((r) => ({
    id: r.id, role: r.role, content: r.content,
    applied: safeParse(r.applied, null), at: r.created_at,
  }));
}

function pushChat(role, content, applied = null) {
  ensureTables();
  db.prepare('INSERT INTO outline_chat (role,content,applied,created_at) VALUES (?,?,?,?)')
    .run(role, String(content || ''), applied ? JSON.stringify(applied) : null, now());
}

export async function chatAboutStrategy(message) {
  const msg = String(message || '').trim();
  if (!msg) throw Object.assign(new Error('请先输入你想调整的方向'), { status: 400 });
  if (!deepseekReady()) throw Object.assign(new Error('未配置 DeepSeek API Key'), { status: 400 });
  pushChat('user', msg);

  // 记忆：带入最近 12 条真实对话（多轮上下文）
  const history = listChat(12).map((m) => ({ role: m.role, content: m.content }));
  const p = getPositioning() || {};
  const sys = `你是小红书账号运营顾问，正在和账号主人一起调整运营方向。
你手上已经有**当前策略**和**账号三板块信息**，对话要有记忆：主人前面提过的要求必须继续遵守。
要求：
1. 用中文、口语化、不超过 120 字回答，直接给结论和下一步动作。
2. 如果主人这轮的要求需要改策略，就在 JSON 里给出 strategy_patch（只放需要改的字段），否则 strategy_patch 为 null。
3. 只输出 JSON：{"reply":"给主人的回答","strategy_patch":{"how_to":"(可选)","goals":"(可选)","phases":[{"name":"","goal":"","topics":[]}](可选)}}

【当前策略】
${strategyText()}

【三板块】
人物设定：${p.persona || '—'}｜语气：${p.tone || '—'}
目标人群：${p.audience || '—'}
核心要求：卖点 ${p.selling || '—'}｜转化目标 ${p.goal || '—'}`;

  const r = await chat([{ role: 'system', content: sys }, ...history], { json: true, maxTokens: 1500 });
  const j = parseJson(r.content) || {};
  const reply = String(j.reply || r.content || '').trim();
  let applied = null;
  const patch = j.strategy_patch;
  if (patch && typeof patch === 'object') {
    const norm = {};
    if (patch.how_to !== undefined) norm.howTo = String(patch.how_to || '');
    if (patch.goals !== undefined) norm.goals = String(patch.goals || '');
    if (Array.isArray(patch.phases)) {
      norm.phases = patch.phases.map((x) => ({
        name: String(x.name || ''), goal: String(x.goal || ''),
        topics: Array.isArray(x.topics) ? x.topics.map(String) : [],
      }));
    }
    if (Object.keys(norm).length) {
      const s = saveStrategy(norm, 'chat');
      applied = { fields: s.changed, at: now() };
      log('info', 'outline', `AI 对话真实改策略：${s.changed.join(',') || '(无变化)'}`);
    }
  }
  pushChat('assistant', reply, applied);
  return { ok: true, reply, applied, strategy: getStrategy(), usage: r.usage || null };
}

export function resetChat() {
  ensureTables();
  db.prepare('DELETE FROM outline_chat').run();
  return { ok: true, cleared: true };
}

/* ---------------- 路由 ---------------- */

export async function registerOutlineApi(app) {
  ensureTables();

  // 运营大纲总览：三板块 + 完整策略（前端一屏取齐）
  app.get('/api/outline', async () => {
    const row = db.prepare('SELECT * FROM positioning ORDER BY id DESC LIMIT 1').get();
    const pillars = safeParse(row?.pillars, []);
    return {
      ok: true,
      positioning: row ? { ...row, pillars } : null,
      strategy: getStrategy(),
    };
  });

  // 三板块保存（人物设定 / 目标人群 / 核心要求）
  app.post('/api/outline/positioning', async (req) => {
    const b = req.body || {};
    const cur = db.prepare('SELECT * FROM positioning ORDER BY id DESC LIMIT 1').get();
    const cols = ['persona', 'audience', 'tone', 'selling', 'goal'];
    const vals = cols.map((k) => (b[k] !== undefined ? String(b[k] || '') : (cur?.[k] || '')));
    const pillars = b.pillars !== undefined
      ? JSON.stringify(Array.isArray(b.pillars) ? b.pillars : safeParse(cur?.pillars, []))
      : (cur?.pillars || '[]');
    if (cur) {
      db.prepare(`UPDATE positioning SET persona=?, audience=?, tone=?, selling=?, goal=?, pillars=?, updated_at=? WHERE id=?`)
        .run(...vals, pillars, now(), cur.id);
    } else {
      db.prepare(`INSERT INTO positioning (persona, audience, tone, selling, goal, pillars, updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(...vals, pillars, now());
    }
    return { ok: true };
  });

  // 完整策略：保存 / 读取
  app.post('/api/outline/strategy', async (req) => {
    const b = req.body || {};
    const r = saveStrategy({ howTo: b.howTo, goals: b.goals, phases: b.phases }, 'manual');
    return { ok: true, ...r };
  });

  // AI 生成完整策略初稿
  app.post('/api/outline/strategy/generate', async (req) => {
    const r = await draftStrategy({ userIntent: (req.body || {}).userIntent || '' });
    return r;
  });

  // AI 对话（带记忆；每轮会把 patch 真实写进策略）
  app.get('/api/outline/chat', async (req) => ({ ok: true, items: listChat(Number((req.query || {}).limit) || 40) }));
  app.post('/api/outline/chat', async (req) => chatAboutStrategy((req.body || {}).message));
  app.delete('/api/outline/chat', async () => resetChat());
}
