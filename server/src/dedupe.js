/**
 * 查重门禁（M2.10）
 *
 * 规格（见 09_机制规格书 §6）：
 *   阈值 60%，比对文案库全部历史
 *   四维度加权：标题 30% + 结构 25% + 观点 25% + 表达 20%
 *   两段式：① 字符 bigram 粗筛（快）→ ② 加权精算
 *
 * 纯本地计算，零依赖、零 API 成本。
 */
import { db } from './db.js';

const STOP = new Set([
  '的', '了', '是', '我', '你', '他', '她', '它', '们', '这', '那', '不', '也', '就', '都',
  '和', '与', '在', '有', '会', '要', '把', '被', '给', '对', '从', '到', '而', '但', '还',
  '一个', '什么', '怎么', '可以', '就是', '怎么', '因为', '所以', '如果', '这个', '那个',
]);

/** 归一化：去标点/空格/emoji，只留中英文数字 */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
}

/** 字符 bigram 集合（中文短文本相似度的经典做法） */
function bigrams(s) {
  const t = norm(s);
  const out = new Set();
  if (t.length < 2) {
    if (t) out.add(t);
    return out;
  }
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** 词频向量（用于余弦相似度） */
function tfVector(s) {
  const v = new Map();
  for (const g of bigrams(s)) v.set(g, (v.get(g) || 0) + 1);
  return v;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function cosine(va, vb) {
  if (!va.size || !vb.size) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const [k, x] of va) {
    na += x * x;
    if (vb.has(k)) dot += x * vb.get(k);
  }
  for (const x of vb.values()) nb += x * x;
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 标题相似度（标题短 → bigram + 首尾片段加权） */
function titleSim(t1, t2) {
  const a = bigrams(t1), b = bigrams(t2);
  const base = jaccard(a, b);
  const n1 = norm(t1), n2 = norm(t2);
  if (!n1 || !n2) return base;
  // 前 4 字 / 后 4 字 相同 → 明显重复信号
  const head = n1.slice(0, 4) && n1.slice(0, 4) === n2.slice(0, 4) ? 1 : 0;
  const tail = n1.slice(-4) && n1.slice(-4) === n2.slice(-4) ? 1 : 0;
  return Math.min(1, base * 0.7 + (head + tail) * 0.15);
}

/** 结构相似度：段落数 + 段落长度分布 + 开头句式 */
function structureSim(b1, b2) {
  const paras = (s) => String(s || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const p1 = paras(b1), p2 = paras(b2);
  if (!p1.length || !p2.length) return 0;
  const cntSim = 1 - Math.min(1, Math.abs(p1.length - p2.length) / Math.max(p1.length, p2.length));
  // 段落长度分布（归一化后比较）
  const dist = (ps) => {
    const total = ps.reduce((a, x) => a + x.length, 0) || 1;
    return ps.map((x) => x.length / total);
  };
  const d1 = dist(p1), d2 = dist(p2);
  const L = Math.min(d1.length, d2.length);
  let diff = 0;
  for (let i = 0; i < L; i++) diff += Math.abs(d1[i] - d2[i]);
  const distSim = 1 - Math.min(1, diff);
  // 首段相似（开场白套路）
  const firstSim = jaccard(bigrams(p1[0]), bigrams(p2[0]));
  return Math.min(1, cntSim * 0.3 + distSim * 0.4 + firstSim * 0.3);
}

/** 观点相似度：抽取高频实词（去停用词），比较核心词重叠 */
function keywords(s, topN = 20) {
  const t = norm(s);
  const freq = new Map();
  // 用 2-3 字滑动窗口当"词"的近似
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= t.length; i++) {
      const w = t.slice(i, i + n);
      if (STOP.has(w)) continue;
      if (n === 2 && /^[a-z0-9]+$/.test(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return new Set(
    [...freq.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([w]) => w),
  );
}

function viewpointSim(b1, b2) {
  const k1 = keywords(b1), k2 = keywords(b2);
  return jaccard(k1, k2);
}

/** 表达相似度：全文 bigram 余弦 */
function expressionSim(b1, b2) {
  return cosine(tfVector(b1), tfVector(b2));
}

/**
 * 两条内容的综合相似度（0–1）
 * 权重：标题 0.30 / 结构 0.25 / 观点 0.25 / 表达 0.20
 *
 * ⚠️ 关键修正：导入的历史笔记只有标题、没有正文。
 * 若其中一方正文缺失（<30 字），四维加权会把上限压到 30%，导致"标题完全一样"也判不出来。
 * 这种情况退回「标题单维判定」——标题就是唯一可比的信号。
 */
export function similarity(a, b) {
  const t = titleSim(a.title, b.title);
  const st = structureSim(a.body, b.body);
  const v = viewpointSim(a.body, b.body);
  const e = expressionSim(a.body, b.body);

  const aLen = norm(a.body).length;
  const bLen = norm(b.body).length;
  const bodyUsable = aLen >= 30 && bLen >= 30;

  if (!bodyUsable) {
    return {
      score: Number(t.toFixed(4)),
      parts: { title: Number(t.toFixed(4)), structure: 0, viewpoint: 0, expression: 0 },
      mode: 'title-only',
    };
  }

  const score = t * 0.3 + st * 0.25 + v * 0.25 + e * 0.2;
  return {
    score: Number(score.toFixed(4)),
    parts: {
      title: Number(t.toFixed(4)),
      structure: Number(st.toFixed(4)),
      viewpoint: Number(v.toFixed(4)),
      expression: Number(e.toFixed(4)),
    },
    mode: 'full',
  };
}

/** 粗筛：标题 bigram 有交集才进入精算（性能优化） */
function prefilter(item, cand) {
  const a = bigrams(item.title);
  const b = bigrams(cand.title);
  if (a.size && b.size) {
    for (const x of a) if (b.has(x)) return true;
  }
  // 标题完全没交集时，用正文前 60 字兜底判断
  return jaccard(bigrams(String(item.body || '').slice(0, 60)), bigrams(String(cand.body || '').slice(0, 60))) > 0.15;
}

/**
 * 与文案库比对（排除 excludeId）
 * @returns {{ ok:boolean, score:number, threshold:number, pass:boolean, top:{id,title,score,parts}|null, parts:object }}
 */
export function checkDuplicate(item, { threshold = 0.6, limit = 500, excludeId = null } = {}) {
  const rows = db.prepare(
    `SELECT id, title, body FROM contents
     WHERE (title IS NOT NULL AND title <> '') ${excludeId ? 'AND id <> ?' : ''}
     ORDER BY id DESC LIMIT ?`,
  ).all(...(excludeId ? [excludeId, limit] : [limit]));

  let best = null;
  for (const r of rows) {
    if (!prefilter(item, r)) continue;
    const s = similarity(item, r);
    if (!best || s.score > best.score) best = { id: r.id, title: r.title, ...s };
  }
  const score = best ? best.score : 0;
  return {
    ok: true,
    score,
    threshold,
    pass: score < threshold,
    top: best,
    parts: best ? best.parts : { title: 0, structure: 0, viewpoint: 0, expression: 0 },
    compared: rows.length,
  };
}
