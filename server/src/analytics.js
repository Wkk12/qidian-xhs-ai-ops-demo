/**
 * 数据洞察（R21 后端 —— 接口契约 v0 的 2) / 3)）
 *
 *   GET /api/notes/performance?limit=30   逐篇笔记数据（缺的字段 → null 并记入 missing，不用 0 冒充）
 *   GET /api/analytics/insight            AI 整体数据分析解读 + 高潜内容方向建议（DeepSeek）
 *
 * 数据来源：
 *   performance：contents（含 publish_tasks 回填的 note_id）+ metrics 最新一条 + snapshots 72h 兜底
 *   insight：创作者中心近 30 天（读不到就降级，不失败）+ 本机 metrics/contents/positioning → DeepSeek
 */
import fs from 'node:fs';
import { CREATOR_COOKIE } from './cookie-path.js';
import { db, now, log } from './db.js';
import { chat, parseJson, deepseekReady } from './deepseek.js';

/* ---------------- 工具 ---------------- */

const pad2 = (n) => String(n).padStart(2, '0');

/** 各种时间写法 → YYYY-MM-DD（本地时区）；无法确定返回 null —— 宁可缺，不编 */
function toDateStr(t) {
  if (t === undefined || t === null || t === '') return null;
  const s = String(t).trim();
  let ms = NaN;
  if (/^\d{13}$/.test(s)) ms = Number(s);
  else if (/^\d{10}$/.test(s)) ms = Number(s) * 1000;
  else ms = Date.parse(s.replace(' ', 'T'));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getFullYear();
  if (Number.isNaN(d.getTime()) || y < 2020 || y > 2100) return null;
  return `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 取第一个非 null/undefined 的值（0 是合法值，保留）；全空返回 null */
function firstOf(...xs) {
  for (const x of xs) if (x !== undefined && x !== null) return x;
  return null;
}

const orNull = (v) => (v === undefined ? null : v);

/* ---------------- 契约 3：逐篇笔记数据 ---------------- */

function listNotesPerformance(limit) {
  // 平台侧真实笔记 = contents 里有 note_id 的（历史导入）+ 发布完成回填在 publish_tasks 里的
  const rows = db.prepare(`
    SELECT c.id, c.title,
           COALESCE(NULLIF(c.note_id, ''), (
             SELECT t.note_id FROM publish_tasks t
             WHERE t.content_id = c.id AND t.status = 'done'
               AND t.note_id IS NOT NULL AND t.note_id <> ''
             ORDER BY t.id DESC LIMIT 1
           )) AS note_id
    FROM contents c
    WHERE (c.note_id IS NOT NULL AND c.note_id <> '') OR c.status = 'published'
    ORDER BY c.id DESC
    LIMIT ?
  `).all(limit);

  const getM = db.prepare('SELECT date, views, likes, collects, comments, raw FROM metrics WHERE note_id = ? ORDER BY date DESC, id DESC LIMIT 1');
  const getS = db.prepare('SELECT likes, collects, comments FROM snapshots WHERE content_id = ? AND age_hours = 72');

  const items = rows.map((r) => {
    const m = r.note_id ? getM.get(r.note_id) : null;
    const s = getS.get(r.id);
    const missing = [];

    // 日期：优先取采集详情里带的真实发布时间（metrics.raw.time）
    let date = null;
    if (m) {
      try { date = toDateStr((JSON.parse(m.raw || '{}') || {}).time); } catch { date = null; }
    }
    if (!date) missing.push('date');

    // 浏览量：当前数据源都拿不到逐篇浏览量（平台只给账号级）→ null + 标注，不许用 0 冒充
    const views = orNull(m ? m.views : null);
    if (views === null) missing.push('views');

    const likes = firstOf(m && m.likes, s && s.likes);
    const collects = firstOf(m && m.collects, s && s.collects);
    const comments = firstOf(m && m.comments, s && s.comments);
    if (likes === null) missing.push('likes');
    if (collects === null) missing.push('collects');
    if (comments === null) missing.push('comments');

    return {
      title: r.title || '（无标题）',
      noteId: r.note_id || null,
      date,
      views,
      likes,
      collects,
      comments,
      missing,
    };
  });

  return { ok: true, count: items.length, items };
}

/* ---------------- 契约 2：AI 整体解读 + 高潜方向 ---------------- */

// 创作者中心读取：与 index.js 里的 creatorHeaders/galaxy 同源（此处为独立副本——
// 不能 import index.js，那会连带把整个服务进程拉起来）

function creatorHeaders() {
  let cookie = '';
  try {
    const raw = JSON.parse(fs.readFileSync(CREATOR_COOKIE, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.cookies || []);
    cookie = list.filter((c) => c && c.name).map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    throw new Error('读取登录态失败（cookies.json）: ' + e.message);
  }
  return {
    Cookie: cookie,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://creator.xiaohongshu.com/',
    Origin: 'https://creator.xiaohongshu.com',
    Accept: 'application/json, text/plain, */*',
  };
}

async function galaxy(pathname) {
  const r = await fetch('https://creator.xiaohongshu.com' + pathname, { headers: creatorHeaders() });
  const text = await r.text();
  if (!r.ok) throw new Error(`创作者中心返回 ${r.status}`);
  return JSON.parse(text);
}

function collectInsightInput() {
  const noteCount = db.prepare(
    "SELECT COUNT(*) AS n FROM contents WHERE (note_id IS NOT NULL AND note_id <> '') OR status = 'published'",
  ).get().n;
  const agg = db.prepare(`
    SELECT COUNT(DISTINCT note_id) AS notes,
           COALESCE(SUM(likes), 0) AS likes,
           COALESCE(SUM(collects), 0) AS collects,
           COALESCE(SUM(comments), 0) AS comments
    FROM metrics
  `).get();
  const top = db.prepare(`
    SELECT c.title, m.likes, m.collects, m.comments
    FROM contents c JOIN metrics m ON m.note_id = c.note_id
    WHERE m.id = (SELECT MAX(id) FROM metrics WHERE note_id = c.note_id)
    ORDER BY m.likes DESC LIMIT 5
  `).all().map((x) => ({ title: x.title || '（无标题）', likes: x.likes || 0, collects: x.collects || 0, comments: x.comments || 0 }));
  const recentTitles = db.prepare(
    "SELECT title FROM contents WHERE title IS NOT NULL AND title <> '' ORDER BY id DESC LIMIT 10",
  ).all().map((r) => r.title);
  let positioning = null;
  try {
    positioning = db.prepare('SELECT persona, audience, tone, selling, goal FROM positioning ORDER BY id DESC LIMIT 1').get() || null;
  } catch { positioning = null; }
  return { noteCount, agg, top, recentTitles, positioning };
}


/** 平台 date 可能是 'YYYY-MM-DD' / 10 位秒 / 13 位毫秒 → 统一成 'YYYY-MM-DD'
 *  （2026-09-24 修：之前直接把 10 位时间戳当日期喂给 AI，解读里出现过「1788796800」） */
function dayOf(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s)
    const d = new Date(n < 1e12 ? n * 1000 : n)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  return s.slice(0, 10)
}

export async function registerAnalyticsApi(app) {
  app.get('/api/notes/performance', async (req) => {
    const raw = Number((req.query || {}).limit);
    const limit = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 30, 1), 200);
    return listNotesPerformance(limit);
  });

  app.get('/api/analytics/insight', async () => {
    if (!deepseekReady()) {
      return { ok: false, reason: '未配置 DeepSeek API Key（server/.env 的 DEEPSEEK_API_KEY）' };
    }

    // ① 创作者中心近 30 天（读不到就降级用本机数据，不整体失败）
    let creator30d = null, creatorError = null;
    try {
      const j = await galaxy('/api/galaxy/creator/data/note_detail_new');
      const t = (j && j.data && j.data.thirty) || null;
      if (t) {
        const num = (k) => { const v = Number(t[k]); return Number.isFinite(v) ? v : 0; };
        creator30d = {
          views: num('view_count'),
          likes: num('like_count'),
          collects: num('collect_count'),
          comments: num('comment_count'),
          shares: num('share_count'),
          fansDelta: num('rise_fans_count'),
          viewSeries: (t.view_list || []).map((p) => ({ date: dayOf(p.date), count: Number(p.count || 0) })),
        };
      } else {
        creatorError = '创作者中心未返回 30 天窗口';
      }
    } catch (e) {
      creatorError = String((e && e.message) || e).slice(0, 120);
      log('warn', 'insight', '创作者中心数据读取失败（降级用本机数据）: ' + creatorError);
    }

    // ② 本机库数据
    const local = collectInsightInput();
    if (!creator30d && local.agg.notes === 0 && local.noteCount === 0) {
      return { ok: false, reason: '样本不足：还没有可用的笔记数据（先导入历史笔记或采集一次数据）' };
    }

    // ③ DeepSeek 生成（契约 2 形状）
    let ai = null, aiError = null;
    try {
      const r = await chat([
        {
          role: 'system',
          content: '你是小红书运营数据分析师。只输出 JSON，中文；结论要具体、可执行，不写空话套话；数据缺失就直说缺失，不得编造数字。',
        },
        {
          role: 'user',
          content: [
            '基于以下真实数据，产出「整体数据分析解读」与「高潜内容方向建议」。',
            '输出 JSON：{"summary":"≤150字整体解读，引用具体数字","highlights":["3-5条关键发现，每条带数字"],"suggestions":[{"direction":"方向名","reason":"为什么（引用数据）","action":"具体做什么：选题/形式/频率"}]}',
            'suggestions 给 2-4 条；某项数据没有时不要假装有，可以在建议里说明如何补齐。',
            '数据：' + JSON.stringify({ creator30d, creatorError, local }),
          ].join('\n'),
        },
      ], { json: true, maxTokens: 1200, temperature: 0.7, timeout: 120000 });
      ai = parseJson(r.content);
    } catch (e) {
      aiError = String((e && e.message) || e).slice(0, 150);
      log('error', 'insight', 'AI 解读失败: ' + aiError);
    }

    if (!ai || !ai.summary) {
      return { ok: false, reason: aiError ? ('AI 生成失败: ' + aiError) : 'AI 返回无法解析（未生成有效解读）' };
    }

    return {
      ok: true,
      generated_at: now(),
      summary: String(ai.summary).slice(0, 600),
      highlights: (Array.isArray(ai.highlights) ? ai.highlights : [])
        .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6),
      suggestions: (Array.isArray(ai.suggestions) ? ai.suggestions : [])
        .filter((s) => s && String(s.direction || '').trim())
        .map((s) => ({
          direction: String(s.direction || '').trim(),
          reason: String(s.reason || '').trim(),
          action: String(s.action || '').trim(),
        }))
        .slice(0, 4),
      sources: {
        creator30d: !!creator30d,
        creatorError,
        metricNotes: local.agg.notes,
        platformNotes: local.noteCount,
      },
    };
  });
}
