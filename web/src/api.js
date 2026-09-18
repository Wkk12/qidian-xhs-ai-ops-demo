/**
 * 前端 API 客户端 —— 统一走 /api（Vite 代理到本地服务 8787）
 * 所有真实数据从这里进，页面不再用假数据。
 */
const BASE = '/api'

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`)
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

  // 手工填报（R13）
  manualMetrics: (days) => req(`/manual-metrics?days=${days || 30}`),
  saveManualMetrics: (p) => req('/manual-metrics', { method: 'POST', body: p }),
  deleteManualMetrics: (date) => req(`/manual-metrics/${date}`, { method: 'DELETE' }),

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

  // 设置（密钥只回掩码）
  settings: () => req('/settings'),
  saveSetting: (key, value) => req('/settings', { method: 'POST', body: { key, value } }),
}

export function useApiStatus() {
  return { api }
}
