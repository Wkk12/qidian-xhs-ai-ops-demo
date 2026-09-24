/**
 * 评论自动回复（R14）
 *
 * 规格要点（01-spec R14）：
 *   - 轮询 5 分钟，**纯规则机制监控**（不让 AI 做监控）
 *   - 命中知识库 → AI 生成回复并发送；未命中 → 不回复，进人工待办
 *   - 人设来自「人设卡」，长度 30–60 字
 *   - 禁用词表命中 → 转人工
 *   - 人工介入后 → 对该用户暂停自动回复
 *   - 前 3 天为观察期：全部回复需人工复核后才发送
 *   - 后台静默运行，不装插件、不在前端手动启停
 *   - 回复失败可重试，且**不重复发送同一评论**
 */
import { db, now, log } from './db.js';
import { mcp } from './mcp.js';
import { chat } from './deepseek.js';

export const POLL_MS = 5 * 60 * 1000;      // 5 分钟
export const OBSERVE_DAYS = 3;             // 观察期
const REPLY_MIN = 30, REPLY_MAX = 60;      // 字数要求

/* ---------------- 配置读写（存 settings 表） ---------------- */

function getSetting(key, dflt) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!r) return dflt;
  try { return JSON.parse(r.value); } catch { return r.value; }
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(value), now());
}

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

/** 人设卡（默认给一套美妆/设计接单场景的） */
/**
 * 人设卡 = **评论回复的人设**（只影响自动回复怎么说话），不是账号人设。
 * 账号人设（我是谁/给谁看/核心要求）在「运营大纲 · 三板块」里；
 * 这里没单独设置时，**默认继承运营大纲**，避免两处各说各话。
 */
export function getPersona() {
  const saved = getSetting('persona_card', null);
  if (saved && (saved.name || saved.role || saved.tone)) return { ...saved, scope: 'comment-reply' };
  let pos = {};
  try {
    const p = db.prepare('SELECT * FROM positioning ORDER BY id DESC LIMIT 1').get();
    if (p) pos = p;
  } catch { /* ignore */ }
  return {
    scope: 'comment-reply',
    inheritedFrom: 'positioning',
    name: pos.persona || '绮点',
    role: pos.persona ? `${pos.persona}（面向 ${pos.audience || '目标人群'}）` : '美业/设计内容账号主理人',
    tone: pos.tone || '温柔、专业、像朋友',
    addressForm: '哈喽～',
    taboo: ['不承诺疗效', '不报具体价格', '不贬低同行'],
    sampleReplies: [
      '哈喽～这个可以私信我细聊哦',
      '谢谢喜欢～具体可以私信我哈',
    ],
    enabled: true,
  };
}
export function setPersona(p) { setSetting('persona_card', p); return { ok: true, persona: getPersona() }; }

/** 禁用词表 */
/**
 * 禁用词表（默认给一套专业词表，客户可改可加）
 * 口径：① 广告法绝对化用语 ② 医疗/医美违规表述 ③ 引流与私下交易 ④ 贬低同行
 * 回复里一命中就转人工，绝不自动发出。
 */
export const DEFAULT_FORBIDDEN = [
  // ① 广告法绝对化
  '最好', '最佳', '第一', '唯一', '绝对', '顶级', '国家级', '世界级', '史上最', '全网最低',
  '最便宜', '永久有效', '100%', '百分百', '无一例外', '保证', '包治', '无效退款',
  // ② 医疗 / 医美违规
  '治疗', '治愈', '根治', '药效', '特效', '无痛', '零风险', '立竿见影', '立马见效', '包瘦', '包过',
  // ③ 引流 / 私下交易
  '加微信', '私加', '私下转账', '扫码付款', '加v', '加V', '微信号', '免费送', '返现', '先到先得名额',
  // ④ 贬低同行 / 违规承诺
  '同行不行', '别家都是骗', '正规医院都不敢', '做完就变',
];

export function getForbidden() {
  return getSetting('forbidden_words', DEFAULT_FORBIDDEN);
}
export function setForbidden(list) { setSetting('forbidden_words', list); return { ok: true, words: getForbidden() }; }

/** 观察期（开启自动回复之日起 3 天） */
function observationUntil() {
  let until = getSetting('reply_observation_until', null);
  if (!until) {
    const d = new Date(Date.now() + OBSERVE_DAYS * 86400000);
    until = d.toISOString().slice(0, 10);
    setSetting('reply_observation_until', until);
  }
  return until;
}
function inObservation() {
  return new Date().toISOString().slice(0, 10) < observationUntil();
}

/* ---------------- 人工介入名单 ---------------- */

function ensureTakeoverTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS human_takeover (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT UNIQUE, nickname TEXT, reason TEXT, since TEXT
  );`);
}

export function isTakeover(userId) {
  ensureTakeoverTable();
  return !!db.prepare('SELECT id FROM human_takeover WHERE user_id = ?').get(userId);
}

export function takeover(userId, nickname, reason = '人工回复过') {
  ensureTakeoverTable();
  db.prepare(`INSERT INTO human_takeover (user_id, nickname, reason, since) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason, since=excluded.since`)
    .run(userId, nickname || '', reason, now());
  log('info', 'comments', `人工介入：${nickname} (${userId}) —— 已暂停对该用户自动回复`);
  return { ok: true };
}

export function resumeAuto(userId) {
  ensureTakeoverTable();
  db.prepare('DELETE FROM human_takeover WHERE user_id = ?').run(userId);
  return { ok: true };
}

export function listTakeover() {
  ensureTakeoverTable();
  return db.prepare('SELECT * FROM human_takeover ORDER BY since DESC').all();
}

/* ---------------- 知识库匹配（纯规则，无 AI） ---------------- */

export function matchKnowledge(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const rows = db.prepare('SELECT * FROM knowledge WHERE enabled = 1').all();
  let best = null, bestScore = 0;
  for (const r of rows) {
    let score = 0;
    let kws = [];
    try { kws = JSON.parse(r.keywords || '[]'); } catch { kws = String(r.keywords || '').split(/[,，\s]+/).filter(Boolean); }
    for (const k of kws) {
      const kk = String(k).trim();
      if (kk && t.includes(kk)) score += 3;
    }
    // 问题本身的关键片段命中
    const q = String(r.question || '');
    for (let i = 0; i < q.length - 1; i += 2) {
      const frag = q.slice(i, i + 2);
      if (frag.length === 2 && t.includes(frag)) score += 0.5;
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  // R24：命中的知识来源可追溯（'library' = 来自「资料库」上传的文档）
  return bestScore >= 1.5 ? { item: best, score: bestScore, source: best.source || 'manual' } : null;
}

/* ---------------- 回复生成 ---------------- */

function hitForbidden(text) {
  const words = getForbidden();
  return words.filter((w) => w && String(text).includes(String(w)));
}

async function generateReply({ comment, knowledge, persona }) {
  const r = await chat([
    {
      role: 'system',
      content: `你是「${persona.name}」，${persona.role}。语气：${persona.tone}。
回复小红书评论区的留言。硬性要求：
1. 长度 ${REPLY_MIN}–${REPLY_MAX} 字（中文字符计）
2. 口语化、有温度，不要客服腔、不要"亲"
3. **只依据给定知识库内容回答**，知识库没说的绝不编造
4. 禁止出现：${(persona.taboo || []).join('、')}
5. 不要放任何链接、不要留联系方式、不要报价
只输出回复正文，不要引号、不要解释。`,
    },
    {
      role: 'user',
      content: `【用户评论】${comment}
【知识库命中问题】${knowledge.question}
【知识库答案】${knowledge.answer}`,
    },
  ], { maxTokens: 400, temperature: 0.8, timeout: 60000 });
  return String(r.content || '').trim().replace(/^["'「]|["'」]$/g, '');
}

/* ---------------- 单条评论处理 ---------------- */

function saveComment({ noteId, noteTitle, commentId, userId, userName, content, replyText, status, skipReason }) {
  const exist = db.prepare('SELECT id, replied, reply_status FROM comments WHERE comment_id = ?').get(commentId);
  if (exist) return { existing: true, id: exist.id, status: exist.reply_status };
  const info = db.prepare(`INSERT INTO comments
    (note_id, comment_id, user_name, content, replied, reply_text, reply_status, created_at, note_title, user_id, skip_reason, replied_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(noteId, commentId, userName, content, status === 'auto' ? 1 : 0,
         replyText || '', status, now(), noteTitle || '', userId || '', skipReason || '',
         status === 'auto' ? now() : null);
  return { existing: false, id: Number(info.lastInsertRowid), status };
}

/** 处理一条通知评论（规则决策，不靠 AI 判断） */
export async function handleComment(n) {
  const cid = n.comment_id || n.id;
  const content = n.comment_text || '';
  const userId = n.from?.user_id || '';
  const userName = n.from?.nickname || '';
  const noteId = n.feed_id || '';
  const noteTitle = n.feed_title || '';

  const dup = db.prepare('SELECT id, reply_status FROM comments WHERE comment_id = ?').get(cid);
  if (dup) return { ok: true, skipped: 'duplicate', commentId: cid, status: dup.reply_status };

  // ① 人工介入名单 → 不自动回
  if (isTakeover(userId)) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, status: 'skipped', skipReason: '该用户已人工介入' });
    return { ok: true, decision: 'skipped', reason: '人工介入名单' };
  }

  // ② 知识库匹配（纯规则）
  const hit = matchKnowledge(content);
  if (!hit) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, status: 'pending_review', skipReason: '知识库未命中' });
    return { ok: true, decision: 'pending_review', reason: '知识库未命中 → 进人工待办，不自动回复' };
  }

  // ③ 生成回复
  let reply = '';
  try {
    reply = await generateReply({ comment: content, knowledge: hit.item, persona: getPersona() });
  } catch (e) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, status: 'pending_review', skipReason: 'AI 生成失败: ' + String(e.message).slice(0, 60) });
    return { ok: false, decision: 'pending_review', reason: 'AI 生成失败' };
  }
  if (!reply) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, status: 'pending_review', skipReason: 'AI 返回空' });
    return { ok: false, decision: 'pending_review', reason: 'AI 返回空' };
  }

  // ④ 禁用词检查
  const bad = hitForbidden(reply);
  if (bad.length) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, replyText: reply, status: 'pending_review', skipReason: '禁用词命中: ' + bad.join(',') });
    return { ok: true, decision: 'pending_review', reason: `禁用词命中（${bad.join(',')}）→ 转人工` };
  }

  // ⑤ 观察期 → 需人工复核后才发
  if (inObservation()) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, replyText: reply, status: 'pending_review', skipReason: `观察期内（至 ${observationUntil()}）需人工复核` });
    return { ok: true, decision: 'pending_review', reason: `观察期内（至 ${observationUntil()}）` };
  }

  // ⑤.5 R23：自动回复总开关（关 → 只生成不发送，转人工待办）
  if (!isReplyEnabled()) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, replyText: reply, status: 'pending_review', skipReason: '自动回复开关已关闭 → 转人工确认' });
    return { ok: true, decision: 'pending_review', reason: '自动回复开关已关闭（回复已生成，等人工发）' };
  }

  // ⑥ 发送
  const sent = await sendReply({ commentId: cid, noteId, content: reply });
  if (sent.ok) {
    saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, replyText: reply, status: 'auto' });
    return { ok: true, decision: 'auto', reply };
  }
  saveComment({ noteId, noteTitle, commentId: cid, userId, userName, content, replyText: reply, status: 'pending_review', skipReason: '发送失败: ' + String(sent.error).slice(0, 60) });
  return { ok: false, decision: 'pending_review', reason: '发送失败', error: sent.error };
}

/** 真正发送回复（会发到平台） */
export async function sendReply({ commentId, noteId, content }) {
  try {
    const r = await mcp.notificationsReply({ commentId, noteId, content });
    const okFlag = r?.success !== false;
    log('info', 'comments', `回复成功 ${commentId}`);
    return { ok: okFlag, raw: r, error: okFlag ? null : (r?.message || '平台未确认') };
  } catch (e) {
    log('error', 'comments', `回复失败 ${commentId}: ${e.message}`);
    return { ok: false, error: String(e.message).slice(0, 120) };
  }
}

/* ---------------- 轮询（纯规则监控） ---------------- */

let polling = false;

/** 跑一轮：拉通知 → 逐条按规则处理 */
export async function pollOnce({ tab = 'mentions', limit = 20 } = {}) {
  if (polling) return { ok: false, busy: true };
  polling = true;
  const result = { ok: true, fetched: 0, handled: 0, byDecision: {}, errors: [] };
  try {
    const r = await mcp.notificationsList({ tab, limit });
    const items = r?.data?.data?.items || r?.data?.items || [];
    result.fetched = items.length;
    for (const n of items) {
      if (n.type && n.type !== 'comment/item' && !n.comment_id) continue;
      try {
        const h = await handleComment(n);
        if (h.skipped === 'duplicate') continue;
        result.handled++;
        const k = h.decision || 'unknown';
        result.byDecision[k] = (result.byDecision[k] || 0) + 1;
      } catch (e) {
        result.errors.push(String(e.message).slice(0, 80));
      }
      await new Promise((res) => setTimeout(res, 800));   // 温柔点，防风控
    }
    log('info', 'comments', `轮询完成：拉取 ${result.fetched}，处理 ${result.handled}`);
  } catch (e) {
    result.ok = false;
    result.errors.push(String(e.message).slice(0, 120));
  } finally {
    polling = false;
  }
  return result;
}

/** 后台静默轮询（不装插件、不在前端启停） */
export function startPoller() {
  setInterval(() => { pollOnce().catch(() => {}); }, POLL_MS);
  log('info', 'comments', `评论轮询已启动（每 ${POLL_MS / 60000} 分钟，纯规则监控）`);
}

/* ---------------- 人工待办操作 ---------------- */

export function listComments({ status, limit = 100 } = {}) {
  const sql = status
    ? 'SELECT * FROM comments WHERE reply_status = ? ORDER BY id DESC LIMIT ?'
    : 'SELECT * FROM comments ORDER BY id DESC LIMIT ?';
  return status ? db.prepare(sql).all(status, limit) : db.prepare(sql).all(limit);
}

/** 人工确认发送（观察期/待办里的回复） */
export async function approveComment(id) {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('不存在'), { status: 404 });
  if (!c.reply_text) throw Object.assign(new Error('这条还没有生成回复内容'), { status: 400 });
  if (c.replied) return { ok: true, already: true };
  const sent = await sendReply({ commentId: c.comment_id, noteId: c.note_id, content: c.reply_text });
  if (!sent.ok) throw Object.assign(new Error(sent.error || '发送失败'), { status: 502 });
  db.prepare("UPDATE comments SET replied = 1, reply_status = 'manual', replied_at = ? WHERE id = ?").run(now(), Number(id));
  return { ok: true };
}

/** 人工直接回复（并自动把该用户加入介入名单） */
export async function manualReply(id, text) {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(id));
  if (!c) throw Object.assign(new Error('不存在'), { status: 404 });
  const content = String(text || '').trim();
  if (!content) throw Object.assign(new Error('回复内容不能为空'), { status: 400 });
  const sent = await sendReply({ commentId: c.comment_id, noteId: c.note_id, content });
  if (!sent.ok) throw Object.assign(new Error(sent.error || '发送失败'), { status: 502 });
  db.prepare("UPDATE comments SET replied = 1, reply_text = ?, reply_status = 'manual', replied_at = ? WHERE id = ?").run(content, now(), Number(id));
  takeover(c.user_id, c.user_name, '人工回复过');
  return { ok: true, takeover: true };
}

export function statsComments() {
  const rows = db.prepare('SELECT reply_status AS s, COUNT(*) AS n FROM comments GROUP BY reply_status').all();
  const out = { total: 0 };
  for (const r of rows) { out[r.s] = r.n; out.total += r.n; }
  out.observationUntil = observationUntil();
  out.inObservation = inObservation();
  out.takeoverCount = listTakeover().length;
  return out;
}
