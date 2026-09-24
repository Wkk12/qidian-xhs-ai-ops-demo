/**
 * 前端 API 客户端 —— 统一走 /api（Vite 代理到本地服务 8787）
 * 所有真实数据从这里进，页面不再用假数据。
 *
 * 2026-09-23 加：统一错误处理 + 登录态守卫
 *   以前各调用点各自 catch，登录失效时只有少数地方有提示，其它地方白屏。
 *   现在这里统一识别 401/403（登录失效）与 MCP 熔断，交给 requestGuard 弹全局提示；
 *   并把 HTTP 状态挂到 Error.status 上，调用方可按状态分支。
 */
import { notifyAuthExpired, notifyServiceDegraded, looksLikeAuthError } from './requestGuard.js'

const BASE = '/api'

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    const message = data.error || `HTTP ${res.status}`
    const err = new Error(message)
    err.status = res.status
    err.data = data
    if (res.status === 401 || res.status === 403) {
      notifyAuthExpired(path, message)
    } else if (data && data.circuitOpen) {
      notifyServiceDegraded(message)
    } else if (res.status >= 500 && looksLikeAuthError(message)) {
      // MCP 在登录失效时不一定回 401，可能直接抛 panic 变成 500 —— 兜住这一档
      notifyAuthExpired(path, message)
    }
    throw err
  }
  return data
}

export const api = {
  health: () => req('/health'),

  // MCP 服务与账号
  mcpStatus: () => req('/mcp/status'),
  mcpQrcode: () => req('/mcp/qrcode'),
  me: () => req('/mcp/me'),

  // 素材库（「在线素材」= 上传图 + AI 生成图的统一存放位）
  assets: (kind) => req(`/assets${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
  deleteAsset: (id) => req(`/assets/${id}`, { method: 'DELETE' }),
  registerAsset: (payload) => req('/assets/register', { method: 'POST', body: payload }),

  attachAsset: (id, contentId) => req(`/assets/${id}/attach`, { method: 'POST', body: { contentId } }),

  // AI 生图（R15）
  imageStatus: () => req('/image/status'),
  expandPrompt: (p) => req('/image/expand', { method: 'POST', body: p }),
  generateImage: (p) => req('/image/generate', { method: 'POST', body: p }),

  // 评论自动回复（R14）
  commentStats: () => req('/comments/stats'),
  commentList: (status) => req('/comments/list' + (status ? `?status=${status}` : '')),
  pollComments: (limit) => req('/comments/poll', { method: 'POST', body: { limit: limit || 20 } }),
  approveComment: (id) => req(`/comments/${id}/approve`, { method: 'POST', body: {} }),
  replyCommentManual: (id, text) => req(`/comments/${id}/reply`, { method: 'POST', body: { text } }),
  matchTest: (text) => req('/comments/match-test', { method: 'POST', body: { text } }),
  persona: () => req('/persona'),
  savePersona: (p) => req('/persona', { method: 'POST', body: p }),
  forbiddenWords: () => req('/forbidden-words'),
  saveForbiddenWords: (words) => req('/forbidden-words', { method: 'POST', body: { words } }),
  knowledge: () => req('/knowledge'),
  addKnowledge: (p) => req('/knowledge', { method: 'POST', body: p }),
  takeoverList: () => req('/takeover'),
  addTakeover: (p) => req('/takeover', { method: 'POST', body: p }),
  removeTakeover: (userId) => req(`/takeover/${userId}`, { method: 'DELETE' }),

  // 复盘报告（R12）
  report: () => req('/report?days=30'),
  buildReport: (p) => req('/report', { method: 'POST', body: p || {} }),
  collectSnapshots: () => req('/report/snapshots', { method: 'POST', body: {} }),

  // 对标账号监控（R11）
  competitors: () => req('/competitors'),
  discoverCompetitors: (p) => req('/competitors/discover', { method: 'POST', body: p || {} }),
  addCompetitor: (p) => req('/competitors', { method: 'POST', body: p }),
  removeCompetitor: (id) => req(`/competitors/${id}`, { method: 'DELETE' }),
  deepAnalyzeCompetitor: (id, p) => req(`/competitors/${id}/deep-analyze`, { method: 'POST', body: p || {} }),

  // 发布（M1）
  publishTasks: () => req('/publish/tasks'),
  bestTime: () => req('/publish/best-time'),
  precheckPublish: (p) => req('/publish/precheck', { method: 'POST', body: p }),
  schedulePublish: (p) => req('/publish/schedule', { method: 'POST', body: p }),
  cancelPubTask: (id) => req(`/publish/tasks/${id}/cancel`, { method: 'POST', body: {} }),
  runPubTask: (id) => req(`/publish/tasks/${id}/run`, { method: 'POST', body: {} }),
  publishNow: (contentId) => req('/publish/now', { method: 'POST', body: { contentId } }),
  // 自动发布调度真实开关（2026-09-23 加）
  schedulerState: () => req('/publish/scheduler'),
  setSchedulerState: (enabled) => req('/publish/scheduler', { method: 'POST', body: { enabled: !!enabled } }),

  // 查重门禁
  checkDuplicate: (payload) => req('/duplicate/check', { method: 'POST', body: payload }),
  scanDup: () => req('/duplicate/scan', { method: 'POST', body: {} }),

  // AI 能力（DeepSeek）
  aiStatus: () => req('/ai/status'),
  generate: (payload) => req('/generate', { method: 'POST', body: payload }),
  generateContext: () => req('/generate/context'),

  // 行业热榜（定时/手动抓取）
  trends: (limit = 50) => req(`/trends?limit=${limit}`),
  scrapeTrends: (keywords) => req('/trends/scrape', { method: 'POST', body: { keywords } }),
  trendKeywords: () => req('/trends/keywords'),
  saveTrendKeywords: (keywords) => req('/trends/keywords', { method: 'POST', body: { keywords } }),

  // 运营计划表（账号定位 + 内容支柱 + 每天条数）
  positioning: () => req('/positioning'),
  savePositioning: (p) => req('/positioning', { method: 'POST', body: p }),
  planConfig: () => req('/plan-config'),
  savePlanConfig: (n) => req('/plan-config', { method: 'POST', body: { postsPerDay: n } }),

  // 平台数据后台（创作者中心）：浏览量/涨粉/观看时长
  creatorOverview: () => req('/creator/overview'),
  creatorProfile: () => req('/creator/profile'),

  // 数据洞察
  myNotes: () => req('/mcp/my-notes'),
  // 数据洞察 · 逐篇笔记数据（R21 契约3；缺的字段为 null 并出现在 missing，不用 0 冒充）
  performance: (limit = 30) => req(`/notes/performance?limit=${limit}`),
  // 数据洞察 · AI 整体解读 + 高潜方向（R21 契约2；无 Key/样本不足时返回 ok:false + reason）
  insight: () => req('/analytics/insight'),

  // 互动动态（R18 互动运营区，契约1）：{ replies:[…我们回复了谁…], incoming:[…用户留言…] }
  interactionFeed: (limit = 40) => req(`/interaction/feed?limit=${limit}`),

  // 内容调研（选题/同行参考，非素材库）
  search: (keyword) => req(`/mcp/search?keyword=${encodeURIComponent(keyword)}`),
  detail: (feedId, xsecToken, loadAllComments = false) =>
    req('/mcp/detail', { method: 'POST', body: { feedId, xsecToken, loadAllComments } }),

  // 文案库
  contents: (status) => req(`/contents${status ? `?status=${status}` : ''}`),
  createContent: (c) => req('/contents', { method: 'POST', body: c }),
  updateContent: (id, c) => req(`/contents/${id}`, { method: 'PATCH', body: c }),
  importNotes: () => req('/notes/import', { method: 'POST', body: {} }),

  // 周计划
  plans: () => req('/plans'),
  createPlan: (p) => req('/plans', { method: 'POST', body: p }),

  // 指标
  metrics: (noteId) => req(`/metrics${noteId ? `?noteId=${noteId}` : ''}`),
  collectMetrics: (feedId, xsecToken) =>
    req('/metrics/collect', { method: 'POST', body: { feedId, xsecToken } }),

  // 知识库
  knowledge: () => req('/knowledge'),
  createKnowledge: (k) => req('/knowledge', { method: 'POST', body: k }),

  // 评论
  comments: (status) => req(`/comments${status ? `?status=${status}` : ''}`),

  // 密钥/渠道（客户机没有 Hermes → 界面手动填 + 当场检查）
  mcpSwitchAccount: () => req('/mcp/switch-account', { method: 'POST' }),
  mcpLogout: () => req('/mcp/logout', { method: 'POST' }),

  keysStatus: () => req('/keys/status'),
  saveKeys: (p) => req('/keys', { method: 'POST', body: p }),
  testKeys: (target = 'all') => req('/keys/test', { method: 'POST', body: { target } }),
  testShot: () => req('/image/test-shot', { method: 'POST' }),

  // 内容与发布保护开关
  guardSettings: () => req('/guard/settings'),
  setGuardSettings: (p) => req('/guard/settings', { method: 'POST', body: p }),

  // 知识库（两部分：文档提炼 + AI 对话补全）
  knowledgeEntries: (source = '') => req(`/knowledge/entries${source ? `?source=${source}` : ''}`),
  deleteKnowledgeEntry: (id) => req(`/knowledge/${id}`, { method: 'DELETE' }),
  analyzeDoc: (id, max = 15) => req(`/library/${id}/analyze`, { method: 'POST', body: { max } }),
  knowledgeChat: (limit = 40) => req(`/knowledge/chat?limit=${limit}`),
  sendKnowledgeChat: (message) => req('/knowledge/chat', { method: 'POST', body: { message } }),

  // 设置（密钥只回掩码）
  settings: () => req('/settings'),
  saveSetting: (key, value) => req('/settings', { method: 'POST', body: { key, value } }),

  // R20 发布：自动发送 / 发布保护 / 人工确认
  publishSettings: () => req('/publish/settings'),
  setPublishSettings: (p) => req('/publish/settings', { method: 'POST', body: p }),
  confirmTask: (id) => req(`/publish/tasks/${id}/confirm`, { method: 'POST' }),

  // R23 互动区：评论自动回复总开关
  replySettings: () => req('/reply/settings'),
  setReplySettings: (enabled) => req('/reply/settings', { method: 'POST', body: { enabled } }),

  // R22 运营大纲：三板块 + 完整策略 + AI 对话（带记忆，真实改策略）
  outline: () => req('/outline'),
  saveOutlinePositioning: (p) => req('/outline/positioning', { method: 'POST', body: p }),
  saveStrategy: (s) => req('/outline/strategy', { method: 'POST', body: s }),
  genStrategy: (userIntent) => req('/outline/strategy/generate', { method: 'POST', body: { userIntent } }),
  outlineChat: (limit = 40) => req(`/outline/chat?limit=${limit}`),
  sendOutlineChat: (message) => req('/outline/chat', { method: 'POST', body: { message } }),
  resetOutlineChat: () => req('/outline/chat', { method: 'DELETE' }),

  // 回复命中自测（资料库/知识库能不能撑住这条提问）
  matchTest: (text) => req('/comments/match-test', { method: 'POST', body: { text } }),

  // R24 资料库：上传文档 → 知识条目（评论回复的知识支撑）
  libraryDocs: () => req('/library'),
  libraryDoc: (id) => req(`/library/${id}`),
  deleteLibraryDoc: (id) => req(`/library/${id}`, { method: 'DELETE' }),
  rebuildLibraryDoc: (id) => req(`/library/${id}/rebuild`, { method: 'POST' }),
  libraryUpload: async (files) => {
    const fd = new FormData()
    for (const f of files) fd.append('file', f)
    const r = await fetch('/api/library/upload', { method: 'POST', body: fd })
    if (!r.ok) throw new Error('上传失败 HTTP ' + r.status)
    return r.json()
  },
}

export function useApiStatus() {
  return { api }
}
