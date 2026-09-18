/**
 * 小红书 MCP 客户端封装
 * 后端只通过这一层调用 MCP（localhost:18060），其他模块不直接依赖具体实现
 * —— 平台升级时只换这一层（开发计划 P1「发布适配」）。
 *
 * 已实测能力（2026-09-17）：
 *   ✅ 登录状态 / 推荐流 / 搜索 / 笔记详情(含互动数据) / 读评论
 *   ✅ 发布图文、发布视频 / 发评论、回评论 / 点赞收藏
 *   ❌ 通知端点（本地二进制 v2.5.0 无，需编译最新源码才有）
 *   ❌ 私信（全路由无此端点）
 */
import { log } from './db.js';

const BASE = process.env.XHS_MCP_BASE || 'http://localhost:18060';
const TIMEOUT = Number(process.env.XHS_MCP_TIMEOUT || 180000);

async function call(pathname, { method = 'GET', body, params, timeout } = {}) {
  const url = new URL(BASE + pathname);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout || TIMEOUT);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    log('info', 'mcp', `${method} ${pathname} -> ${res.status} ${Date.now() - t0}ms`);
    if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, data });
    return data;
  } catch (e) {
    log('error', 'mcp', `${method} ${pathname} 失败: ${e.message}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const mcp = {
  health: () => call('/health'),
  loginStatus: () => call('/api/v1/login/status'),
  loginQrcode: () => call('/api/v1/login/qrcode'),
  clearCookies: () => call('/api/v1/login/cookies', { method: 'DELETE' }),
  me: () => call('/api/v1/user/me'),

  /** 搜索笔记（注意：中文用 GET 传参，POST body 在 Windows 下会有编码坑） */
  search: (keyword, filters) =>
    call('/api/v1/feeds/search', { params: { keyword, ...(filters || {}) } }),
  feedList: () => call('/api/v1/feeds/list'),
  /**
   * 笔记详情。⚠️ 实测该接口很慢：带上有效 token 后可能挂到 180 秒被中断。
   * 故支持自定义 timeout（默认 45 秒）——调用方应按"尽力而为"处理失败。
   */
  feedDetail: (feedId, xsecToken, loadAllComments = false, timeout = 45000) =>
    call('/api/v1/feeds/detail', {
      method: 'POST',
      body: { feed_id: feedId, xsec_token: xsecToken, load_all_comments: loadAllComments },
      timeout,
    }),

  /** 发布图文：images 用本地绝对路径 */
  publish: ({ title, content, images, tags }) =>
    call('/api/v1/publish', { method: 'POST', body: { title, content, images, tags } }),
  publishVideo: ({ title, content, video, tags }) =>
    call('/api/v1/publish_video', { method: 'POST', body: { title, content, video, tags } }),

  comment: (feedId, xsecToken, content) =>
    call('/api/v1/feeds/comment', { method: 'POST', body: { feed_id: feedId, xsec_token: xsecToken, content } }),
  replyComment: (feedId, commentId, content) =>
    call('/api/v1/feeds/comment/reply', { method: 'POST', body: { feed_id: feedId, comment_id: commentId, content } }),
  like: (feedId, xsecToken, unlike = false) =>
    call('/api/v1/feeds/like', { method: 'POST', body: { feed_id: feedId, xsec_token: xsecToken, unlike } }),
  favorite: (feedId, xsecToken, unfavorite = false) =>
    call('/api/v1/feeds/favorite', { method: 'POST', body: { feed_id: feedId, xsec_token: xsecToken, unfavorite } }),
};

/** 从笔记详情响应里提取互动数据（M4 数据源） */
export function extractMetrics(detailResp) {
  const note = detailResp?.data?.data?.note || detailResp?.data?.note || {};
  const it = note.interactInfo || {};
  return {
    note_id: note.noteId,
    title: note.title,
    likes: Number(it.likedCount || 0),
    collects: Number(it.collectedCount || 0),
    comments: Number(it.commentCount || 0),
    shares: Number(it.sharedCount || 0),
    images: (note.imageList || []).length,
    time: note.time,
  };
}
