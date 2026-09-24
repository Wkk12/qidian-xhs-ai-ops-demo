/**
 * 互动动态（R18 / R23 后端 —— 接口契约 v0 的 1)）
 *
 *   GET /api/interaction/feed?limit=40
 *     replies：谁被我们回了什么（comments 表 replied=1，R14 轮询真实落库）
 *     incoming：最新未回留言（replied=0 —— 含待人工 pending_review / 已跳过 skipped）
 *
 * 边界（不许造假）：
 *   - 数据全部来自本机 comments 表，没有就回空数组，不编造
 *   - 「转发」等平台通知里没有的类型，本端点不提供 → 由前端标注"平台不提供"
 */
import { db } from './db.js';

/** 已回复 -> 契约形状（mode: auto | manual） */
function fmtReply(r) {
  return {
    id: r.id,
    user: r.user_name || '',
    comment: r.content || '',
    reply: r.reply_text || '',
    mode: r.reply_status === 'manual' ? 'manual' : 'auto',
    at: r.at || r.created_at || '',   // 优先真实回复时间（replied_at），老数据退回评论时间
    note: r.note_title || '',
  };
}

/** 未回留言 -> 契约形状（附 status 供前端区分待办/已跳过） */
function fmtIncoming(r) {
  return {
    id: r.id,
    user: r.user_name || '',
    text: r.content || '',
    at: r.created_at || '',
    note: r.note_title || '',
    status: r.reply_status || '',
  };
}

export async function registerInteractionApi(app) {
  app.get('/api/interaction/feed', async (req) => {
    const raw = Number((req.query || {}).limit);
    const limit = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : 40, 1), 200);

    const replies = db.prepare(`
      SELECT id, user_name, content, reply_text, reply_status, note_title,
             COALESCE(replied_at, created_at) AS at
      FROM comments
      WHERE replied = 1
      ORDER BY COALESCE(replied_at, created_at) DESC, id DESC
      LIMIT ?
    `).all(limit).map(fmtReply);

    const incoming = db.prepare(`
      SELECT id, user_name, content, reply_status, note_title, created_at
      FROM comments
      WHERE replied = 0 OR replied IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit).map(fmtIncoming);

    return { ok: true, limit, replies, incoming };
  });
}
