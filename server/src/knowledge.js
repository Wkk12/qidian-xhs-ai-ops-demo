/**
 * 知识库增强（R25）
 *  ① 上传文档 → AI 自动分析成「能用的知识条目」（Q/A + 关键词），而不是一句原文塞进去
 *  ② 对话框：让 AI 直接跟客户沟通，把知识库补全（每轮真实写库）
 *  ③ 条目可查可删（标清来源：手工 / 资料库 / AI 对话）
 *
 * 回复的知识支撑链路：comments.js 的 matchKnowledge 只读 knowledge 表 →
 *   所以这里是「知识从哪来」的入口，命中判定仍在评论轮询里，未命中一律转人工（不瞎回）
 */
import { db, now, log } from './db.js';
import { chat, deepseekReady, parseJson } from './deepseek.js';
import { getPositioning } from './generate.js';

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chat (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT,
      content    TEXT,
      added      TEXT,      -- 本轮真实写进知识库的条目（JSON）
      created_at TEXT
    );
  `);
  for (const sql of ['ALTER TABLE knowledge ADD COLUMN source TEXT', 'ALTER TABLE knowledge ADD COLUMN doc_id INTEGER']) {
    try { db.exec(sql); } catch { /* 已存在 */ }
  }
}

function pushChat(role, content, added = null) {
  ensureTables();
  db.prepare('INSERT INTO knowledge_chat (role,content,added,created_at) VALUES (?,?,?,?)')
    .run(role, String(content || ''), added ? JSON.stringify(added) : null, now());
}

export function listKnowledgeChat(limit = 40) {
  ensureTables();
  const rows = db.prepare('SELECT * FROM knowledge_chat ORDER BY id DESC LIMIT ?').all(Number(limit) || 40);
  return rows.reverse().map((r) => {
    let added = null;
    try { added = JSON.parse(r.added || 'null'); } catch { added = null; }
    return { id: r.id, role: r.role, content: r.content, added, at: r.created_at };
  });
}

export function resetKnowledgeChat() {
  ensureTables();
  db.prepare('DELETE FROM knowledge_chat').run();
  return { ok: true };
}

/** 关键词提取（与 library 同口径：短实词，便于 includes 命中） */
const STOP = new Set(['我们', '你们', '他们', '这个', '那个', '就是', '但是', '因为', '所以', '如果', '可以', '需要', '进行', '一个', '什么', '怎么', '以及', '还有', '自己', '这样']);
function autoKeywords(text, seed = '') {
  const t = String(text || '').replace(/\s+/g, '');
  const cand = new Map();
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= t.length; i++) {
      const w = t.slice(i, i + n);
      if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(w[0]) || STOP.has(w)) continue;
      cand.set(w, (cand.get(w) || 0) + 1);
    }
  }
  const picked = [];
  for (const [w, c] of [...cand.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)) {
    if (picked.length >= 8) break;
    if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
    picked.push(w);
  }
  return [...new Set([seed, ...picked].filter(Boolean))].slice(0, 10);
}

function insertEntry({ category, question, answer, keywords, source, docId = null }) {
  const kws = Array.isArray(keywords) && keywords.length ? keywords : autoKeywords(`${question}${answer}`);
  const r = db.prepare('INSERT INTO knowledge (category,question,answer,keywords,enabled,created_at,source,doc_id) VALUES (?,?,?,?,1,?,?,?)')
    .run(category || '', question || '', answer || '', JSON.stringify(kws), now(), source || 'manual', docId);
  return Number(r.lastInsertRowid);
}

/** ① 文档 → AI 提炼 Q/A 知识条目 */
export async function analyzeDoc(docId, { max = 15 } = {}) {
  if (!deepseekReady()) throw Object.assign(new Error('未配置 DeepSeek API Key'), { status: 400 });
  ensureTables();
  const doc = db.prepare('SELECT * FROM library_docs WHERE id=?').get(Number(docId));
  if (!doc) throw Object.assign(new Error('资料不存在'), { status: 404 });
  const text = String(doc.text || '').slice(0, 12000);
  if (!text.trim()) throw Object.assign(new Error('这份资料没有解析出文本，无法提炼'), { status: 400 });
  const p = getPositioning() || {};
  const sys = `你在帮一个美业（化妆培训/美容）账号搭建"评论自动回复知识库"。
从资料里提炼出**客户最可能问的问题**和**必须照资料回答的答案**，用于自动回复评论。
规则：
1. 只依据资料内容，不得编造；资料里没有的不要写
2. 答案 40–120 字，口语化、可直接发给客户，不要出现"根据资料"这类话
3. 关键词给 3–6 个短词（客户提问里会出现的词，如"价格""预约""体验课""退款"），用于命中判定
4. 只输出 JSON：{"entries":[{"category":"分类","question":"客户会怎么问","answer":"照资料怎么答","keywords":["词1","词2"]}]}
5. 最多 ${max} 条，宁缺毋滥`;
  const usr = `账号人设：${p.persona || '—'}｜目标人群：${p.audience || '—'}\n资料名：${doc.name}\n资料正文：\n${text}`;
  const r = await chat([{ role: 'system', content: sys }, { role: 'user', content: usr }], { json: true, maxTokens: 3000 });
  const j = parseJson(r.content) || {};
  const entries = Array.isArray(j.entries) ? j.entries : [];
  db.prepare("DELETE FROM knowledge WHERE doc_id=? AND source='library_ai'").run(doc.id);
  let n = 0;
  for (const e of entries.slice(0, max)) {
    if (!String(e.question || '').trim() || !String(e.answer || '').trim()) continue;
    insertEntry({
      category: e.category || ('资料库·' + doc.name),
      question: e.question, answer: e.answer, keywords: e.keywords,
      source: 'library_ai', docId: doc.id,
    });
    n++;
  }
  log('info', 'knowledge', `《${doc.name}》AI 提炼出 ${n} 条知识条目`);
  return { ok: true, docId: doc.id, name: doc.name, added: n, entries: entries.slice(0, n) };
}

/** ② 对话完善知识库：每轮可真实落库 */
export async function chatAboutKnowledge(message) {
  const msg = String(message || '').trim();
  if (!msg) throw Object.assign(new Error('请先输入内容'), { status: 400 });
  if (!deepseekReady()) throw Object.assign(new Error('未配置 DeepSeek API Key'), { status: 400 });
  pushChat('user', msg);

  const history = listKnowledgeChat(12).map((m) => ({ role: m.role, content: m.content }));
  const existing = db.prepare('SELECT category, question FROM knowledge WHERE enabled=1 ORDER BY id DESC LIMIT 60').all();
  const p = getPositioning() || {};
  const sys = `你在帮一个美业账号搭建"评论自动回复知识库"。客户会把店里的实际情况告诉你，你要把它变成能被命中、能直接发出的话术。
要求：
1. 用中文，先给一句确认+追问（不超过 80 字），把没说清的关键信息（价格/时长/预约方式/地址/退改规则）问出来
2. 只把**客户这轮已经明确说出的信息**写成知识条目；猜测的一律不要写
3. 每条：category 分类 / question 客户会怎么问（口语，含关键词）/ answer 照客户说的事实回答（40–120 字）/ keywords 3–6 个短词
4. 没有可落库的信息就给空数组
5. 只输出 JSON：{"reply":"给客户的话","entries":[{"category":"","question":"","answer":"","keywords":[""]}]}

账号人设：${p.persona || '—'}｜人群：${p.audience || '—'}
现有知识条目（避免重复）：${existing.map((x) => x.question).join('；').slice(0, 800) || '（暂无）'}`;

  const r = await chat([{ role: 'system', content: sys }, ...history], { json: true, maxTokens: 2000 });
  const j = parseJson(r.content) || {};
  const reply = String(j.reply || '').trim() || '（AI 没有返回内容）';
  const entries = Array.isArray(j.entries) ? j.entries : [];
  const added = [];
  for (const e of entries.slice(0, 10)) {
    if (!String(e.question || '').trim() || !String(e.answer || '').trim()) continue;
    const id = insertEntry({ category: e.category || 'AI 对话补充', question: e.question, answer: e.answer, keywords: e.keywords, source: 'chat' });
    added.push({ id, question: e.question });
  }
  pushChat('assistant', reply, added.length ? added : null);
  return { ok: true, reply, added, addedCount: added.length };
}

export function listEntries({ source = '', limit = 200 } = {}) {
  ensureTables();
  const rows = source
    ? db.prepare('SELECT * FROM knowledge WHERE source=? ORDER BY id DESC LIMIT ?').all(source, Number(limit))
    : db.prepare('SELECT * FROM knowledge ORDER BY id DESC LIMIT ?').all(Number(limit));
  return rows.map((r) => {
    let kws = [];
    try { kws = JSON.parse(r.keywords || '[]'); } catch { kws = String(r.keywords || '').split(/[,，\s]+/).filter(Boolean); }
    return { ...r, keywords: kws };
  });
}

export function removeEntry(id) {
  ensureTables();
  const r = db.prepare('DELETE FROM knowledge WHERE id=?').run(Number(id));
  return { ok: true, removed: Number(r.changes || 0) };
}

export async function registerKnowledgeApi(app) {
  ensureTables();
  app.get('/api/knowledge/entries', async (req) => ({ ok: true, items: listEntries({ source: (req.query || {}).source || '' }) }));
  app.delete('/api/knowledge/:id', async (req) => removeEntry(req.params.id));
  app.post('/api/library/:id/analyze', async (req) => analyzeDoc(req.params.id, { max: Number((req.body || {}).max) || 15 }));
  app.get('/api/knowledge/chat', async (req) => ({ ok: true, items: listKnowledgeChat(Number((req.query || {}).limit) || 40) }));
  app.post('/api/knowledge/chat', async (req) => chatAboutKnowledge((req.body || {}).message));
  app.delete('/api/knowledge/chat', async () => resetKnowledgeChat());
}
