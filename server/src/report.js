/**
 * 复盘报告与建议引擎（R12）
 *
 * 规格要点（01-spec R12）：
 *   采集时点 24/48/72 小时 ｜ 对比基准：账号近 30 天均值
 *   阈值：>1.3× 均值 → "优于"并建议加权；<0.7× → "低于"并建议回避
 *   首判据：收藏率（收藏/点赞）
 *   输出：本期表现 / 与上期对比 / ≥3 条建议 / 支柱调整（±10%）
 *   数据不足（<3 篇样本）→ 标注"数据积累中"，不强行给建议
 *
 * ⚠️ 实测规格调整（见 05-changelog）：
 *   本账号 60 篇笔记的**收藏数全为 0**（真实数据，非 bug）→ 收藏率恒为 0。
 *   故实现为：有收藏数据时用收藏率，否则**退回点赞驱动**，并在报告中标注实际判据。
 */
import { db, now, log } from './db.js';
import { chat, parseJson } from './deepseek.js';

export const MARKS = [24, 48, 72];        // 小时
const MIN_SAMPLE = 3;                      // 少于这么多篇就标"数据积累中"
const UP = 1.3, DOWN = 0.7;

/* ---------------- 快照采集（24/48/72h） ---------------- */

function parseTime(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 用 metrics 里最新一条作为该笔记当前互动数 */
function latestMetrics(noteId) {
  return db.prepare(
    'SELECT likes, collects, comments FROM metrics WHERE note_id = ? ORDER BY date DESC LIMIT 1',
  ).get(noteId);
}

/**
 * 为已发布内容补齐 24/48/72 小时快照。
 * 说明：历史导入的笔记没有真实发布时间，用 `updated_at` 作为代理并标 proxy=1。
 */
export function collectSnapshots() {
  const rows = db.prepare(`
    SELECT id, note_id, updated_at, created_at FROM contents
    WHERE note_id IS NOT NULL AND note_id <> ''
  `).all();

  const ins = db.prepare(`INSERT INTO snapshots
    (content_id, note_id, age_hours, captured_at, likes, collects, comments, is_proxy)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(content_id, age_hours) DO UPDATE SET
      likes=excluded.likes, collects=excluded.collects, comments=excluded.comments,
      captured_at=excluded.captured_at`);

  let added = 0;
  const t = Date.now();
  for (const r of rows) {
    const base = parseTime(r.updated_at) || parseTime(r.created_at);
    if (!base) continue;
    const ageH = (t - base.getTime()) / 3600000;
    const m = latestMetrics(r.note_id);
    if (!m) continue;
    for (const mark of MARKS) {
      // 只有"年龄已过该标记"才记录；未到的不记（等下次采集）
      if (ageH >= mark) {
        const info = ins.run(r.id, r.note_id, mark, now(), m.likes || 0, m.collects || 0, m.comments || 0, 1);
        if (info.changes > 0) added++;
      }
    }
  }
  log('info', 'report', `快照采集完成，更新 ${added} 条`);
  return { ok: true, updated: added, scanned: rows.length, marks: MARKS };
}

/* ---------------- 统计 ---------------- */

function stats(list) {
  const n = list.length;
  if (!n) return null;
  const sum = (k) => list.reduce((a, x) => a + (x[k] || 0), 0);
  const likes = sum('likes'), collects = sum('collects'), comments = sum('comments');
  return {
    count: n,
    avgLikes: likes / n,
    avgCollects: collects / n,
    avgComments: comments / n,
    // 判据：优先收藏率；收藏全为 0 时退回点赞
    collectRate: likes ? collects / likes : 0,
    commentRate: likes ? comments / likes : 0,
    totalLikes: likes,
  };
}

/** 取某时间窗口内的笔记表现（用 snapshots 的 72h 快照，缺失则退回 metrics 最新） */
function periodRows(fromISO, toISO) {
  return db.prepare(`
    SELECT c.id, c.title, c.created_at,
           COALESCE(s.likes, m.likes, 0)       AS likes,
           COALESCE(s.collects, m.collects, 0) AS collects,
           COALESCE(s.comments, m.comments, 0) AS comments
    FROM contents c
    LEFT JOIN snapshots s ON s.content_id = c.id AND s.age_hours = 72
    LEFT JOIN metrics m ON m.note_id = c.note_id
      AND m.date = (SELECT MAX(date) FROM metrics WHERE note_id = c.note_id)
    WHERE c.note_id IS NOT NULL AND c.note_id <> ''
      AND date(c.created_at) >= date(?) AND date(c.created_at) <= date(?)
  `).all(fromISO, toISO);
}

/* ---------------- 报告构建 ---------------- */

export async function buildReport({ days = 30, useAI = true } = {}) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const to = iso(today);
  const fromThis = iso(new Date(today.getTime() - days * 86400000));
  const fromPrev = iso(new Date(today.getTime() - days * 2 * 86400000));
  const toPrev = iso(new Date(today.getTime() - days * 86400000 - 86400000));

  const all = periodRows('1970-01-01', to);
  const cur = periodRows(fromThis, to);
  const prev = periodRows(fromPrev, toPrev);

  const base = stats(all);
  const sCur = stats(cur);
  const sPrev = stats(prev);

  const warnings = [];
  if (!base || base.count < MIN_SAMPLE) {
    return {
      ok: true,
      status: 'collecting',
      note: `数据积累中（当前样本 ${base ? base.count : 0} 篇，需 ≥${MIN_SAMPLE} 篇）`,
      sampleSize: base ? base.count : 0,
      period: { from: fromThis, to },
    };
  }

  // 判据选择：收藏全 0 → 退回点赞
  const totalCollects = base.avgCollects * base.count;
  const metricKey = totalCollects > 0 ? 'collectRate' : 'avgLikes';
  const metricName = totalCollects > 0 ? '收藏率' : '平均点赞';
  if (totalCollects === 0) warnings.push('账号收藏数全为 0（真实数据）→ 判据由「收藏率」退回「平均点赞」');

  // 逐篇判定 优于/低于
  const judged = cur.map((x) => {
    const v = metricKey === 'collectRate' ? (x.likes ? x.collects / x.likes : 0) : x.likes;
    const ratio = base[metricKey] ? v / base[metricKey] : 0;
    let verdict = '持平';
    if (ratio > UP) verdict = '优于';
    else if (ratio < DOWN) verdict = '低于';
    return { title: x.title, value: Number(v.toFixed(3)), ratio: Number(ratio.toFixed(2)), verdict };
  });
  const better = judged.filter((j) => j.verdict === '优于');
  const worse = judged.filter((j) => j.verdict === '低于');

  // 支柱调整（±10%）：表现好的题材加权，差的减权
  // 兜底：positioning 还没配置时用与 /api/positioning 相同的默认支柱，保证这部分永远有输出
  const FALLBACK_PILLARS = [
    { name: '化妆技巧（方法展示）', ratio: 35 },
    { name: '学员改造案例', ratio: 25 },
    { name: '产品/工具测评', ratio: 20 },
    { name: '行业认知/避坑', ratio: 12 },
    { name: '课程/活动信息', ratio: 8 },
  ];
  let pillars = [];
  try {
    const pos = db.prepare('SELECT pillars FROM positioning ORDER BY id DESC LIMIT 1').get();
    if (pos?.pillars) pillars = JSON.parse(pos.pillars);
  } catch { pillars = []; }
  let pillarSource = 'positioning';
  if (!Array.isArray(pillars) || !pillars.length) {
    pillars = FALLBACK_PILLARS;
    pillarSource = 'default（运营计划表尚未配置）';
  }
  const adjust = pillars.map((p, i) => {
    // 规则：表现优于均值 → 前两条支柱加权；低于均值 → 后两条减权；幅度固定 ±10
    const delta = (better.length > 0 && i < 2) ? 10 : ((worse.length > 0 && i >= pillars.length - 2) ? -10 : 0);
    return { name: p.name, current: p.ratio, suggested: Math.max(5, p.ratio + delta), delta };
  });

  // 规则化建议（不依赖 AI，保证必有 3 条）
  const rules = [];
  if (better.length) {
    rules.push({
      what: '题材权重', to: '加权',
      because: `${better.length} 篇超过账号均值 ${UP}× 以上：${better.slice(0, 2).map((b) => b.title.slice(0, 18)).join('、')}`,
    });
  }
  if (worse.length) {
    rules.push({
      what: '题材权重', to: '回避/减产',
      because: `${worse.length} 篇低于均值 ${DOWN}× 以下：${worse.slice(0, 2).map((b) => b.title.slice(0, 18)).join('、')}`,
    });
  }
  const cmt = base.commentRate;
  if (cmt < 0.02) {
    rules.push({ what: '正文结尾', to: '加互动钩子（提问/二选一）', because: `评论/点赞仅 ${(cmt * 100).toFixed(1)}%，低于 2%` });
  }
  if (base.collectRate < 1 && totalCollects > 0) {
    rules.push({ what: '内容形态', to: '增加可收藏的清单/步骤型内容', because: `收藏/点赞 ${(base.collectRate * 100).toFixed(0)}%，收藏意愿偏低` });
  }
  while (rules.length < 3) {
    rules.push({
      what: '发布时段', to: '固定到 19:30 黄金档并连测 2 周',
      because: '样本不足以定位最佳时段，先用行业公认时段建立基线',
    });
  }

  const report = {
    ok: true,
    status: 'ready',
    period: { from: fromThis, to, days, prevFrom: fromPrev, prevTo: toPrev },
    metricUsed: { key: metricKey, name: metricName },
    warnings,
    sampleSize: base.count,
    current: {
      count: sCur ? sCur.count : 0,
      avgLikes: sCur ? Number(sCur.avgLikes.toFixed(2)) : 0,
      avgCollects: sCur ? Number(sCur.avgCollects.toFixed(2)) : 0,
      commentRate: sCur ? Number((sCur.commentRate * 100).toFixed(2)) : 0,
      collectRate: sCur ? Number((sCur.collectRate * 100).toFixed(2)) : 0,
    },
    previous: sPrev ? {
      count: sPrev.count,
      avgLikes: Number(sPrev.avgLikes.toFixed(2)),
      commentRate: Number((sPrev.commentRate * 100).toFixed(2)),
    } : null,
    baseline: {
      count: base.count,
      avgLikes: Number(base.avgLikes.toFixed(2)),
      upThreshold: Number((base[metricKey] * UP).toFixed(2)),
      downThreshold: Number((base[metricKey] * DOWN).toFixed(2)),
    },
    verdicts: { better: better.length, worse: worse.length, flat: judged.length - better.length - worse.length, items: judged },
    pillarAdjust: adjust,
    pillarSource,
    suggestions: rules.slice(0, 4),
    generatedAt: now(),
  };

  // AI 追加一段人话总结（可选，失败不影响报告）
  if (useAI) {
    try {
      const r = await chat([
        { role: 'system', content: '你是小红书运营分析师，输出中文，只输出 JSON。语言要具体、可执行，不要空话。' },
        {
          role: 'user',
          content: `基于以下复盘数据写一段 120 字以内的总结，并给出 3 条「改什么→改成什么→依据」的建议。
判据用的是「${metricName}」。数据：样本 ${base.count} 篇，均值 ${base.avgLikes.toFixed(1)} 赞，
评论率 ${(base.commentRate * 100).toFixed(1)}%，优于 ${better.length} 篇 / 低于 ${worse.length} 篇。
输出 JSON：{"summary":"...","suggestions":[{"what":"","to":"","because":""}]}`,
        },
      ], { json: true, maxTokens: 800, temperature: 0.6, timeout: 90000 });
      const j = parseJson(r.content);
      if (j) {
        report.aiSummary = j.summary || '';
        if (Array.isArray(j.suggestions) && j.suggestions.length) report.suggestions = j.suggestions.slice(0, 4);
      }
    } catch (e) {
      report.aiError = String(e.message).slice(0, 120);
      log('error', 'report', 'AI 总结失败: ' + e.message);
    }
  }

  return report;
}
