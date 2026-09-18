/**
 * 对标账号监控（R11）
 *
 * 数据来源：`trends`（热榜抓取结果）按作者聚合。
 * 局限：MCP 无「按作者拉笔记」接口 → 只能从搜索结果的作者分布推断，
 *       并用「搜索作者昵称」做补充验证（enrich）。
 *
 * 6 维度（见 01-spec R11）：
 *   ① 更新频率  ② 爆款率  ③ 题材分布  ④ 发布时段  ⑤ 互动结构  ⑥ 标题句式
 */
import { db, now, log } from './db.js';
import { mcp } from './mcp.js';

const DEFAULT_THRESHOLD = 3;
const MIN_CANDIDATES = 5;
const MAX_CANDIDATES = 8;

/* ---------------- 发现：从热榜聚合作者 ---------------- */

function aggregate({ threshold }) {
  const rows = db.prepare(`
    SELECT author, author_id,
           COUNT(*)                        AS notes,
           SUM(liked)                      AS liked,
           SUM(collected)                  AS collected,
           SUM(commented)                  AS commented,
           GROUP_CONCAT(DISTINCT keyword)  AS keywords
    FROM trends
    WHERE author IS NOT NULL AND author <> ''
    GROUP BY author_id
    HAVING notes >= ?
    ORDER BY notes DESC, (SUM(liked) + SUM(collected) * 1.5 + SUM(commented) * 2) DESC
  `).all(threshold);
  return rows.map((r) => ({
    authorId: r.author_id,
    nickname: r.author,
    notes: r.notes,
    liked: r.liked || 0,
    collected: r.collected || 0,
    commented: r.commented || 0,
    keywords: (r.keywords || '').split(',').filter(Boolean),
    score: (r.liked || 0) + (r.collected || 0) * 1.5 + (r.commented || 0) * 2,
  }));
}

/**
 * 发现对标账号候选
 * @param {{threshold?:number, min?:number, max?:number}} opt
 */
export function discover({ threshold = DEFAULT_THRESHOLD, min = MIN_CANDIDATES, max = MAX_CANDIDATES } = {}) {
  const totalNotes = db.prepare('SELECT COUNT(*) AS c FROM trends').get().c;
  const keywords = db.prepare('SELECT COUNT(DISTINCT keyword) AS c FROM trends').get().c;

  let used = threshold;
  let cands = aggregate({ threshold: used });
  const relaxed = [];

  // 数据量不足时逐级降阈值（最低 2），并记录实际使用的阈值
  while (cands.length < min && used > 2) {
    used -= 1;
    relaxed.push(used);
    cands = aggregate({ threshold: used });
  }

  const already = new Set(db.prepare('SELECT user_id FROM competitors').all().map((r) => r.user_id));
  const fresh = cands.filter((c) => !already.has(c.authorId));

  return {
    ok: true,
    totalTrendNotes: totalNotes,
    keywords,
    thresholdAsked: threshold,
    thresholdUsed: used,
    relaxed: relaxed.length > 0,
    candidates: fresh.slice(0, max),
    allMatched: cands.length,
    note: cands.length < min
      ? `当前热榜只有 ${totalNotes} 条 / ${keywords} 个关键词，达标作者仅 ${cands.length} 个（目标 ${min}–${max}）。建议先多抓几个关键词。`
      : (relaxed.length ? `数据量有限，阈值已从 ${threshold} 放宽到 ${used}` : ''),
  };
}

/* ---------------- 6 维度分析 ---------------- */

function parseHour(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (m) return Number(m[1]);
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

function titleStyle(t) {
  const s = String(t || '');
  if (/[?？]|吗|怎么|如何|是不是|有没有|为什么/.test(s)) return '疑问式';
  if (/\d/.test(s)) return '数字式';
  if (/^[【\[]/.test(s)) return '标签式';
  return '陈述式';
}

/** 单账号 6 维度分析（基于其热榜笔记） */
export function analyzeAuthor(authorId) {
  const rows = db.prepare(`
    SELECT note_id, title, keyword, liked, collected, commented, note_time
    FROM trends WHERE author_id = ?
  `).all(authorId);
  if (!rows.length) return { ok: false, error: '该账号在热榜里没有笔记样本' };

  const total = rows.length;
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

  // ① 更新频率
  const times = rows.map((r) => r.note_time).filter(Boolean)
    .map((t) => new Date(String(t).replace(' ', 'T'))).filter((d) => !Number.isNaN(d.getTime()));
  let freq = { value: null, text: '数据不足（缺发布时间）' };
  if (times.length >= 2) {
    const spanDays = (Math.max(...times) - Math.min(...times)) / 86400000;
    if (spanDays > 0) {
      const perWeek = (times.length / spanDays) * 7;
      freq = { value: Number(perWeek.toFixed(1)), unit: '条/周', text: `${perWeek.toFixed(1)} 条/周（样本 ${times.length} 条 / ${spanDays.toFixed(0)} 天）` };
    }
  }
  if (freq.value === null) freq = { value: null, text: `样本 ${total} 条，且缺发布时间，无法算频率` };

  // ② 爆款率（互动量 ≥ 全局 80 分位）
  const allLiked = db.prepare('SELECT liked FROM trends WHERE liked IS NOT NULL ORDER BY liked').all().map((r) => r.liked);
  const p80 = allLiked.length ? allLiked[Math.floor(allLiked.length * 0.8)] : 0;
  const hits = rows.filter((r) => (r.liked || 0) >= p80).length;
  const hitRate = total ? hits / total : 0;

  // ③ 题材分布
  const kwMap = new Map();
  for (const r of rows) kwMap.set(r.keyword, (kwMap.get(r.keyword) || 0) + 1);
  const topics = [...kwMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ keyword: k, count: n, percent: Math.round((n / total) * 100) }));

  // ④ 发布时段
  const hours = rows.map((r) => parseHour(r.note_time)).filter((h) => h !== null);
  const hourMap = new Map();
  for (const h of hours) hourMap.set(h, (hourMap.get(h) || 0) + 1);
  const slots = [...hourMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([h, n]) => ({ hour: `${String(h).padStart(2, '0')}:00`, count: n }));
  const bestHour = slots.length ? slots[0].hour : null;

  // ⑤ 互动结构
  const L = sum('liked') || 0, C = sum('collected') || 0, M = sum('commented') || 0;
  const structure = {
    avgLiked: total ? Math.round(L / total) : 0,
    collectRate: L ? Number((C / L).toFixed(2)) : 0,
    commentRate: L ? Number((M / L).toFixed(3)) : 0,
    text: L ? `收藏/点赞 ${(C / L * 100).toFixed(0)}% · 评论/点赞 ${(M / L * 100).toFixed(1)}%` : '无互动数据',
  };

  // ⑥ 标题句式
  const styleMap = new Map();
  for (const r of rows) {
    const s = titleStyle(r.title);
    styleMap.set(s, (styleMap.get(s) || 0) + 1);
  }
  const styles = [...styleMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([s, n]) => ({ style: s, count: n, percent: Math.round((n / total) * 100) }));

  return {
    ok: true,
    authorId,
    sampleSize: total,
    frequency: freq,
    hitRate: { value: Number(hitRate.toFixed(2)), percent: Math.round(hitRate * 100), threshold: p80, text: `${hits}/${total} 条进入全站前 20%（点赞 ≥${p80}）` },
    topics,
    slots,
    bestHour,
    structure,
    styles,
    topNotes: rows.slice().sort((a, b) => (b.liked || 0) - (a.liked || 0)).slice(0, 3)
      .map((r) => ({ title: r.title, liked: r.liked, keyword: r.keyword })),
    analyzedAt: now(),
  };
}

/* ---------------- 关注列表管理 ---------------- */

export function listCompetitors() {
  const rows = db.prepare('SELECT * FROM competitors ORDER BY created_at DESC').all();
  return rows.map((r) => {
    const stats = db.prepare(`
      SELECT COUNT(*) AS n, COALESCE(SUM(liked),0) AS liked
      FROM trends WHERE author_id = ?
    `).get(r.user_id);
    return {
      id: r.id, userId: r.user_id, nickname: r.nickname, note: r.note,
      createdAt: r.created_at, sampleSize: stats.n, totalLiked: stats.liked,
      status: stats.n > 0 ? 'active' : 'invalid',   // 无样本 → 标注失效（改名/注销）
    };
  });
}

export function addCompetitor({ userId, nickname, note = '' }) {
  if (!userId && !nickname) {
    throw Object.assign(new Error('缺少 userId 或 nickname'), { status: 400 });
  }
  // 没有 userId 时按昵称反查
  let uid = userId;
  let nick = nickname;
  if (!uid && nick) {
    const r = db.prepare('SELECT author_id, author FROM trends WHERE author = ? LIMIT 1').get(nick);
    if (r) { uid = r.author_id; nick = r.author; }
  }
  if (!uid) throw Object.assign(new Error('找不到该账号（热榜里没有它的笔记）'), { status: 404 });

  const exist = db.prepare('SELECT id FROM competitors WHERE user_id = ?').get(uid);
  if (exist) return { ok: true, existing: true, id: exist.id };

  const info = db.prepare('INSERT INTO competitors (user_id, nickname, note, created_at) VALUES (?,?,?,?)')
    .run(uid, nick || '', note, now());
  log('info', 'competitors', `新增对标账号 ${nick} (${uid})`);
  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function removeCompetitor(id) {
  const r = db.prepare('SELECT id FROM competitors WHERE id = ?').get(Number(id));
  if (!r) throw Object.assign(new Error('不存在'), { status: 404 });
  db.prepare('DELETE FROM competitors WHERE id = ?').run(Number(id));
  return { ok: true };
}

/** 批量分析（供页面一次取全） */
export function analyzeAll() {
  const list = listCompetitors();
  return list.map((c) => ({
    ...c,
    analysis: c.sampleSize > 0 ? analyzeAuthor(c.userId) : { ok: false, error: '无样本' },
  }));
}

/** 用昵称搜索补充该账号的样本（加样本，不加新作者） */
export async function enrich(nickname, limit = 20) {
  try {
    const r = await mcp.search(nickname);
    const feeds = r?.data?.feeds || [];
    const ins = db.prepare(`INSERT INTO trends
      (keyword, note_id, title, author, author_id, liked, collected, commented, cover, url, note_time, xsec_token, scraped_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(note_id) DO UPDATE SET xsec_token=excluded.xsec_token, liked=excluded.liked`);
    let added = 0, matched = 0;
    for (const f of feeds) {
      const nc = f.noteCard || {};
      const ui = nc.user || {};
      if (ui.nickname !== nickname) continue;      // 只收该账号自己的
      matched++;
      const id = f.id;
      const info = ins.run(nickname, id, nc.displayTitle || '', ui.nickname || '', ui.userId || '',
        Number(nc.interactInfo?.likedCount) || 0, 0, 0,
        nc.cover?.urlDefault || '', `https://www.xiaohongshu.com/explore/${id}`,
        '', f.xsecToken || '', now());
      if (info.changes > 0) added++;
    }
    return { ok: true, fetched: feeds.length, matched, added };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 120) };
  }
}

/* ---------------- 深度分析：拉详情补发布时间 ---------------- */

/** ms 时间戳 → 本地 ISO 字符串 */
function msToISO(ms) {
  const n = Number(ms);
  if (!n || Number.isNaN(n)) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/**
 * 拉取该账号笔记的详情，补齐发布时间（note_time）。
 *
 * 为什么必须这么做：MCP 的**搜索结果不含时间字段**（只有 type/displayTitle/user/
 * interactInfo/cover），只有**笔记详情**的 `note.time`（ms）才有发布时间。
 * 代价：1 条详情 ≈13.5 秒，且平台对连续请求限流 → 必须加间隔、限制条数。
 *
 * @param {string} authorId
 * @param {{limit?:number, gapMs?:number}} opt
 */
export async function enrichTimes(authorId, { limit = 3, gapMs = 4500, timeoutMs = 45000 } = {}) {
  const rows = db.prepare(`
    SELECT note_id, title, note_time, xsec_token FROM trends
    WHERE author_id = ? AND (note_time IS NULL OR note_time = '')
    LIMIT ?
  `).all(authorId, limit);

  if (!rows.length) {
    const have = db.prepare("SELECT COUNT(*) AS c FROM trends WHERE author_id = ? AND note_time <> ''").get(authorId).c;
    return { ok: true, needFetch: 0, filled: 0, alreadyHave: have, note: have ? '发布时间已齐全' : '该账号没有样本笔记' };
  }

  const upd = db.prepare('UPDATE trends SET note_time = ? WHERE note_id = ?');
  let filled = 0, failed = 0;
  const errors = [];

  for (const r of rows) {
    try {
      // 尽力而为：详情接口可能很慢/被限流，短超时后跳过，不拖死整个请求
      const d = await mcp.feedDetail(r.note_id, r.xsec_token || '', false, timeoutMs);
      const note = (((d || {}).data || {}).data || d?.data || {}).note || {};
      const iso = msToISO(note.time);
      if (iso) {
        upd.run(iso, r.note_id);
        filled++;
      } else {
        failed++;
        errors.push(`${r.note_id}: 详情里没有 note.time`);
      }
    } catch (e) {
      failed++;
      errors.push(`${r.note_id}: ${String(e.message).slice(0, 60)}`);
    }
    await new Promise((res) => setTimeout(res, gapMs));   // 防风控
  }

  log('info', 'competitors', `深度分析 ${authorId}: 补齐 ${filled} 条发布时间`);
  return {
    ok: true, needFetch: rows.length, filled, failed, errors: errors.slice(0, 3),
    note: filled
      ? `已补齐 ${filled} 条发布时间${failed ? `（${failed} 条失败，多为平台限流/详情过慢）` : ''}`
      : '未取到发布时间 —— 平台详情接口过慢或被限流，属已知限制，稍后可再试',
  };
}
