/**
 * 发布系统（M1.3–M1.7）
 *
 * 规格（见 09_机制规格书 §8）：
 *   状态机 pending → precheck → publishing → done / failed
 *   调度：每 60 秒扫描；预检：计划发布前 15 分钟
 *   重试：最多 3 次（指数退避）；发布间隔 ≥30 分钟（防风控）
 *   重启可恢复：全部状态落在 publish_tasks 表
 */
import fs from 'node:fs';
import { db, now, log } from './db.js';
import { mcp } from './mcp.js';
import { checkDuplicate } from './dedupe.js';

export const PRE_MINUTES = 15;   // 提前多少分钟预检
export const MIN_GAP_MINUTES = 30; // 同账号两次发布最小间隔
export const MAX_RETRY = 3;

/* ---------------- 工具 ---------------- */

function localISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

function parseWhen(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 任务 + 关联内容（联表视图） */
export function listTasks({ limit = 50 } = {}) {
  return db.prepare(`
    SELECT t.*, c.title AS content_title, c.status AS content_status, c.images AS content_images
    FROM publish_tasks t
    LEFT JOIN contents c ON c.id = t.content_id
    ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'publishing' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
             t.scheduled_at ASC
    LIMIT ?
  `).all(limit).map((t) => {
    let images = [];
    try { images = JSON.parse(t.content_images || '[]'); } catch { images = []; }
    return { ...t, images };
  });
}

/* ---------------- 建议发布时间（规格 §8.1） ---------------- */

const INDUSTRY_SLOTS = [
  { time: '08:00', label: '通勤时段', suitable: '轻量、通勤向', weight: 0.7 },
  { time: '12:30', label: '午休时段', suitable: '午休种草、合集', weight: 0.75 },
  { time: '19:30', label: '晚间黄金档', suitable: '主力内容（方法/案例）', weight: 1.0 },
  { time: '21:30', label: '睡前时段', suitable: '情感/故事向、长文', weight: 0.8 },
];

/**
 * 三层依据：① 自己账号历史（最准）② 对标（待做）③ 行业经验（兜底）
 */
export function bestPublishTime() {
  const reasons = [];

  // 第 1 层：自己账号历史 —— 按发布小时统计平均互动
  const rows = db.prepare(`
    SELECT c.created_at AS created_at,
           COALESCE(SUM(m.likes),0) AS likes,
           COALESCE(SUM(m.collects),0) AS collects,
           COALESCE(SUM(m.comments),0) AS comments,
           COUNT(m.id) AS mcount
    FROM contents c
    LEFT JOIN metrics m ON m.note_id = c.note_id
    WHERE c.source = 'history' AND c.created_at IS NOT NULL
    GROUP BY c.id
    HAVING mcount > 0
  `).all();

  const buckets = new Map(); // hour -> {score, n}
  for (const r of rows) {
    const d = parseWhen(r.created_at);
    if (!d) continue;
    const h = d.getHours();
    const score = Number(r.likes) + Number(r.collects) * 1.5 + Number(r.comments) * 2;
    const b = buckets.get(h) || { score: 0, n: 0 };
    b.score += score;
    b.n += 1;
    buckets.set(h, b);
  }

  let ownBest = null;
  if (buckets.size >= 2) {
    const arr = [...buckets.entries()]
      .map(([h, v]) => ({ hour: h, avg: v.score / v.n, n: v.n }))
      .sort((a, b) => b.avg - a.avg);
    ownBest = arr[0];
    if (ownBest.avg > 0) {
      reasons.push(`你过去 ${ownBest.hour}:00 左右发布的笔记，平均互动最高（样本 ${ownBest.n} 篇）`);
    }
  }

  // 第 3 层：行业经验（兜底，永远可用）
  const slot = INDUSTRY_SLOTS.slice().sort((a, b) => b.weight - a.weight)[0];
  reasons.push(`行业经验：美妆类内容在 ${slot.label}（${slot.time} 前后）互动率最高，适合${slot.suitable}`);

  const recommended = ownBest && ownBest.avg > 0
    ? `${String(ownBest.hour).padStart(2, '0')}:30`
    : slot.time;

  return {
    ok: true,
    recommended,
    confidence: ownBest && ownBest.avg > 0 ? 'own-data' : 'industry-only',
    note: ownBest && ownBest.avg > 0 ? '基于你自己账号的历史表现' : '数据积累中，建议仅供参考',
    slots: INDUSTRY_SLOTS,
    reasons,
    sampleSize: rows.length,
  };
}

/* ---------------- 预检（发布前 15 分钟） ---------------- */

export async function precheck(contentId) {
  const items = [];
  const c = db.prepare('SELECT * FROM contents WHERE id=?').get(contentId);
  if (!c) return { pass: false, items: [{ name: '内容', ok: false, detail: '找不到该内容' }] };

  // ① 登录态
  try {
    const st = await mcp.loginStatus();
    const logged = !!(st?.data?.data?.is_logged_in ?? st?.data?.is_logged_in);
    items.push({ name: '登录态', ok: logged, detail: logged ? '已登录' : '登录已失效，请重新扫码' });
  } catch (e) {
    items.push({ name: '登录态', ok: false, detail: '查询失败：' + e.message });
  }

  // ② 查重
  try {
    const d = checkDuplicate({ title: c.title, body: c.body }, { threshold: 0.6, excludeId: c.id });
    items.push({
      name: '查重', ok: d.pass,
      detail: d.pass ? `相似度 ${(d.score * 100).toFixed(0)}%，低于 60%` : `相似度 ${(d.score * 100).toFixed(0)}%，超过门禁`,
    });
  } catch (e) {
    items.push({ name: '查重', ok: false, detail: '检查失败：' + e.message });
  }

  // ③ 图片文件存在
  let images = [];
  try { images = JSON.parse(c.images || '[]'); } catch { images = []; }
  const paths = images.map((x) => (typeof x === 'string' ? x : x.path)).filter(Boolean);
  const missing = paths.filter((p) => !fs.existsSync(p));
  items.push({
    name: '配图',
    ok: paths.length > 0 && missing.length === 0,
    detail: paths.length === 0 ? '还没有配图（发布前需至少 1 张）' : (missing.length ? `缺失 ${missing.length} 个文件` : `${paths.length} 张图就绪`),
  });

  // ④ 正文长度
  const len = String(c.body || '').length;
  items.push({ name: '正文', ok: len >= 50, detail: len >= 50 ? `${len} 字` : `仅 ${len} 字，太短（建议 ≥50）` });

  // ⑤ 距上次发布间隔（防风控）
  const last = db.prepare("SELECT updated_at FROM publish_tasks WHERE status='done' ORDER BY updated_at DESC LIMIT 1").get();
  let gapOk = true, gapMsg = '首次发布';
  if (last?.updated_at) {
    const t = parseWhen(last.updated_at);
    const mins = t ? (Date.now() - t.getTime()) / 60000 : 999;
    gapOk = mins >= MIN_GAP_MINUTES;
    gapMsg = gapOk ? `距上次发布 ${mins.toFixed(0)} 分钟` : `距上次仅 ${mins.toFixed(0)} 分钟，需 ≥${MIN_GAP_MINUTES} 分钟`;
  }
  items.push({ name: '发布间隔', ok: gapOk, detail: gapMsg });

  return { pass: items.every((i) => i.ok), items };
}

/* ---------------- 状态机 ---------------- */

export function schedulePublish(contentId, scheduledAt) {
  const when = parseWhen(scheduledAt);
  if (!when) throw Object.assign(new Error('发布时间格式不对（应为 YYYY-MM-DDTHH:mm）'), { status: 400 });
  const c = db.prepare('SELECT id FROM contents WHERE id=?').get(contentId);
  if (!c) throw Object.assign(new Error('内容不存在'), { status: 404 });

  // 同一内容只允许一个未完成任务
  const dup = db.prepare("SELECT id FROM publish_tasks WHERE content_id=? AND status IN ('pending','publishing','precheck')").get(contentId);
  if (dup) return { ok: true, existing: true, taskId: dup.id };

  const info = db.prepare(`INSERT INTO publish_tasks (content_id, scheduled_at, status, retry, created_at, updated_at)
    VALUES (?,?,?,?,?,?)`).run(contentId, localISO(when), 'pending', 0, now(), now());
  db.prepare("UPDATE contents SET status='scheduled', updated_at=? WHERE id=?").run(now(), contentId);

  // 自动套用建议时间（当未指定具体时间时由前端传入）
  log('info', 'publish', `已排期内容 #${contentId} 于 ${localISO(when)}`);
  return { ok: true, taskId: Number(info.lastInsertRowid), scheduledAt: localISO(when) };
}

export function cancelTask(taskId) {
  const t = db.prepare('SELECT * FROM publish_tasks WHERE id=?').get(taskId);
  if (!t) throw Object.assign(new Error('任务不存在'), { status: 404 });
  db.prepare("UPDATE publish_tasks SET status='canceled', updated_at=? WHERE id=?").run(now(), taskId);
  db.prepare("UPDATE contents SET status='approved', updated_at=? WHERE id=?").run(now(), t.content_id);
  return { ok: true };
}

/** 真正发布（会调用小红书通道，产生真实副作用） */
export async function runTask(taskId, { skipPrecheck = false } = {}) {
  const t = db.prepare('SELECT * FROM publish_tasks WHERE id=?').get(taskId);
  if (!t) throw Object.assign(new Error('任务不存在'), { status: 404 });
  if (!['pending', 'precheck', 'failed'].includes(t.status)) {
    return { ok: false, error: `任务状态为 ${t.status}，不能发布` };
  }
  const c = db.prepare('SELECT * FROM contents WHERE id=?').get(t.content_id);
  if (!c) {
    db.prepare("UPDATE publish_tasks SET status='failed', error=?, updated_at=? WHERE id=?").run('内容已被删除', now(), taskId);
    return { ok: false, error: '内容已被删除' };
  }

  if (!skipPrecheck) {
    const pc = await precheck(c.id);
    db.prepare("UPDATE publish_tasks SET status='precheck', updated_at=? WHERE id=?").run(now(), taskId);
    if (!pc.pass) {
      const bad = pc.items.filter((i) => !i.ok).map((i) => `${i.name}: ${i.detail}`).join('；');
      db.prepare("UPDATE publish_tasks SET status='failed', error=?, updated_at=? WHERE id=?").run('预检未通过 → ' + bad, now(), taskId);
      log('error', 'publish', `预检未通过 #${taskId}: ${bad}`);
      return { ok: false, error: '预检未通过', items: pc.items };
    }
  }

  db.prepare("UPDATE publish_tasks SET status='publishing', updated_at=? WHERE id=?").run(now(), taskId);
  let images = [];
  try { images = JSON.parse(c.images || '[]').map((x) => (typeof x === 'string' ? x : x.path)).filter(Boolean); } catch { images = []; }
  let tags = [];
  try { tags = JSON.parse(c.tags || '[]'); } catch { tags = []; }

  try {
    const r = await mcp.publish({
      title: c.title || '',
      content: c.body || '',
      images,
      tags,
    });
    const noteId = r?.data?.data?.note_id || r?.data?.note_id || r?.data?.data?.id || null;
    db.prepare("UPDATE publish_tasks SET status='done', note_id=?, error=NULL, updated_at=? WHERE id=?")
      .run(noteId, now(), taskId);
    db.prepare("UPDATE contents SET status='published', updated_at=? WHERE id=?").run(now(), c.id);
    log('info', 'publish', `发布成功 #${taskId} → note ${noteId || '(未返回ID)'}`);
    return { ok: true, noteId, raw: r };
  } catch (e) {
    const retry = (t.retry || 0) + 1;
    const fail = retry >= MAX_RETRY;
    db.prepare("UPDATE publish_tasks SET status=?, retry=?, error=?, updated_at=? WHERE id=?")
      .run(fail ? 'failed' : 'pending', retry, String(e.message).slice(0, 300), now(), taskId);
    log('error', 'publish', `发布失败 #${taskId}（第 ${retry} 次）: ${e.message}`);
    return { ok: false, error: e.message, retry, willRetry: !fail };
  }
}

/* ---------------- 调度器（每 60 秒） ---------------- */

let ticking = false;

export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const tasks = db.prepare("SELECT * FROM publish_tasks WHERE status='pending' ORDER BY scheduled_at ASC LIMIT 10").all();
    for (const t of tasks) {
      const when = parseWhen(t.scheduled_at);
      if (!when) continue;
      const mins = (when.getTime() - Date.now()) / 60000;
      // 到期（含超过 15 分钟）→ 发布；否则只做预检记录
      if (mins <= 0) {
        await runTask(t.id);
      } else if (mins <= PRE_MINUTES && t.status === 'pending') {
        const pc = await precheck(t.content_id);
        if (!pc.pass) {
          const bad = pc.items.filter((i) => !i.ok).map((i) => `${i.name}: ${i.detail}`).join('；');
          db.prepare("UPDATE publish_tasks SET status='failed', error=?, updated_at=? WHERE id=?")
            .run('预检未通过 → ' + bad, now(), t.id);
          log('error', 'publish', `预检拦截 #${t.id}: ${bad}`);
        }
      }
    }
  } catch (e) {
    log('error', 'publish', '调度器异常: ' + e.message);
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  setInterval(() => { tick().catch(() => {}); }, 60 * 1000);
  log('info', 'publish', '发布调度器已启动（每 60 秒扫描）');
}
