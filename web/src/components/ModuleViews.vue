<script setup>
/* finesse · register=product · shell=multi-module-workbench · motion=feedback-only */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import { api } from '../api.js'
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CalendarCheck,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  CloudUpload,
  Eye,
  FileText,
  KeyRound,
  Layers3,
  LockKeyhole,
  Palette,
  RefreshCw,
  Search,
  Send,
  ServerCog,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from '@lucide/vue'

const props = defineProps({
  activeView: { type: String, required: true },
})

const emit = defineEmits(['open-preview'])

/* ---------------- 真实运行状态（替换原演示数据，数据来自本地服务 /api） ---------------- */
const realStatus = ref({
  loading: true, error: '', mcpService: false, loggedIn: false,
  username: '', account: '', deepseek: false, image: false, checkedAt: '',
})

const connectionList = computed(() => [
  {
    icon: 'xhs', name: '小红书账号',
    detail: realStatus.value.loggedIn ? (realStatus.value.username || '已登录') : '未登录',
    state: realStatus.value.loggedIn ? '授权正常' : '未登录',
  },
  {
    icon: 'ai', name: 'DeepSeek', detail: '内容生成与复盘',
    state: realStatus.value.deepseek ? '已配置' : '未配置',
  },
  {
    icon: 'img', name: 'QweAPI · img2.5', detail: '美妆与穿搭生图',
    state: realStatus.value.image ? '已配置' : '待检测',
  },
  {
    icon: 'mcp', name: '小红书 MCP',
    detail: realStatus.value.account ? `本机服务 ${realStatus.value.account}` : '发布与数据读取',
    state: realStatus.value.mcpService ? '连接正常' : '未连接',
  },
])

const healthyCount = computed(
  () => connectionList.value.filter((i) => ['授权正常', '已配置', '连接正常'].includes(i.state)).length,
)

const bannerTitle = computed(() => {
  if (realStatus.value.loading) return '正在检测本机环境…'
  if (realStatus.value.error) return '本机服务未启动'
  return healthyCount.value === 4 ? '环境检测全部通过' : `环境检测完成（${healthyCount.value} / 4 正常）`
})

// 系统环境文案必须反映真实运行系统（原样稿写死 “macOS · 可运行”，Windows 上也照显 → 假数据）
const envOsText = computed(() => {
  const p = String(
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '',
  ).toLowerCase()
  if (p.includes('win')) return 'Windows · 可运行'
  if (p.includes('mac')) return 'macOS · 可运行'
  if (p.includes('linux')) return 'Linux · 可运行'
  return '本机 · 可运行'
})

async function loadRealStatus() {
  realStatus.value.loading = true
  realStatus.value.error = ''
  try {
    const [h, m, s, ai, im] = await Promise.allSettled([
      api.health(), api.mcpStatus(), api.settings(), api.aiStatus(), api.imageStatus(),
    ])
    if (h.status === 'fulfilled') realStatus.value.mcpService = !!h.value.ok
    if (m.status === 'fulfilled') {
      realStatus.value.mcpService = !!m.value.service
      realStatus.value.loggedIn = !!m.value.loggedIn
      realStatus.value.username = m.value.username || ''
      realStatus.value.account = m.value.account || ''
    }
    // 密钥存在本机 .env，不会出现在 /api/settings 的数据行里 → 只能问「就绪接口」判断
    // （2026-09-19 修：原按 settings 行名匹配，把已就绪的 DeepSeek 显示成「未配置」）
    if (ai.status === 'fulfilled') {
      realStatus.value.deepseek = !!(ai.value && ai.value.deepseek && ai.value.deepseek.ready)
    } else {
      realStatus.value.deepseek = false
    }
    if (im.status === 'fulfilled') {
      realStatus.value.image = !!(im.value && im.value.ready)
    } else {
      realStatus.value.image = false
    }
    if (s.status === 'fulfilled') {
      // 读取已保存的开关状态
      const map = {}
      for (const it of (s.value.items || [])) map[it.key] = it
      const t = { ...systemToggles.value }
      for (const k of Object.keys(t)) {
        const row = map['toggle_' + k]
        if (row) t[k] = String(row.masked) === '1' || row.masked === true
      }
      systemToggles.value = t
    }
    realStatus.value.checkedAt = new Date().toLocaleTimeString('zh-CN')
  } catch (e) {
    realStatus.value.error = e.message || '读取本机状态失败'
  } finally {
    realStatus.value.loading = false
  }
}

// 首次挂载：按当前模块加载一次（放在这里可确保所有 loader 已定义）
onMounted(() => { onViewChange(props.activeView) })

/* -------- 在线素材库（上传图 + AI 生成图的统一存放位，真数据） -------- */
const fileInput = ref(null)
const assetItems = ref([])
const assetLoading = ref(false)
const assetError = ref('')

async function loadAssets() {
  assetLoading.value = true
  assetError.value = ''
  try {
    const r = await api.assets()
    assetItems.value = r.items || []
  } catch (e) {
    assetError.value = '读取素材库失败：' + (e.message || '未知错误')
    assetItems.value = []
  } finally {
    assetLoading.value = false
  }
}

function pickUpload() { fileInput.value?.click() }

async function onFilesPicked(ev) {
  const files = Array.from(ev.target.files || [])
  if (!files.length) return
  assetLoading.value = true
  assetError.value = ''
  try {
    const fd = new FormData()
    for (const f of files) fd.append('files', f, f.name)
    const res = await fetch('/api/assets/upload', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`)
    await loadAssets()
  } catch (e) {
    assetError.value = '上传失败：' + (e.message || '未知错误')
  } finally {
    assetLoading.value = false
    ev.target.value = ''
  }
}

async function removeAsset(id) {
  if (!window.confirm('确定从素材库删除这张图？（本机文件也会删除）')) return
  try {
    await api.deleteAsset(id)
    await loadAssets()
  } catch (e) {
    assetError.value = '删除失败：' + (e.message || '未知错误')
  }
}

/* -------- 数据洞察：我的真实笔记数据 -------- */
const myNotes = ref([])
const notesLoading = ref(false)
const notesError = ref('')

async function loadMyNotes() {
  notesLoading.value = true
  notesError.value = ''
  try {
    const r = await api.myNotes()
    myNotes.value = r.items || []
  } catch (e) {
    notesError.value = '读取笔记数据失败：' + (e.message || '未知错误')
    myNotes.value = []
  } finally {
    notesLoading.value = false
  }
}

const analyticsKpis = computed(() => {
  const list = myNotes.value
  const sum = (k) => list.reduce((a, b) => a + (Number(b[k]) || 0), 0)
  const pending = notesLoading.value
  const tag = notesError.value ? '读取失败' : (pending ? '读取中…' : '')
  return [
    { label: '我的笔记', value: pending ? '…' : String(list.length), delta: tag },
    { label: '总点赞', value: pending ? '…' : sum('liked').toLocaleString(), delta: tag },
    { label: '总收藏', value: pending ? '…' : sum('collected').toLocaleString(), delta: tag },
    { label: '总评论', value: pending ? '…' : sum('comments').toLocaleString(), delta: tag },
  ]
})

/* -------- 内容工坊：选题参考（搜小红书真实爆款，放在生成之前） -------- */
const refKeyword = ref('美妆')
const refSearching = ref(false)
const refError = ref('')
const refItems = ref([])

async function searchReferences() {
  const kw = (refKeyword.value || '').trim()
  if (!kw) return
  refSearching.value = true
  refError.value = ''
  try {
    const r = await api.search(kw)
    refItems.value = r.items || []
  } catch (e) {
    refError.value = '搜索失败：' + (e.message || '未知错误')
    refItems.value = []
  } finally {
    refSearching.value = false
  }
}

/* -------- 文案库：真实内容（含从小红书导入的历史笔记） -------- */
const libraryItems = ref([])
const libraryLoading = ref(false)
const libraryError = ref('')
const importing = ref(false)

async function loadLibrary() {
  libraryLoading.value = true
  libraryError.value = ''
  try {
    const r = await api.contents()
    libraryItems.value = r.items || []
  } catch (e) {
    libraryError.value = '读取文案库失败：' + (e.message || '未知错误')
    libraryItems.value = []
  } finally {
    libraryLoading.value = false
  }
}

async function importHistory() {
  importing.value = true
  libraryError.value = ''
  try {
    const r = await api.importNotes()
    showNotice(`已从小红书导入 ${r.added} 篇（跳过 ${r.skipped} 篇重复或无标题）`)
    await loadLibrary()
  } catch (e) {
    libraryError.value = '导入失败：' + (e.message || '未知错误')
  } finally {
    importing.value = false
  }
}

const STATUS_MAP = { published: '已发布', draft: '草稿', scheduled: '已排期', approved: '已确认', rejected: '已退回' }

const libraryRows = computed(() =>
  libraryItems.value.map((it) => {
    let source = '手动录入'
    if (it.source === 'history') source = '历史笔记'
    else if (it.source === 'generated') source = 'AI生成'
    return {
      id: it.id,
      title: it.title || '(无标题)',
      topic: source,
      status: STATUS_MAP[it.status] || it.status || '草稿',
      // dup_score 在后端按 0–1 比率存储（generate.js / index.js 查重回写均为 0–1），
      // 展示统一 ×100 成百分数，与 329 行 weeklyContents 的写法保持同一量纲
      similarity: typeof it.dup_score === 'number' ? Math.round(it.dup_score * 100) : null,
      date: (it.created_at || '').slice(5, 10).replace('-', '/'),
    }
  }),
)

const maxSimilarity = computed(() => {
  const arr = libraryRows.value.map((r) => r.similarity).filter((v) => typeof v === 'number')
  return arr.length ? Math.max(...arr) : null
})

/* -------- 内容与排期：真实数据（来自本机服务的内容库） -------- */
const contentsLoading = ref(false)

async function loadContents() {
  contentsLoading.value = true
  try {
    const r = await api.contents()
    const items = r.items || []
    weeklyContents.value = items.slice(0, 7).map((it, i) => ({
      id: it.id,
      body: it.body || '',
      tags: (() => { try { return JSON.parse(it.tags || '[]'); } catch { return []; } })(),
      rawStatus: it.status,
      day: 'D' + (i + 1),
      date: (it.created_at || '').slice(5, 10).replace('-', '/'),
      stage: it.source === 'history' ? '历史笔记' : (it.source === 'generated' ? 'AI生成' : '手动'),
      title: it.title || '(无标题)',
      similarity: typeof it.dup_score === 'number' ? Math.round(it.dup_score * 100) : null,
      state: STATUS_MAP[it.status] || it.status,
    }))
    scheduleItems.value = items
      .filter((it) => ['scheduled', 'approved', 'published'].includes(it.status))
      .slice(0, 8)
      .map((it) => ({
        date: (it.created_at || '').slice(5, 10).replace('-', '/'),
        week: '',
        time: '',
        title: it.title || '(无标题)',
        type: it.source === 'generated' ? 'AI 生成' : '历史笔记',
        state: STATUS_MAP[it.status] || it.status || '待发布',
      }))
    // R19：待发送内容池（生成但还没发出去）= draft / approved；收藏或已排期不参与 7 天清理
    generatedTotal.value = items.filter((it) => it.source === 'generated').length
    poolRows.value = items
      .filter((it) => POOL_STATUSES.includes(it.status))
      .map((it) => {
        const age = daysSince(it.created_at)
        return {
          id: it.id,
          title: it.title || '(无标题)',
          body: it.body || '',
          status: it.status,
          state: STATUS_MAP[it.status] || it.status,
          source: it.source || '',
          favorite: Number(it.favorite || 0) === 1,
          scheduled: !!it.scheduled,
          createdAt: it.created_at || '',
          date: (it.created_at || '').slice(5, 10).replace('-', '/'),
          ageDays: age,
          remainDays: Math.max(0, KEEP_DAYS - age),
          dupScore: typeof it.dup_score === 'number' ? Math.round(it.dup_score * 100) : null,
          images: (() => { try { const a = JSON.parse(it.images || '[]'); return Array.isArray(a) ? a.filter((x) => x && x.url) : [] } catch { return [] } })(),
          cover: (() => { try { const a = JSON.parse(it.images || '[]'); return Array.isArray(a) && a[0] && a[0].url ? a[0].url : '' } catch { return '' } })(),
          tags: (() => { try { const a = JSON.parse(it.tags || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } })(),
          imageCount: (() => { try { const a = JSON.parse(it.images || '[]'); return Array.isArray(a) ? a.length : 0 } catch { return 0 } })(),
        }
      })
  } catch (e) {
    /* 读取失败保持空，页面显示空状态 */
  } finally {
    contentsLoading.value = false
  }
}

// 注意：ModuleViews 由 App.vue 的 v-else 挂载，首次进入某模块时组件刚挂载，
// watch 默认不捕获初始值 → 必须 immediate:true，否则首次进入不加载数据。
const onViewChange = (v) => {
  if (v === 'settings') { loadRealStatus(); loadComments(); loadAccStatus(); loadKeys(); loadGuard(); loadLibraryDocs(); loadKbEntries(); loadKbChat() }
  if (v === 'assets') { loadAssets(); api.imageStatus().then(r => { imgStatus.value = r }).catch(() => {}) }
  if (v === 'analytics') { loadMyNotes(); loadMetrics(); loadCreator(); loadCompetitors(); loadPerformance() }
  if (v === 'studio') { loadContents(); loadTrends(); loadAiStatus(); syncGenConfig(); syncStrategyTime(); api.imageStatus().then(r => { imgStatus.value = r }).catch(() => {}) }
  if (v === 'library') { loadLibrary(); loadLibraryDocs() }
  if (v === 'schedule') {
    loadContents(); loadPublish(true); loadPubSettings()
    if (!weekSelected.value) weekSelected.value = isoDate(new Date())
  }
  if (v === 'outline' || v === 'dashboard') { loadContents(); loadPositioning(); loadCompetitors(); loadWeekPlan(); loadOutline(); loadChat(); loadReplySetting(); loadInteractionFeed() }
}
/* -------- 内容趋势（真实：来自每日采集的指标快照） -------- */
const metricsRows = ref([])
const metricsLoading = ref(false)
const collecting = ref(false)

async function loadMetrics() {
  metricsLoading.value = true
  try {
    const r = await api.metrics()
    metricsRows.value = r.items || []
  } catch (e) {
    metricsRows.value = []
  } finally {
    metricsLoading.value = false
  }
}

// 结算"今天"的快照：抓自己所有笔记的互动数存一份
async function collectToday() {
  collecting.value = true
  try {
    if (!myNotes.value.length) await loadMyNotes()
    const list = myNotes.value.slice(0, 20)
    let n = 0
    for (const it of list) {
      try {
        await api.collectMetrics(it.id, it.xsecToken)
        n++
      } catch (e) { /* 单篇失败不阻塞 */ }
    }
    await loadMetrics()
    showNotice(`已采集 ${n} 篇笔记的今日数据`)
  } catch (e) {
    showNotice('采集失败：' + (e.message || '未知错误'))
  } finally {
    collecting.value = false
  }
}

// 小红书图片有防盗链 → 走本地代理
function imgProxy(u) {
  if (!u) return ''
  if (u.startsWith('/') || u.startsWith('data:')) return u
  return '/api/img?url=' + encodeURIComponent(u)
}

/* -------- AI 生图两档（R15） -------- */
const imgForm = ref({ prompt: '', tier: 'standard', ratio: '1:1', contentId: '' })
const imgBusy = ref(false)
const imgExpanding = ref(false)
const imgResult = ref(null)
const imgExpanded = ref('')
const imgError = ref('')
const imgHistory = ref([])
const imgStatus = ref(null)

async function expandImgPrompt() {
  if (!imgForm.value.prompt.trim()) { showNotice('先写一句需求'); return }
  imgExpanding.value = true
  imgError.value = ''
  try {
    const r = await api.expandPrompt({ prompt: imgForm.value.prompt })
    imgExpanded.value = r.expanded
    showNotice('已扩写（这一步不花生图费用）')
  } catch (e) {
    imgError.value = '扩写失败：' + (e.message || '')
  } finally {
    imgExpanding.value = false
  }
}

async function runImgGen() {
  const prompt = (imgExpanded.value || imgForm.value.prompt || '').trim()
  if (!prompt) { showNotice('先写需求或先扩写提示词'); return }
  if (!window.confirm(`确认用「${imgForm.value.tier === 'fine' ? '精细档(4K)' : '标准档(2K)'}」生成 1 张图？\n会产生真实 API 费用。`)) return
  imgBusy.value = true
  imgError.value = ''
  imgResult.value = null
  try {
    const r = await api.generateImage({
      prompt,
      tier: imgForm.value.tier,
      ratio: imgForm.value.ratio,
      contentId: imgForm.value.contentId ? Number(imgForm.value.contentId) : null,
    })
    imgResult.value = r
    imgHistory.value.unshift(r)
    showNotice(`出图完成：${r.tierName} ${r.imageSize}，耗时 ${(r.spentMsTotal / 1000).toFixed(0)} 秒`)
    await loadAssets()
  } catch (e) {
    imgError.value = '出图失败：' + (e.message || '')
  } finally {
    imgBusy.value = false
  }
}

/* -------- 评论自动回复（R14） -------- */
const commentStats = ref(null)
const commentList = ref([])
const commentFilter = ref('pending_review')
const commentBusy = ref(false)
const personaCard = ref(null)
const forbiddenText = ref('')
const knowledgeItems = ref([])
const knowledgeForm = ref({ category: '', question: '', answer: '', keywords: '' })
const takeoverItems = ref([])
const manualReplyText = ref({})

const COMMENT_STATE = { auto: '自动回复', manual: '人工回复', pending_review: '待人工', skipped: '已跳过' }

async function loadComments() {
  commentBusy.value = true
  try {
    const [s, l, p, f, k, t] = await Promise.all([
      api.commentStats(), api.commentList(commentFilter.value || undefined),
      api.persona(), api.forbiddenWords(), api.knowledge(), api.takeoverList(),
    ])
    commentStats.value = s.stats
    commentList.value = l.items || []
    personaCard.value = p.persona
    forbiddenText.value = (f.words || []).join(' ')
    knowledgeItems.value = k.items || []
    takeoverItems.value = t.items || []
  } catch (e) {
    showNotice('读取评论配置失败：' + (e.message || ''))
  } finally {
    commentBusy.value = false
  }
}

async function switchCommentFilter(v) { commentFilter.value = v; await loadComments() }

async function pollCommentsNow() {
  commentBusy.value = true
  try {
    const r = await api.pollComments(20)
    showNotice(`已拉取 ${r.fetched} 条，处理 ${r.handled} 条` + (r.byDecision ? `（${Object.entries(r.byDecision).map(([k, v]) => k + ' ' + v).join('、')}）` : ''))
    await loadComments()
  } catch (e) { showNotice('轮询失败：' + (e.message || '')) } finally { commentBusy.value = false }
}

async function approveReply(c) {
  if (!window.confirm('确认把这条回复发送到小红书？')) return
  try { await api.approveComment(c.id); showNotice('已发送'); await loadComments() }
  catch (e) { showNotice('发送失败：' + (e.message || '')) }
}

async function sendManualReply(c) {
  const text = (manualReplyText.value[c.id] || '').trim()
  if (!text) { showNotice('先填写回复内容'); return }
  try {
    await api.replyCommentManual(c.id, text)
    showNotice('已发送，并已把该用户加入人工介入名单')
    manualReplyText.value[c.id] = ''
    await loadComments()
  } catch (e) { showNotice('发送失败：' + (e.message || '')) }
}

async function addTakeoverByUser(c) {
  try { await api.addTakeover({ userId: c.user_id, nickname: c.user_name, reason: '手动加入' }); showNotice('已加入人工介入名单'); await loadComments() }
  catch (e) { showNotice('失败：' + (e.message || '')) }
}

async function removeTakeoverItem(userId) {
  try { await api.removeTakeover(userId); await loadComments() } catch (e) { showNotice('失败：' + (e.message || '')) }
}

async function savePersonaCard() {
  try { await api.savePersona(personaCard.value); showNotice('人设卡已保存') } catch (e) { showNotice('保存失败：' + (e.message || '')) }
}

async function saveForbidden() {
  const words = forbiddenText.value.split(/[\s,，]+/).filter(Boolean)
  try { await api.saveForbiddenWords(words); showNotice(`已保存 ${words.length} 个禁用词`) } catch (e) { showNotice('保存失败：' + (e.message || '')) }
}

async function addKnowledgeItem() {
  if (!knowledgeForm.value.question && !knowledgeForm.value.answer) { showNotice('问题和答案至少填一个'); return }
  try {
    await api.addKnowledge({
      category: knowledgeForm.value.category,
      question: knowledgeForm.value.question,
      answer: knowledgeForm.value.answer,
      keywords: knowledgeForm.value.keywords.split(/[\s,，]+/).filter(Boolean),
    })
    showNotice('已加入知识库')
    knowledgeForm.value = { category: '', question: '', answer: '', keywords: '' }
    await loadComments()
  } catch (e) { showNotice('添加失败：' + (e.message || '')) }
}

/* -------- 数据洞察（R21）：逐篇数据（契约3）+ AI 整体解读/高潜方向（契约2） -------- */
const perf = ref(null)
const perfLoading = ref(false)
const perfError = ref('')

async function loadPerformance() {
  perfLoading.value = true
  perfError.value = ''
  try {
    const r = await api.performance(30)
    perf.value = r
  } catch (e) {
    perfError.value = '读取逐篇数据失败：' + (e.message || '未知错误')
    perf.value = null
  } finally {
    perfLoading.value = false
  }
}

// 契约2 真调 DeepSeek（约 5–15 秒）：一次生成同时填充「整体数据分析解读」与「高潜内容方向」；
// 不随页面自动触发，避免每次进页面都产生 AI 费用
const insight = ref(null)
const insightLoading = ref(false)
const insightError = ref('')

async function loadInsight() {
  if (insightLoading.value) return
  insightLoading.value = true
  insightError.value = ''
  try {
    insight.value = await api.insight()
  } catch (e) {
    // 契约2 的 ok:false（无 Key / 样本不足 / AI 失败）会带 reason；req() 统一抛出，优先读 e.data.reason
    insightError.value = (e && e.data && e.data.reason) || (e && e.message) || '未知错误'
    insight.value = null
  } finally {
    insightLoading.value = false
  }
}

// generated_at 兼容（13 位毫秒 / 10 位秒 / 字符串时间）
const fmtInsightTime = (t) => {
  if (!t) return ''
  const raw = String(t)
  let ms = NaN
  if (/^\d{13}$/.test(raw)) ms = Number(raw)
  else if (/^\d{10}$/.test(raw)) ms = Number(raw) * 1000
  else ms = Date.parse(raw.replace(' ', 'T'))
  if (!Number.isFinite(ms)) return raw.slice(0, 16)
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* -------- 复盘报告与建议（R12） -------- */
const report = ref(null)
const reportLoading = ref(false)
const reportError = ref('')
const snapshotBusy = ref(false)

async function loadReport() {
  reportLoading.value = true
  reportError.value = ''
  try {
    const r = await api.buildReport({ days: 30, useAI: true })
    report.value = r
  } catch (e) {
    reportError.value = '生成复盘失败：' + (e.message || '')
  } finally {
    reportLoading.value = false
  }
}

async function collectSnapshotNow() {
  snapshotBusy.value = true
  try {
    const r = await api.collectSnapshots()
    showNotice(`快照采集完成：扫描 ${r.scanned} 篇，更新 ${r.updated} 条`)
    await loadReport()
  } catch (e) {
    showNotice('采集失败：' + (e.message || ''))
  } finally {
    snapshotBusy.value = false
  }
}

/* -------- 对标账号监控（R11） -------- */
const competitors = ref([])
const compLoading = ref(false)
const compDiscovering = ref(false)
const compDiscover = ref(null)
const compDeepBusy = ref(null)
const compError = ref('')

async function loadCompetitors() {
  compLoading.value = true
  compError.value = ''
  try {
    const r = await api.competitors()
    competitors.value = r.items || []
  } catch (e) {
    compError.value = '读取对标账号失败：' + (e.message || '')
  } finally {
    compLoading.value = false
  }
}

async function discoverCompetitors() {
  compDiscovering.value = true
  compDiscover.value = null
  try {
    compDiscover.value = await api.discoverCompetitors({})
  } catch (e) {
    compError.value = '发现失败：' + (e.message || '')
  } finally {
    compDiscovering.value = false
  }
}

async function addCompetitorItem(c) {
  try {
    await api.addCompetitor({ userId: c.authorId, nickname: c.nickname })
    showNotice('已加入监控：' + c.nickname)
    await loadCompetitors()
    await discoverCompetitors()
  } catch (e) {
    showNotice('添加失败：' + (e.message || ''))
  }
}

async function removeCompetitorItem(id) {
  if (!window.confirm('确认移出监控？')) return
  try {
    await api.removeCompetitor(id)
    await loadCompetitors()
  } catch (e) { showNotice('移除失败：' + (e.message || '')) }
}

async function deepAnalyze(id) {
  compDeepBusy.value = id
  showNotice('深度分析中：要逐条拉笔记详情补发布时间，约 1 分钟…')
  try {
    const r = await api.deepAnalyzeCompetitor(id, { limit: 6, gapMs: 4500 })
    showNotice(r.filled ? `已补齐 ${r.filled} 条发布时间` : ('未取到发布时间：' + (r.note || '')))
    await loadCompetitors()
  } catch (e) {
    showNotice('深度分析失败：' + (e.message || ''))
  } finally {
    compDeepBusy.value = null
  }
}

/* -------- 发布系统（M1：队列 / 排期 / 预检 / 建议时间） -------- */
const pubTasks = ref([])
const pubLoading = ref(false)
const pubError = ref('')
const bestTime = ref(null)
const scheduleForm = ref({ contentId: '', scheduledAt: '' })
const scheduleSaving = ref(false)
const precheckResult = ref(null)
const precheckFor = ref(null)
const pubRunning = ref(null)

/* -------- 自动发布调度开关（真实状态，2026-09-23 加）--------
 * 改造前：「自动发布调度 · 已开启」是写死文案，开关也是死的（服务端根本不读任何开关）。
 * 现在开关真的落在后端 settings 表，前端只显示后端返回的真实状态；
 * 读不到就显示「状态未知」，绝不假装已开启。
 */
const sched = ref({ enabled: false, intervalSec: 60, preMinutes: 15, lastTickAt: null, pending: 0 })
const schedLoading = ref(true)
const schedSaving = ref(false)
const schedError = ref('')

const schedText = computed(() => {
  if (schedError.value) return '状态未知'
  if (schedLoading.value) return '读取中…'
  return sched.value.enabled ? '已开启' : '已暂停'
})

const schedDetail = computed(() => {
  if (schedError.value) return schedError.value
  const s = sched.value
  if (!s.enabled) return '已暂停：到点不会自动发布，手动「立即发布」仍可用'
  const last = s.lastTickAt ? ` · 最近扫描 ${String(s.lastTickAt).slice(11, 16)}` : ' · 尚未扫描过'
  return `每 ${s.intervalSec || 60} 秒扫描 · 到点前 ${s.preMinutes || 15} 分钟预检${last}`
})

async function loadScheduler() {
  schedLoading.value = true
  schedError.value = ''
  try {
    const r = await api.schedulerState()
    sched.value = { ...sched.value, ...r }
  } catch (e) {
    schedError.value = '读取调度状态失败：' + (e.message || '')
  } finally {
    schedLoading.value = false
  }
}

async function toggleScheduler() {
  if (schedSaving.value || schedError.value) return
  const next = !sched.value.enabled
  schedSaving.value = true
  try {
    const r = await api.setSchedulerState(next)
    sched.value = { ...sched.value, ...r }
    showNotice(next ? '自动发布调度已开启' : '自动发布调度已暂停（手动发布不受影响）')
  } catch (e) {
    showNotice('切换失败：' + (e.message || ''))
    await loadScheduler()   // 失败就回读真实状态，不留下一个假开关
  } finally {
    schedSaving.value = false
  }
}

async function loadPublish(pickBest = false) {
  pubLoading.value = true
  pubError.value = ''
  try {
    const r = await api.publishTasks()
    pubTasks.value = r.items || []
    if (pickBest || !scheduleForm.value.scheduledAt) {
      const bt = await api.bestTime()
      bestTime.value = bt
      const t = tomorrowAt(bt.recommended)
      if (!scheduleForm.value.scheduledAt) scheduleForm.value.scheduledAt = t
    }
  } catch (e) {
    pubError.value = '读取发布队列失败：' + (e.message || '')
  } finally {
    pubLoading.value = false
  }
}

function tomorrowAt(hhmm) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${hhmm || '19:30'}:00`
}

function useBestTime() {
  if (bestTime.value?.recommended) {
    scheduleForm.value.scheduledAt = tomorrowAt(bestTime.value.recommended)
    showNotice('已采用建议时间 ' + bestTime.value.recommended)
  }
}

async function doSchedule() {
  if (!scheduleForm.value.contentId) { showNotice('请先选择一条内容'); return; }
  scheduleSaving.value = true
  pubError.value = ''
  try {
    await api.schedulePublish({
      contentId: Number(scheduleForm.value.contentId),
      scheduledAt: scheduleForm.value.scheduledAt,
    })
    showNotice('已加入发布队列')
    await loadPublish()
  } catch (e) {
    pubError.value = '排期失败：' + (e.message || '')
  } finally {
    scheduleSaving.value = false
  }
}

async function cancelPubTask(id) {
  if (!window.confirm('确认取消这个发布任务？')) return
  try {
    await api.cancelPubTask(id)
    showNotice('已取消')
    await loadPublish()
  } catch (e) { showNotice('取消失败：' + (e.message || '')) }
}

async function runPrecheck(id) {
  precheckFor.value = id
  precheckResult.value = null
  try {
    const r = await api.precheckPublish({ contentId: id })
    precheckResult.value = r
  } catch (e) { showNotice('预检失败：' + (e.message || '')) }
}

async function publishNow(task) {
  const t = pubTasks.value.find((x) => x.id === task.id)
  if (!window.confirm(`确认立即发布《${t?.content_title || ''}》到小红书账号？\n这会真实发布到你的账号上。`)) return
  pubRunning.value = task.id
  try {
    const r = await api.runPubTask(task.id)
    if (r.ok) showNotice('已发布成功');
    else showNotice('发布未完成：' + (r.error || ''));
    await loadPublish()
  } catch (e) {
    showNotice('发布失败：' + (e.message || ''))
  } finally {
    pubRunning.value = null
  }
}

const PUB_STATE = { pending: '待发布', precheck: '预检中', publishing: '发布中', done: '已发布', failed: '失败', canceled: '已取消' };

/* -------- 文案编辑器 + 审核 + 手动查重（M2.9 / M2.10） -------- */
const editorOpen = ref(false)
const editForm = ref({ id: null, title: '', body: '', tagsText: '' })
const editSaving = ref(false)
const editError = ref('')
const dupResult = ref(null)
const dupChecking = ref(false)

function openEditor(item) {
  editForm.value = {
    id: item.id,
    title: item.title || '',
    body: item.body || '',
    tagsText: (item.tags || []).join(' '),
  }
  dupResult.value = null
  editError.value = ''
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
  dupResult.value = null
}

async function saveEdit(status) {
  editSaving.value = true
  editError.value = ''
  try {
    const tags = editForm.value.tagsText.split(/[\s,，]+/).filter(Boolean)
    const payload = { title: editForm.value.title, body: editForm.value.body, tags }
    if (status) payload.status = status
    await api.updateContent(editForm.value.id, payload)
    showNotice(status === 'approved' ? '已通过审核' : (status === 'rejected' ? '已退回' : '已保存'))
    await loadContents()
    if (status) closeEditor()
  } catch (e) {
    editError.value = '保存失败：' + (e.message || '')
  } finally {
    editSaving.value = false
  }
}

async function checkDupNow() {
  dupChecking.value = true
  dupResult.value = null
  try {
    const r = await api.checkDuplicate({
      title: editForm.value.title,
      body: editForm.value.body,
      excludeId: editForm.value.id,
    })
    dupResult.value = r
    // 查重结果即时落库（dup_score 用 0–1 存储，与生成流程一致）
    await api.updateContent(editForm.value.id, {
      dup_score: r.score / 100,
      dup_with: r.mostSimilar ? r.mostSimilar.id : null,
    })
  } catch (e) {
    editError.value = '查重失败：' + (e.message || '')
  } finally {
    dupChecking.value = false
  }
}

async function scanAllDrafts() {
  try {
    const r = await api.scanDup()
    showNotice(`已扫描 ${r.total} 条：通过 ${r.pass}，超标 ${r.fail}`)
    await loadContents()
  } catch (e) {
    showNotice('扫描失败：' + (e.message || ''))
  }
}

async function saveEditById(id, status) {
  try {
    await api.updateContent(id, { status })
    await loadContents()
    showNotice(status === 'approved' ? '已通过审核' : '已退回')
  } catch (e) {
    showNotice('操作失败：' + (e.message || ''))
  }
}

async function removeContent(id) {
  if (!window.confirm('确认删除这条草稿？')) return
  try {
    await api.updateContent(id, { status: 'rejected' })
    await loadContents()
    showNotice('已退回（可在文案库查看）')
  } catch (e) {
    showNotice('操作失败：' + (e.message || ''))
  }
}

/* -------- AI 内容生成（策略输入 + 真实调用 DeepSeek） -------- */
const strategyInput = ref('')
const genDays = ref(7)
const genPostsPerDay = ref(2)
const genRunning = ref(false)
const genError = ref('')
const genResult = ref(null)
const aiReady = ref(null)

async function loadAiStatus() {
  try {
    const r = await api.aiStatus()
    aiReady.value = !!(r.deepseek && r.deepseek.ready)
  } catch { aiReady.value = false }
}

// 用运营计划表的「每天几条」做默认值
async function syncGenConfig() {
  try {
    const r = await api.planConfig()
    if (r.ok && r.postsPerDay) genPostsPerDay.value = r.postsPerDay
  } catch { /* 忽略 */ }
}

async function runGenerate() {
  if (genRunning.value) return
  genRunning.value = true
  genError.value = ''
  genResult.value = null
  try {
    const r = await api.generate({
      userIntent: strategyInput.value,
      postsPerDay: genPostsPerDay.value,
      days: genDays.value,
      dryRun: false,
    })
    genResult.value = r
    showNotice(`已生成 ${r.saved} 条草稿（${r.elapsed}s）`)
    await loadContents()
  } catch (e) {
    genError.value = '生成失败：' + (e.message || '未知错误')
  } finally {
    genRunning.value = false
  }
}

/* -------- 行业热榜（定时抓取 + 手动触发，真数据） -------- */
const trendItems = ref([])
const trendTotal = ref(0)
const trendLast = ref('')
const trendLoading = ref(false)
const trendScraping = ref(false)
const trendError = ref('')
const trendKeywords = ref([])

async function loadTrends() {
  trendLoading.value = true
  trendError.value = ''
  try {
    const r = await api.trends(40)
    trendItems.value = r.items || []
    trendTotal.value = r.total || 0
    trendLast.value = r.lastScrapedAt ? String(r.lastScrapedAt).slice(5, 16).replace('T', ' ') : ''
    const rk = await api.trendKeywords()
    if (rk.ok) trendKeywords.value = rk.keywords || []
  } catch (e) {
    trendError.value = '读取热榜失败：' + (e.message || '')
  } finally {
    trendLoading.value = false
  }
}

async function runScrapeNow() {
  trendScraping.value = true
  trendError.value = ''
  try {
    const r = await api.scrapeTrends(trendKeywords.value)
    const saved = (r.results || []).reduce((a, b) => a + (b.saved || 0), 0)
    const failed = (r.results || []).filter((x) => x.error)
    showNotice(`抓取完成：新增 ${saved} 条` + (failed.length ? `，${failed.length} 个关键词失败（可能被限流，稍后再试）` : ''))
    await loadTrends()
  } catch (e) {
    trendError.value = '抓取失败：' + (e.message || '')
  } finally {
    trendScraping.value = false
  }
}

/* -------- 运营计划表（账号定位 + 内容支柱 = 内容生成总纲） -------- */
const positioningLoading = ref(false)
const positioningError = ref('')
const positioning = ref({ persona: '', audience: '', tone: '', selling: '', goal: '' })
const pillars = ref([])
const pillarsDefault = ref(false)
const postsPerDay = ref(1)
const savingPositioning = ref(false)

async function loadPositioning() {
  positioningLoading.value = true
  positioningError.value = ''
  try {
    const [r1, r2] = await Promise.all([api.positioning(), api.planConfig()])
    if (r1.ok) {
      pillars.value = r1.pillars || []
      pillarsDefault.value = !!r1.isDefault
      if (r1.data) {
        positioning.value = {
          persona: r1.data.persona || '',
          audience: r1.data.audience || '',
          tone: r1.data.tone || '',
          selling: r1.data.selling || '',
          goal: r1.data.goal || '',
        }
      }
    }
    if (r2.ok) postsPerDay.value = r2.postsPerDay || 1
  } catch (e) {
    positioningError.value = '读取运营计划表失败：' + (e.message || '')
  } finally {
    positioningLoading.value = false
  }
}

async function savePositioning() {
  savingPositioning.value = true
  try {
    await api.savePositioning({ ...positioning.value, pillars: pillars.value })
    await api.savePlanConfig(postsPerDay.value)
    pillarsDefault.value = false
    showNotice('运营计划表已保存')
  } catch (e) {
    showNotice('保存失败：' + (e.message || ''))
  } finally {
    savingPositioning.value = false
  }
}

const weekTotal = computed(() => postsPerDay.value * 7)

/* -------- 本周大纲（真实读 /api/plans，2026-09-23 加）--------
 * 改造前：「本周主线：找到适合自己的风格」「3 / 7 天」「认知建立阶段进行中」全是写死的。
 * 现在真读 plans 表：有记录就显示真实主线与真实节点进度；没有就明确说「还没有创建」，
 * 不编一条看起来很像的主线糊上去。
 */
const weekPlan = ref(null)
const weekPlanLoading = ref(false)
const weekPlanError = ref('')

const weekPlanNodes = computed(() => {
  const p = weekPlan.value
  if (!p) return []
  try {
    const arr = JSON.parse(p.nodes || '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
})
const weekPlanTotal = computed(() => weekPlanNodes.value.length)
const weekPlanDone = computed(() => weekPlanNodes.value.filter(
  (n) => n && (n.status === 'done' || n.done === true || n.completed === true),
).length)
const weekPlanPercent = computed(() => (
  weekPlanTotal.value ? Math.round((weekPlanDone.value / weekPlanTotal.value) * 100) : 0
))
const weekPlanMeta = computed(() => {
  const p = weekPlan.value
  if (!p) return ''
  const bits = []
  if (p.week_start) bits.push('周起始 ' + String(p.week_start).slice(0, 10))
  const st = { drafting: '草拟中', active: '执行中', running: '执行中', done: '已完成' }[p.status]
  bits.push(st || (p.status ? '状态 ' + p.status : '状态未标注'))
  bits.push(weekPlanTotal.value ? `共 ${weekPlanTotal.value} 个节点` : '暂无节点')
  return bits.join(' · ')
})
const positioningReady = computed(() => {
  const p = positioning.value || {}
  return !!(p.persona || p.audience || p.tone || p.selling || p.goal)
})

async function loadWeekPlan() {
  weekPlanLoading.value = true
  weekPlanError.value = ''
  try {
    const r = await api.plans()
    weekPlan.value = (r.items || [])[0] || null
  } catch (e) {
    weekPlan.value = null
    weekPlanError.value = '读取本周大纲失败：' + (e.message || '')
  } finally {
    weekPlanLoading.value = false
  }
}

// 故事线节点状态：按内容真实状态显示（原来按下标写死「已完成 / 今天重点执行」= 假进度）
const STORY_HINT = {
  published: '已发布',
  scheduled: '已排期 · 等发布',
  approved: '已通过 · 待排期',
  rejected: '已退回 · 需修改',
  draft: '草稿 · 未通过门禁',
}
function nodeHint(item) {
  return STORY_HINT[item.rawStatus] || (item.rawStatus ? '状态 ' + item.rawStatus : '状态未知')
}

/* -------- 平台数据（创作者中心：浏览量/涨粉/曝光，真数据） -------- */
const creatorData = ref(null)
const creatorLoading = ref(false)
const creatorError = ref('')
const creatorWindow = ref('thirty')

async function loadCreator() {
  creatorLoading.value = true
  creatorError.value = ''
  try {
    const r = await api.creatorOverview()
    creatorData.value = r.ok ? r : null
  } catch (e) {
    creatorError.value = '读取平台数据失败：' + (e.message || '未知错误')
    creatorData.value = null
  } finally {
    creatorLoading.value = false
  }
}

// 当前窗口的平台指标
const platformWindow = computed(() => {
  const d = creatorData.value
  if (!d) return null
  return d[creatorWindow.value] || null
})

// 平台 KPI（浏览量/涨粉/曝光/观看时长）
const platformKpis = computed(() => {
  const w = platformWindow.value
  if (!w) return []
  const get = (k) => (w.summary || []).find((s) => s.key === k) || {}
  const views = get('view_count')
  const fans = get('rise_fans_count')
  const home = get('home_view_count')
  const fmt = (v) => (v === null || v === undefined ? '—' : String(v))
  const rate = (v) => (v === null || v === undefined ? '' : (v >= 0 ? '+' : '') + v + '%')
  return [
    { label: '浏览量', value: fmt(views.total), delta: rate(views.rate) || '平台数据' },
    { label: '涨粉', value: fmt(fans.total), delta: rate(fans.rate) || '平台数据' },
    { label: '首页曝光', value: fmt(home.total), delta: rate(home.rate) || '平台数据' },
    { label: '平均观看(秒)', value: fmt(w.viewTimeAvg), delta: '平台数据' },
  ]
})

// 平台曲线：用每日浏览量（真数据）
const platformPoints = computed(() => {
  const w = platformWindow.value
  if (!w) return []
  const s = (w.series || {}).view_count || []
  return s.map((p) => ({ date: String(p.date).slice(5).replace('-', '/'), value: Number(p.count) || 0 }))
})

// 按日期聚合总点赞
const trendPoints = computed(() => {
  const byDate = {}
  for (const m of metricsRows.value) {
    const dt = String(m.date || '').slice(5, 10).replace('-', '/')
    if (!dt) continue
    byDate[dt] = (byDate[dt] || 0) + (Number(m.likes) || 0)
  }
  return Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).map(([date, likes]) => ({ date, likes }))
})

const CHART = { x0: 45, y0: 215, w: 645, h: 180 }

const chartLine = computed(() => {
  const pts = platformPoints.value.length >= 2
    ? platformPoints.value.map((p) => ({ likes: p.value }))
    : trendPoints.value
  if (pts.length < 2) return ''
  const max = Math.max(...pts.map((p) => p.likes), 1)
  const step = CHART.w / (pts.length - 1)
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(CHART.x0 + i * step).toFixed(1)} ${(CHART.y0 - (p.likes / max) * CHART.h).toFixed(1)}`)
    .join(' ')
})

const chartArea = computed(() => {
  if (!chartLine.value) return ''
  const lastX = CHART.x0 + CHART.w
  return `${chartLine.value} L${lastX} ${CHART.y0} L${CHART.x0} ${CHART.y0} Z`
})

const chartLabelX = (i, arr) => {
  const list = arr || (platformPoints.value.length >= 2 ? platformPoints.value : trendPoints.value)
  const n = Math.max(list.length - 1, 1)
  return CHART.x0 + i * (CHART.w / n)
}

// R21 重排：数据点多时 x 轴标签均匀抽 7 个（30 天全画会挤成一排）
const chartTicks = computed(() => {
  const list = platformPoints.value.length >= 2 ? platformPoints.value : trendPoints.value
  if (list.length <= 8) return list.map((p, i) => ({ key: p.date + '_' + i, i, date: p.date }))
  const idx = []
  for (let k = 0; k < 7; k++) idx.push(Math.round((k * (list.length - 1)) / 6))
  return [...new Set(idx)].map((i) => ({ key: list[i].date + '_' + i, i, date: list[i].date }))
})

// R21 重排：曲线末端值与峰值标注
const chartMarks = computed(() => {
  const pts = platformPoints.value.length >= 2
    ? platformPoints.value.map((p) => ({ date: p.date, value: p.value }))
    : trendPoints.value.map((p) => ({ date: p.date, value: p.likes }))
  if (pts.length < 2) return []
  const max = Math.max(...pts.map((p) => p.value), 1)
  const step = CHART.w / (pts.length - 1)
  const at = (i) => ({ x: CHART.x0 + i * step, y: CHART.y0 - (pts[i].value / max) * CHART.h })
  let maxI = 0
  pts.forEach((p, i) => { if (p.value > pts[maxI].value) maxI = i })
  const marks = []
  const lastI = pts.length - 1
  const lastP = at(lastI)
  marks.push({ kind: 'last', x: lastP.x, y: lastP.y, label: pts[lastI].value.toLocaleString(), anchor: 'end' })
  if (maxI !== lastI && maxI !== 0) {
    const pkP = at(maxI)
    marks.push({ kind: 'peak', x: pkP.x, y: pkP.y, label: pts[maxI].value.toLocaleString(), anchor: 'middle' })
  }
  return marks
})

watch(() => props.activeView, onViewChange)

// 七天内容卡片复用同一条认知到转化的故事线。
const weeklyContents = ref([])

const scheduleItems = ref([])

// 素材库数据：来自本机服务（「在线素材」= 上传图 + AI 生成图统一存放）
const assets = computed(() =>
  (assetItems.value || []).map((it) => ({
    id: it.id,
    type: it.kind === 'generated' ? 'AI生成' : (it.kind === 'history' ? '历史' : '上传'),
    title: it.name,
    meta: it.width ? `${it.width}×${it.height}` : '',
    url: it.url || '',
    tone: 'rose',
  })),
)

const generating = ref(false)
const generationDone = ref(false)
const autoPublish = ref(true)
const assetFilter = ref('全部')
const selectedAssets = ref([])
const selectedOutlineDay = ref(2)
const libraryQuery = ref('')
const systemToggles = ref({ review: true, rewrite: true, publish: false })
const notice = ref('')
let generationTimer
let noticeTimer

const filteredAssets = computed(() => (
  assetFilter.value === '全部' ? assets.value : assets.value.filter((item) => item.type === assetFilter.value)
))

const filteredLibrary = computed(() => {
  const query = libraryQuery.value.trim().toLowerCase()
  const rows = libraryRows.value
  if (!query) return rows
  return rows.filter((item) => `${item.title}${item.topic}${item.status}`.toLowerCase().includes(query))
})

// 把选中的素材真正挂到目标内容上（配图），落库 assets.content_id
const attachSelected = async () => {
  if (!selectedAssets.value.length) { showNotice('先选素材'); return }
  const day = Number(selectedOutlineDay.value)
  const target = (weeklyContents.value || []).find(
    (c) => Number(c.dayIndex ?? c.day_index ?? -1) === day,
  )
  if (!target?.id) {
    showNotice(`D${day + 1} 还没有内容草稿 —— 先去「内容工坊」生成，再回来挂图`)
    return
  }
  try {
    for (const aid of selectedAssets.value) await api.attachAsset(aid, target.id)
    showNotice(`已把 ${selectedAssets.value.length} 张素材挂到 D${day + 1} 内容上（已落库）`)
    selectedAssets.value = []
    await loadAssets()
  } catch (e) {
    showNotice('挂图失败：' + (e.message || '未知错误'))
  }
}

// 素材卡支持多选，便于演示批量加入内容任务。
const toggleAsset = (id) => {
  selectedAssets.value = selectedAssets.value.includes(id)
    ? selectedAssets.value.filter((item) => item !== id)
    : [...selectedAssets.value, id]
}

// 设置开关：真实保存到本机数据库（settings 表），刷新后仍生效。
const toggleSetting = async (key) => {
  const next = { ...systemToggles.value, [key]: !systemToggles.value[key] }
  systemToggles.value = next
  try {
    await api.saveSetting('toggle_' + key, next[key] ? '1' : '0')
    showNotice('设置已保存')
  } catch (e) {
    showNotice('保存失败：' + (e.message || '未知错误'))
  }
}

// 真正重跑一次本机环境检测（不是假提示）
const recheckEnv = async () => {
  showNotice('正在重新检测本机环境…')
  await loadRealStatus()
  const ok = healthyCount.value
  showNotice(ok >= 4 ? `复检完成：${ok}/4 项正常` : `复检完成：仅 ${ok}/4 项正常，请查看红项`)
}

// 轻提示用于确认演示操作已经生效。
const showNotice = (message) => {
  window.clearTimeout(noticeTimer)
  notice.value = message
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 2200)
}

/* ---- R19 收口：封面图 / 生图档位（按渠道真实能力）/ 编辑器配图 / 策略时间 ---- */
const imgTiers = computed(() => {
  const t = imgStatus.value && imgStatus.value.tiers ? imgStatus.value.tiers : null
  return t ? Object.values(t) : [{ key: 'standard', name: '标准档', pixels: '—' }]
})

// 待发送内容卡上的封面（contents.images 的第一张）
function coverOf(it) {
  const arr = it && it.images ? it.images : []
  return arr.length && arr[0] && arr[0].url ? arr[0].url : ''
}

// 编辑器里的配图（打开编辑器时按内容 ID 从池子里取）
const editorImages = computed(() => {
  const id = editForm.value.id
  const row = (poolRows.value || []).find((x) => x.id === id)
  return row && row.images ? row.images : []
})

// 生成后的排期时间默认取运营策略的发布时间表（19:30 这类）
async function syncStrategyTime() {
  try {
    const r = await api.outline()
    const t = r && r.strategy && r.strategy.postTime
    if (t && /^\d{1,2}:\d{2}$/.test(t)) genScheduleTime.value = t
  } catch { /* 没策略就用 19:30 */ }
}

/* ================= 系统设置：账号/密钥/保护开关/知识库（客户机没有 Hermes，全部界面可操作） ================= */

const acc = ref({ loading: true, loggedIn: false, username: '' })
const qr = ref({ img: '', busy: false, error: '', left: 0, justOk: false })
let qrTimer = null
let qrPoll = null

async function loadAccStatus() {
  acc.value = { ...acc.value, loading: true }
  try {
    const s = await api.mcpStatus()
    acc.value = { loading: false, loggedIn: !!s.loggedIn, username: s.username || '' }
  } catch (e) {
    acc.value = { loading: false, loggedIn: false, username: '' }
  }
  return acc.value
}

/** 二维码直接嵌在设置页里（切换账号 / 首次登录） */
async function openSwitchAccount() {
  qr.value = { img: '', busy: true, error: '', left: 0, justOk: false }
  clearInterval(qrTimer)
  clearTimeout(qrPoll)
  try {
    const r = await api.mcpQrcode()
    const d = (r && r.data) || {}
    const img = String(d.img || '')
    if (!img.startsWith('data:image')) throw new Error('二维码返回异常')
    qr.value = { img, busy: false, error: '', left: Math.round((Number(d.timeout) > 1000 ? Number(d.timeout) / 1000 : 240)), justOk: false }
    qrTimer = setInterval(() => { qr.value = { ...qr.value, left: Math.max(0, qr.value.left - 1) } }, 1000)
    const poll = async () => {
      const s = await loadAccStatus()
      if (s.loggedIn) {
        clearInterval(qrTimer)
        qr.value = { img: '', busy: false, error: '', left: 0, justOk: true }
        showNotice('登录成功：' + (s.username || ''))
        return
      }
      qrPoll = setTimeout(poll, 4000)
    }
    qrPoll = setTimeout(poll, 4000)
  } catch (e) {
    qr.value = { img: '', busy: false, error: '获取二维码失败：' + (e.message || ''), left: 0, justOk: false }
  }
}

/* ---- 密钥：手动输入 + 保存并检查 ---- */
const keyForm = ref({ deepseekKey: '', deepseekBase: '', deepseekModel: '', imageKey: '', imageBase: '', imageProvider: '' })
const ds = ref({ ready: false, keyMasked: null, base: '', model: '' })
const img = ref({ ready: false, provider: '', providerName: '', model: '', base: '', keyMasked: null, tiers: null, providers: [] })
const keyBusy = ref('')
const keyResult = ref({})
const shotBusy = ref(false)
const shotResult = ref(null)

async function loadKeys() {
  try {
    const r = await api.keysStatus()
    ds.value = r.deepseek || ds.value
    img.value = r.image || img.value
    if (!keyForm.value.imageProvider && img.value.provider) keyForm.value.imageProvider = img.value.provider
  } catch (e) { /* 读不到就保持空 */ }
}

async function saveAndTest(target) {
  keyBusy.value = target
  keyResult.value = { ...keyResult.value, [target]: null }
  try {
    const payload = {}
    if (target === 'deepseek') {
      if (keyForm.value.deepseekKey) payload.deepseekKey = keyForm.value.deepseekKey
      if (keyForm.value.deepseekBase) payload.deepseekBase = keyForm.value.deepseekBase
      if (keyForm.value.deepseekModel) payload.deepseekModel = keyForm.value.deepseekModel
    } else {
      if (keyForm.value.imageKey) payload.imageKey = keyForm.value.imageKey
      if (keyForm.value.imageBase) payload.imageBase = keyForm.value.imageBase
      if (keyForm.value.imageProvider) payload.imageProvider = keyForm.value.imageProvider
    }
    if (Object.keys(payload).length) await api.saveKeys(payload)
    const r = await api.testKeys(target)
    keyResult.value = { ...keyResult.value, [target]: r[target] }
    await loadKeys()
    keyForm.value.deepseekKey = ''
    keyForm.value.imageKey = ''
    showNotice((r[target] && r[target].ok) ? '检查通过：可以用' : '检查未通过，看下面的报错')
  } catch (e) {
    keyResult.value = { ...keyResult.value, [target]: { ok: false, error: e.message || '保存失败' } }
  } finally {
    keyBusy.value = ''
  }
}

async function runTestShot() {
  shotBusy.value = true
  shotResult.value = null
  try {
    const r = await api.testShot()
    shotResult.value = r
    await loadAssets?.()
  } catch (e) {
    showNotice('试出失败：' + (e.message || ''))
  } finally {
    shotBusy.value = false
  }
}

/* ---- 内容与发布保护（真开关） ---- */
const guard = ref({ dedupeRewrite: true, autoSend: true, protect: true })
const guardSaving = ref(false)
async function loadGuard() {
  try { guard.value = await api.guardSettings() } catch { /* ignore */ }
}
async function toggleGuard(key) {
  if (guardSaving.value) return
  guardSaving.value = true
  try {
    const next = { [key]: !guard.value[key] }
    if (key === 'autoSend') next.protect = guard.value.protect
    const r = await api.setGuardSettings(next)
    guard.value = { dedupeRewrite: r.dedupeRewrite, autoSend: r.autoSend, protect: r.protect }
    showNotice('已保存')
  } catch (e) { showNotice('保存失败：' + (e.message || '')) } finally { guardSaving.value = false }
}

/* ---- 人设卡：恢复继承 ---- */
async function resetPersonaCard() {
  try {
    await api.savePersona({ name: '', role: '', tone: '', taboo: [] })
    await loadComments()
    showNotice('已恢复为继承运营大纲人设')
  } catch (e) { showNotice('操作失败：' + (e.message || '')) }
}

/* ---- 禁用词：默认专业词表 ---- */
const DEFAULT_WORDS = ['最好','最佳','第一','唯一','绝对','顶级','国家级','世界级','史上最','全网最低','最便宜','永久有效','100%','百分百','保证','包治','无效退款','治疗','治愈','根治','药效','特效','无痛','零风险','立竿见影','包瘦','加微信','私下转账','加v','微信号','免费送','同行不行','别家都是骗'];
const forbiddenCount = computed(() => String(forbiddenText.value || '').split(/[\s,，、\n]+/).filter(Boolean).length)
async function loadDefaultForbidden() {
  forbiddenText.value = DEFAULT_WORDS.join(' ')
  await saveForbidden()
}

/* ---- 知识库：条目 / 文档提炼 / AI 对话 ---- */
const kbEntries = ref([])
const kbFilter = ref('')
const kbChat = ref([])
const kbDraft = ref('')
const kbSending = ref(false)
const analyzeBusy = ref(null)

async function loadKbEntries() {
  try { const r = await api.knowledgeEntries(kbFilter.value); kbEntries.value = r.items || [] } catch { kbEntries.value = [] }
}
async function loadKbChat() {
  try { const r = await api.knowledgeChat(40); kbChat.value = r.items || [] } catch { kbChat.value = [] }
}
async function sendKnowledgeChat() {
  const t = kbDraft.value.trim()
  if (!t || kbSending.value) return
  kbSending.value = true
  kbDraft.value = ''
  try {
    const r = await api.sendKnowledgeChat(t)
    kbChat.value = [...kbChat.value, { id: 'u' + Date.now(), role: 'user', content: t }, { id: 'a' + Date.now(), role: 'assistant', content: r.reply, added: r.added }]
    if (r.addedCount) { showNotice(`已写入 ${r.addedCount} 条知识`); await loadKbEntries() }
  } catch (e) { showNotice('发送失败：' + (e.message || '')); kbDraft.value = t } finally { kbSending.value = false }
}
async function resetKnowledgeChat() {
  try { await api.resetKnowledgeChat(); kbChat.value = []; showNotice('对话已清空（知识条目不受影响）') } catch (e) { showNotice('清空失败：' + (e.message || '')) }
}
async function runAnalyze(d) {
  analyzeBusy.value = d.id
  try {
    const r = await api.analyzeDoc(d.id, 12)
    showNotice(`AI 从《${d.name}》提炼出 ${r.added} 条知识`)
    await loadKbEntries()
    await loadLibraryDocs()
  } catch (e) { showNotice('提炼失败：' + (e.message || '')) } finally { analyzeBusy.value = null }
}
async function removeKbEntry(k) {
  if (!window.confirm('确认删除这条知识？删除后相关问题将不再自动回复（转人工）。')) return
  try { await api.deleteKnowledgeEntry(k.id); await loadKbEntries(); showNotice('已删除') } catch (e) { showNotice('删除失败：' + (e.message || '')) }
}

/* ================= R22 运营大纲 / R23 互动区 / R24 资料库 ================= */

/* ---- R22 ---- */
const strategy = ref(null)
const strategyError = ref('')
const strategyBusy = ref(false)
const strategySaving = ref(false)
const strategyEditing = ref(false)
const strategyForm = ref({ howTo: '', goals: '', phasesText: '' })
const chatItems = ref([])
const chatDraft = ref('')
const chatSending = ref(false)
const blocksOpen = ref(false)
const blocksSaving = ref(false)
const blocks = ref({ persona: '', audience: '', selling: '', tone: '', goal: '' })

const blocksSummary = computed(() => {
  const b = blocks.value
  const parts = [b.persona, b.audience, b.selling].filter(Boolean)
  return parts.length ? parts.join('　|　') : '还没设置 —— 这三块决定生成的方向，填一次就够（保存后自动折叠）'
})

function formFromStrategy(s) {
  return {
    howTo: s.howTo || '',
    goals: s.goals || '',
    phasesText: (s.phases || []).map((p) => `${p.name || ''} | ${p.goal || ''} | ${(p.topics || []).join('、')}`).join('\n'),
  }
}

async function loadOutline() {
  try {
    const r = await api.outline()
    strategy.value = r.strategy && r.strategy.exists ? r.strategy : null
    strategyForm.value = r.strategy ? formFromStrategy(r.strategy) : formFromStrategy({})
    const p = r.positioning || {}
    blocks.value = {
      persona: [p.persona, p.tone].filter(Boolean).join('，'),
      audience: p.audience || '',
      selling: [p.selling, p.goal].filter(Boolean).join('；'),
      tone: p.tone || '',
      goal: p.goal || '',
    }
    // 已填过就默认折叠（不点开不展示）
    blocksOpen.value = !(blocks.value.persona || blocks.value.audience || blocks.value.selling)
  } catch (e) {
    strategyError.value = '读取运营大纲失败：' + (e.message || '')
  }
}

async function genStrategyDraft() {
  strategyBusy.value = true
  strategyError.value = ''
  try {
    const r = await api.genStrategy(strategyInput.value || '')
    strategy.value = r.strategy
    strategyForm.value = formFromStrategy(r.strategy)
    showNotice('AI 策略初稿已生成')
  } catch (e) {
    strategyError.value = '生成失败：' + (e.message || '')
  } finally {
    strategyBusy.value = false
  }
}

function parsePhases(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name = '', goal = '', topics = ''] = line.split('|').map((x) => (x || '').trim())
    return { name, goal, topics: topics.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) }
  })
}

async function saveStrategyManual() {
  strategySaving.value = true
  strategyError.value = ''
  try {
    const r = await api.saveStrategy({
      howTo: strategyForm.value.howTo,
      goals: strategyForm.value.goals,
      phases: parsePhases(strategyForm.value.phasesText),
    })
    strategy.value = r.strategy
    strategyEditing.value = false
    showNotice('策略已保存（会进入生成参考系）')
  } catch (e) {
    strategyError.value = '保存失败：' + (e.message || '')
  } finally {
    strategySaving.value = false
  }
}

async function loadChat() {
  try { const r = await api.outlineChat(40); chatItems.value = r.items || [] } catch { chatItems.value = [] }
}

async function sendChat() {
  const msg = chatDraft.value.trim()
  if (!msg || chatSending.value) return
  chatSending.value = true
  chatDraft.value = ''
  try {
    const r = await api.sendOutlineChat(msg)
    chatItems.value = [...chatItems.value, { id: 'u' + Date.now(), role: 'user', content: msg }, { id: 'a' + Date.now(), role: 'assistant', content: r.reply, applied: r.applied }]
    if (r.strategy) { strategy.value = r.strategy; strategyForm.value = formFromStrategy(r.strategy) }
    showNotice(r.applied && r.applied.fields && r.applied.fields.length ? 'AI 已真实修改策略' : '已回复')
  } catch (e) {
    showNotice('发送失败：' + (e.message || ''))
    chatDraft.value = msg
  } finally {
    chatSending.value = false
  }
}

async function resetChatHistory() {
  try { await api.resetOutlineChat(); chatItems.value = []; showNotice('对话已清空（策略不受影响）') } catch (e) { showNotice('清空失败：' + (e.message || '')) }
}

async function saveBlocks() {
  blocksSaving.value = true
  try {
    const personaParts = String(blocks.value.persona || '').split(/[，,]/).map((s) => s.trim()).filter(Boolean)
    const sellParts = String(blocks.value.selling || '').split(/[；;]/).map((s) => s.trim()).filter(Boolean)
    await api.saveOutlinePositioning({
      persona: personaParts[0] || String(blocks.value.persona || ''),
      tone: personaParts.slice(1).join('，'),
      audience: blocks.value.audience,
      selling: sellParts[0] || String(blocks.value.selling || ''),
      goal: sellParts.slice(1).join('；'),
    })
    blocksOpen.value = false
    showNotice('三板块已保存并收起')
  } catch (e) {
    showNotice('保存失败：' + (e.message || ''))
  } finally {
    blocksSaving.value = false
  }
}

/* ---- R23 ---- */
const replyOn = ref(false)
const replySaving = ref(false)
const feedReplies2 = ref([])
const feedIncoming2 = ref([])

async function loadReplySetting() {
  try { const r = await api.replySettings(); replyOn.value = !!r.enabled } catch { replyOn.value = false }
}
async function toggleReply() {
  if (replySaving.value) return
  replySaving.value = true
  try {
    const r = await api.setReplySettings(!replyOn.value)
    replyOn.value = !!r.enabled
    showNotice(r.enabled ? '评论自动回复已开启' : '已关闭：评论只收集不自动发，转人工待办')
  } catch (e) {
    showNotice('切换失败：' + (e.message || ''))
  } finally {
    replySaving.value = false
  }
}
async function loadInteractionFeed() {
  try {
    const r = await api.interactionFeed(40)
    feedReplies2.value = Array.isArray(r.replies) ? r.replies : []
    feedIncoming2.value = Array.isArray(r.incoming) ? r.incoming : []
  } catch { feedReplies2.value = []; feedIncoming2.value = [] }
}

/* ---- R24 ---- */
const docs = ref([])
const docEntries = ref(0)
const docUploading = ref(false)
const docError = ref('')
const docMsg = ref('')
const docBusy = ref(null)
const docInput = ref(null)
const matchProbe = ref('')
const matchProbing = ref(false)
const matchResult = ref(null)

async function loadLibraryDocs() {
  try {
    const r = await api.libraryDocs()
    docs.value = r.items || []
    docEntries.value = r.entries || 0
  } catch (e) {
    docError.value = '读取资料库失败：' + (e.message || '')
  }
}
function pickDocs() { docInput.value && docInput.value.click() }
async function onDocsPicked(ev) {
  const files = [...(ev.target.files || [])]
  ev.target.value = ''
  if (!files.length) return
  docUploading.value = true
  docError.value = ''
  docMsg.value = ''
  try {
    const r = await api.libraryUpload(files)
    const ok = (r.items || []).filter((x) => x.status === 'ok')
    const bad = (r.items || []).filter((x) => x.status !== 'ok')
    docMsg.value = `上传完成：${ok.length} 份解析成功（共 ${ok.reduce((n, x) => n + (x.entries || 0), 0)} 条知识条目）`
      + (bad.length ? `；${bad.length} 份解析失败：${bad.map((x) => x.name + '（' + (x.note || '') + '）').join('；')}` : '')
    await loadLibraryDocs()
  } catch (e) {
    docError.value = '上传失败：' + (e.message || '')
  } finally {
    docUploading.value = false
  }
}
async function rebuildDoc(d) {
  docBusy.value = d.id
  try { const r = await api.rebuildLibraryDoc(d.id); showNotice(`已重建 ${r.entries} 条知识条目`); await loadLibraryDocs() }
  catch (e) { showNotice('重建失败：' + (e.message || '')) }
  finally { docBusy.value = null }
}
async function removeDoc(d) {
  if (!window.confirm(`确认删除《${d.name}》？
连带它生成的知识条目一起删除（评论回复将不再引用它）。`)) return
  try { const r = await api.deleteLibraryDoc(d.id); showNotice(`已删除（连带 ${r.removedEntries} 条知识条目）`); await loadLibraryDocs() }
  catch (e) { showNotice('删除失败：' + (e.message || '')) }
}
async function runMatchProbe() {
  const t = matchProbe.value.trim()
  if (!t) return
  matchProbing.value = true
  matchResult.value = null
  try { matchResult.value = await api.matchTest(t) } catch (e) { matchResult.value = { matched: false, error: e.message } }
  finally { matchProbing.value = false }
}

/* ================= R20 排期发布：自动发送 / 发布保护 / 周视图 ================= */

const pubSet = ref({ autoSend: true, protect: true, preMinutes: 15 })
const pubSetSaving = ref(false)
const pubSetError = ref('')
const manualTimeOpen = ref(false)
const weekSelected = ref('')
const expandedTask = ref(null)
const editingTask = ref(null)
const taskSaving = ref(null)
const precheckForId = ref(null)
const taskEdit = ref({})          // taskId → { title, body, tagsText }

function pubSetNotice(key, v) {
  if (key === 'autoSend') return v ? '自动发送 → 开（到点直接发送）' : '自动发送 → 关（到点需手动确认）'
  return v ? '发布保护 → 开（五项预检全过才发）' : '发布保护 → 关（跳过预检直接进入发送）'
}

async function loadPubSettings() {
  try {
    const r = await api.publishSettings()
    pubSet.value = { autoSend: !!r.autoSend, protect: !!r.protect, preMinutes: r.preMinutes || 15 }
    pubSetError.value = ''
  } catch (e) {
    pubSetError.value = '读取发布设置失败：' + (e.message || '')
  }
}

async function togglePubSet(key) {
  if (pubSetSaving.value) return
  pubSetSaving.value = true
  const next = !pubSet.value[key]
  try {
    const r = await api.setPublishSettings({ [key]: next })
    pubSet.value = { autoSend: !!r.autoSend, protect: !!r.protect, preMinutes: r.preMinutes || 15 }
    showNotice(pubSetNotice(key, next))
  } catch (e) {
    pubSetError.value = '保存失败：' + (e.message || '')
  } finally {
    pubSetSaving.value = false
  }
}

/* 周视图：周一 ~ 周日（默认定位今天） */
function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function localDay(ts) {
  if (!ts) return ''
  const s = String(ts)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : isoDate(d)
}
const weekDays = computed(() => {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7                 // 周一 = 0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow)
  const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const todayIso = isoDate(now)
  return names.map((label, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    const iso = isoDate(d)
    const count = (pubTasks.value || []).filter((t) => localDay(t.scheduled_at) === iso).length
    return { label, iso, md: iso.slice(5).replace('-', '/'), count, isToday: iso === todayIso }
  })
})
const weekTasks = computed(() => (pubTasks.value || [])
  .filter((t) => localDay(t.scheduled_at) === weekSelected.value)
  .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))))

function hhmm(s) { return String(s || '').slice(11, 16) || '--:--' }
function fmtSent(s) { return s ? String(s).replace('T', ' ').slice(5, 16) : '未发送' }
function taskImages(t) {
  try { const a = JSON.parse(t.content_images || '[]'); return Array.isArray(a) ? a.filter((x) => x && x.url) : [] } catch { return [] }
}
function taskTags(t) {
  try { const a = JSON.parse(t.content_tags || '[]'); return Array.isArray(a) && a.length ? a.join(' ') : '（无话题标签）' } catch { return '（无话题标签）' }
}
function toggleTask(t) {
  expandedTask.value = expandedTask.value === t.id ? null : t.id
  precheckForId.value = null
  precheckResult.value = null
  if (expandedTask.value !== t.id) editingTask.value = null
}
function startEditTask(t) {
  taskEdit.value[t.id] = { title: t.content_title || '', body: t.content_body || '', tagsText: taskTags(t) === '（无话题标签）' ? '' : taskTags(t) }
  editingTask.value = t.id
}
async function saveTaskContent(t) {
  const d = taskEdit.value[t.id]
  if (!d) { return }
  taskSaving.value = t.id
  try {
    await api.updateContent(t.content_id, {
      title: d.title, body: d.body,
      tags: JSON.stringify(d.tagsText.split(/[\s,，]+/).filter(Boolean)),
    })
    showNotice('已保存')
    editingTask.value = null
    await loadPublish()
    await loadContents()
  } catch (e) {
    showNotice('保存失败：' + (e.message || ''))
  } finally {
    taskSaving.value = null
  }
}
async function confirmPubTask(t) {
  if (!window.confirm('确认现在发送这条到小红书？\n会真实发布到你的账号上。')) return
  try {
    const r = await api.confirmTask(t.id)
    showNotice(r.ok ? '已确认并发送' : ('发送未完成：' + (r.error || '')))
    await loadPublish()
  } catch (e) {
    showNotice('确认失败：' + (e.message || ''))
  }
}
async function precheckTask(t) {
  precheckForId.value = t.id
  precheckResult.value = null
  try {
    const r = await api.precheckPublish({ contentId: t.content_id })
    precheckResult.value = r
  } catch (e) {
    precheckResult.value = { pass: false, items: [{ name: '预检', ok: false, detail: e.message || '调用失败' }] }
  }
}

/* ================= R19 内容工坊：统一生成入口 / 待发送内容池 / 独立生图 ================= */

// 待发送内容池（生成但未发出）：draft / approved；7 天未排期自动清理，收藏 = 永久保留
const POOL_STATUSES = ['draft', 'approved']
const KEEP_DAYS = 7
const poolRows = ref([])
const generatedTotal = ref(0)
const favoriteBusy = ref(null)
const schedPicker = ref({})      // contentId → datetime-local 字符串
const schedItemBusy = ref(null)

// 一起生图 / 生成后直接排期
const genImages = ref(true)      // 默认一起生图（用户要求：不用手写提示词）
const genScheduleOn = ref(true)   // 默认跟随运营大纲：生成完直接按策略时间排期
const genScheduleDate = ref('')
const genScheduleTime = ref('19:30')
const genSchedMsg = ref('')

function daysSince(ts) {
  if (!ts) return 0
  const d = new Date(String(ts).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return 0
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

// 首次（没有生成内容）= 7 天；之后每次 = 1 篇 —— 与后端 resolveGenerateMode 同规则
const genModePreview = computed(() => (generatedTotal.value === 0 ? 'seven' : 'single'))
const genModeLabel = computed(() => (
  genModePreview.value === 'seven'
    ? `第一次生成：7 天内容（${7 * (genPostsPerDay.value || 1)} 篇，沿七天叙事）`
    : '已有内容：本次生成 1 篇（承接上一篇）'
))

// 统一生成入口（R19）：只此一个按钮，替代原先三个冲突入口
async function runGenerateUnified() {
  if (genRunning.value) return
  if (aiReady.value === false) { genError.value = 'AI 未就绪：请先在「系统设置」确认 DeepSeek Key'; return }
  if (genScheduleOn.value && !genScheduleDate.value) { genError.value = '已打开「生成后直接排期」，请先选一个开始日期'; return }
  genRunning.value = true
  genError.value = ''
  genResult.value = null
  genSchedMsg.value = ''
  try {
    const payload = {
      userIntent: strategyInput.value,
      postsPerDay: genPostsPerDay.value || 1,
      mode: 'auto',
      withImages: !!genImages.value,
      imageTier: imgForm.value.tier === 'fine' ? 'fine' : 'standard',
      imageRatio: imgForm.value.ratio || '1:1',
      dryRun: false,
    }
    if (genScheduleOn.value) payload.schedule = { startDate: genScheduleDate.value, time: genScheduleTime.value }
    const r = await api.generate(payload)
    genResult.value = r
    if (r.scheduled) {
      genSchedMsg.value = `已排期 ${r.scheduledOk || 0}/${r.scheduled.length} 条`
        + (r.scheduled.length - (r.scheduledOk || 0) > 0
          ? '（失败：' + r.scheduled.filter((x) => !x.ok).map((x) => x.error).slice(0, 2).join('；') + '）'
          : '')
    }
    if (r.images) {
      genSchedMsg.value += `${genSchedMsg.value ? '　·　' : ''}配图 ${r.imagesOk || 0} 张成功 / ${r.imagesFailed || 0} 张失败`
    }
    showNotice(`已生成 ${r.saved} 条草稿（${r.elapsed}s）`)
    await loadContents()
  } catch (e) {
    genError.value = '生成失败：' + (e.message || '未知错误')
  } finally {
    genRunning.value = false
  }
}

// 收藏（书签）：收藏后永久保留，不参与 7 天自动清理
async function toggleFavorite(item) {
  favoriteBusy.value = item.id
  try {
    await api.updateContent(item.id, { favorite: item.favorite ? 0 : 1 })
    showNotice(item.favorite ? '已取消收藏，重新计入 7 天清理' : '已收藏 · 永久保留')
    await loadContents()
  } catch (e) {
    showNotice('操作失败：' + (e.message || ''))
  } finally {
    favoriteBusy.value = null
  }
}

// 单条排期：选一天 → 加入发布队列（走真实 /api/publish/schedule）
async function schedulePoolItem(item) {
  const at = schedPicker.value[item.id]
  if (!at) { showNotice('先选一个发送时间'); return }
  schedItemBusy.value = item.id
  try {
    await api.schedulePublish({ contentId: item.id, scheduledAt: at })
    showNotice('已加入发布队列，去「排期发布」查看')
    schedPicker.value[item.id] = ''
    await loadContents()
  } catch (e) {
    showNotice('排期失败：' + (e.message || ''))
  } finally {
    schedItemBusy.value = null
  }
}

// 默认排期时间：明天 19:30（黄金档），让「排期」按钮开箱可用
function defaultScheduleAt() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T19:30`
}

onMounted(() => {
  const d = defaultScheduleAt()
  genScheduleDate.value = d.slice(0, 10)
})

onBeforeUnmount(() => {
  window.clearTimeout(generationTimer)
  window.clearTimeout(noticeTimer)
})
</script>

<template>
  <section class="module-view">
    <template v-if="props.activeView === 'studio'">
      <!-- R19：统一生成入口（左） + 独立生图（右）—— 原「生成方案 / AI GENERATION / 顶栏生成」三处入口已合并为一处 -->
      <div class="studio-split">
        <div class="studio-left">
          <div class="module-toolbar panel" style="grid-template-columns:minmax(0,1fr) auto">
            <div>
              <span class="section-label">AI GENERATION</span>
              <h2>内容生成</h2>
              <p>{{ genModeLabel }}　·　参考系加权：<b>你的指定 0.45</b> &gt; 运营计划表 0.25 &gt; 历史好文 0.20 &gt; 行业热榜 0.10</p>
            </div>
            <span :class="['studio-ai-state', aiReady === false ? 'bad' : 'ok']">
              {{ aiReady === null ? '检测中…' : (aiReady ? 'AI 已就绪' : 'AI 未配置') }}
            </span>
          </div>

          <div class="panel studio-form">
            <label class="studio-field">
              <span>这次想说什么方向？（权重最高，可留空 = 跟运营计划表走）</span>
              <textarea v-model="strategyInput" rows="3" placeholder="例：这周主推新手化妆体验课，语气亲切像学姐；不要硬广"></textarea>
            </label>

            <div class="studio-opts">
              <label class="check-line"><input type="checkbox" v-model="genImages" /> 一起生图（生成文章时按内容自动配图，不用手写提示词）</label>
              <label class="check-line"><input type="checkbox" v-model="genScheduleOn" /> 生成后直接排期</label>
              <label class="check-line mini">每天 <input type="number" v-model.number="genPostsPerDay" min="1" max="9" /> 条</label>
              <template v-if="genScheduleOn">
                <span class="studio-inline">从 <input type="date" v-model="genScheduleDate" /> 起</span>
                <span class="studio-inline">每天 <input type="time" v-model="genScheduleTime" /> 发送</span>
              </template>
            </div>

            <div class="studio-actions">
              <button class="outline-button" type="button" :disabled="genRunning || aiReady === false" @click="runGenerateUnified">
                <Sparkles :size="15" />{{ genRunning ? '生成中…（约 10–60 秒）' : '开始生成' }}
              </button>
              <small>{{ genModePreview === 'seven' ? '首次生成会一次产出 7 天（沿七天叙事）' : '已有内容，本次只生成 1 篇（承接上一篇）' }}<template v-if="genImages">；并按内容自动配图</template></small>
            </div>
          </div>

          <p v-if="genError" class="panel studio-msg err">{{ genError }}</p>
          <div v-if="genResult" class="panel studio-msg">
            <b>本次主线：{{ genResult.theme || '—' }}</b>
            <small>已生成 {{ genResult.saved }} 条（{{ genResult.elapsed }} 秒 · {{ (genResult.usage || {}).total_tokens || 0 }} tokens）<template v-if="genSchedMsg">　·　{{ genSchedMsg }}</template></small>
          </div>
        </div>

        <!-- 独立生图：与文章生成互不依赖（R19 从「素材灵感」迁到这里） -->
        <aside class="panel studio-img">
          <div class="panel-head">
            <div><span class="section-label">AI IMAGE GEN</span><h3>单独生图</h3></div>
            <span class="studio-img-note">{{ imgStatus && imgStatus.providerName ? imgStatus.providerName : '产物自动进素材库' }}</span>
          </div>
          <label class="studio-field"><span>要什么图（一句话）</span>
            <input v-model="imgForm.prompt" placeholder="例：美容院海报配图，一位女性在护理" />
          </label>
          <div class="studio-img-opts">
            <label>档位
              <select v-model="imgForm.tier">
                <option v-for="t in imgTiers" :key="'t' + t.key" :value="t.key">{{ t.name }} · 实出 {{ t.pixels }}</option>
              </select>
            </label>
            <label>比例
              <select v-model="imgForm.ratio">
                <option v-for="r in ['1:1','2:3','3:4','4:3','3:2','9:16','16:9','4:5']" :key="'r' + r" :value="r">{{ r }}</option>
              </select>
            </label>
          </div>
          <div class="studio-actions">
            <button class="outline-button" type="button" :disabled="imgExpanding" @click="expandImgPrompt">{{ imgExpanding ? '扩写中…' : '先扩写提示词' }}</button>
            <button class="outline-button" type="button" :disabled="imgBusy" @click="runImgGen">{{ imgBusy ? '出图中…（约1分钟）' : '生成图片' }}</button>
          </div>
          <p v-if="imgError" class="studio-msg err">{{ imgError }}</p>
          <div v-if="imgExpanded" class="studio-expanded"><b>实际发给模型的提示词</b>{{ imgExpanded }}</div>
          <div v-if="imgResult" class="studio-img-result">
            <img :src="imgProxy(imgResult.url)" alt="" />
            <small>{{ imgResult.tierName }}（{{ imgResult.imageSize }}）· {{ imgResult.ratio }} · 合计 {{ (imgResult.spentMsTotal / 1000).toFixed(1) }}s · 素材 #{{ imgResult.assetId }}</small>
          </div>
          <div v-if="imgHistory.length > 1" class="studio-img-history">
            <img v-for="(g, i) in imgHistory.slice(0, 6)" :key="'gh' + i" :src="imgProxy(g.url)" alt="" />
          </div>
        </aside>
      </div>

      <!-- R19：待发送内容池（生成但还没发出去）—— 7 天未排期自动清理，收藏后永久保留 -->
      <div class="panel pool-panel">
        <div class="panel-head">
          <div>
            <span class="section-label">PENDING POOL</span>
            <h3>待发送内容 · {{ poolRows.length }} 条</h3>
            <p class="pool-note">生成但还没发出的内容。未排期的草稿从生成起 <b>7 天自动清理</b>；<b>收藏后永久保留</b>。</p>
          </div>
          <button class="outline-button" type="button" @click="scanAllDrafts"><RefreshCw :size="15" />全部草稿查重</button>
        </div>
        <p v-if="!poolRows.length" class="pool-empty">还没有待发送内容 —— 用上面的生成入口产出第一条。</p>
        <div v-else class="week-content-grid pool-grid">
          <article v-for="(item, index) in poolRows" :key="'pool' + item.id" class="content-draft panel">
            <div class="draft-cover" :class="`draft-tone-${index % 4}`">
              <span>{{ item.date }}</span>
              <img v-if="item.cover" :src="imgProxy(item.cover)" alt="" class="draft-img" />
              <svg v-else viewBox="0 0 180 130" aria-hidden="true"><circle cx="104" cy="48" r="34" /><path d="M61 126c10-35 37-53 76-48 20 3 34 19 42 48M88 45c12-15 37-13 45 8M98 58c9 5 18 4 26-2" /></svg>
              <small>{{ item.source === 'generated' ? 'AI 生成' : '历史笔记' }}{{ item.cover ? ' · ' + item.imageCount + '图' : '' }}</small>
            </div>
            <div class="draft-body">
              <span class="draft-state">
                {{ item.state }} · {{ item.imageCount }} 张配图 ·
                <b v-if="item.favorite" class="keep-flag">已收藏 · 永久保留</b>
                <b v-else-if="item.scheduled" class="keep-flag">已排期 · 不清理</b>
                <b v-else class="expire-flag">剩余 {{ item.remainDays }} 天自动清理</b>
              </span>
              <h3>{{ item.title }}</h3>
              <div class="pool-actions">
                <span class="pass-text" :style="item.dupScore !== null && item.dupScore >= 60 ? 'color:#b4544a' : ''">
                  <LockKeyhole :size="13" /> {{ item.dupScore === null ? '未查重' : '相似 ' + item.dupScore + '%' }}
                </span>
                <button type="button" @click="openEditor(item)">编辑 <ChevronRight :size="14" /></button>
                <button type="button" v-if="item.status === 'draft'" style="color:#5a8a6a" @click="saveEditById(item.id, 'approved')">通过</button>
                <button type="button" v-if="item.status === 'draft'" style="color:#b4544a" @click="saveEditById(item.id, 'rejected')">退回</button>
                <button type="button" :disabled="favoriteBusy === item.id" @click="toggleFavorite(item)">{{ item.favorite ? '取消收藏' : '收藏' }}</button>
              </div>
              <div class="pool-sched">
                <input type="datetime-local" v-model="schedPicker[item.id]" />
                <button type="button" :disabled="schedItemBusy === item.id" @click="schedulePoolItem(item)">{{ schedItemBusy === item.id ? '排期中…' : '排到这天发' }}</button>
              </div>
            </div>
          </article>
        </div>
      </div>

      <!-- R19：行业热榜 —— 挪到「待发送内容」下面 -->
      <div class="module-toolbar panel">
        <div><span class="section-label">TREND RADAR</span><h2>行业热榜 · 真实爆款</h2><p>每天 09:30 / 20:30 自动抓取（<b>{{ trendTotal }}</b> 条已入库{{ trendLast ? '，最近 ' + trendLast : '' }}），生成内容时作为热点参考。</p></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="font-size:12px;color:#8b8175">关键词：{{ trendKeywords.join(' / ') || '—' }}</span>
          <button class="outline-button" type="button" :disabled="trendScraping" @click="runScrapeNow"><RefreshCw :size="15" />{{ trendScraping ? '抓取中…（约 30 秒）' : '立即抓取' }}</button>
        </div>
      </div>
      <p v-if="trendError" class="panel" style="padding:12px 16px">{{ trendError }}</p>
      <p v-else-if="trendLoading" class="panel" style="padding:12px 16px">正在读取热榜…</p>
      <div v-if="trendItems.length" class="asset-grid" style="margin-bottom:4px">
        <a v-for="it in trendItems.slice(0, 8)" :key="'tr-' + it.id" class="asset-card panel" :href="it.url" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
          <span class="asset-art" style="background:#f4efe8;overflow:hidden;display:block">
            <img v-if="it.cover" :src="imgProxy(it.cover)" alt="" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer" />
          </span>
          <span class="asset-copy"><small>{{ it.author || '小红书' }} · 👍 {{ it.liked }} · {{ it.keyword }}</small><b>{{ it.title || '（无标题）' }}</b><em>点击看原帖</em></span>
        </a>
      </div>
      <p v-else-if="!trendLoading" class="panel" style="padding:14px 16px">热榜还是空的 —— 点右上角「立即抓取」，或等每天 09:30 / 20:30 自动抓取。</p>

      <!-- ===== 文案编辑器（R19 重做）：左=可编辑内容+配图+查重，右=手机预览 ===== -->
      <div v-if="editorOpen" class="preview-layer" @click.self="closeEditor">
        <div class="panel editor-card">
          <div class="panel-head">
            <div><span class="section-label">CONTENT EDITOR</span><b style="font-size:15px">编辑这条内容</b>
              <p class="pool-note">左边改内容、看配图与原创度；右边是发到小红书后的样子。</p></div>
            <button type="button" class="editor-close" @click="closeEditor">×</button>
          </div>

          <div class="editor-grid">
            <section class="editor-left">
              <label class="studio-field"><span>标题（{{ editForm.title.length }} 字）</span>
                <input v-model="editForm.title" placeholder="带钩子的标题，≤20 字" /></label>
              <label class="studio-field"><span>正文（{{ editForm.body.length }} 字 · 建议 150–400 字，多带 emoji）</span>
                <textarea v-model="editForm.body" rows="12"></textarea></label>
              <label class="studio-field"><span>话题标签（空格分隔）</span>
                <input v-model="editForm.tagsText" placeholder="#新手化妆 #化妆教程" /></label>

              <div class="editor-imgs">
                <b>配图（{{ editorImages.length }} 张）</b>
                <div class="editor-img-row">
                  <img v-for="(im, i) in editorImages" :key="'ei' + i" :src="imgProxy(im.url)" alt="" />
                  <span v-if="!editorImages.length" class="week-noimg">这条还没有配图 —— 可用右侧「单独生图」生成后挂上</span>
                </div>
              </div>

              <div v-if="dupResult" class="dup-box">
                <b :style="dupResult.pass ? 'color:#5a8a6a' : 'color:#b4544a'">{{ dupResult.pass ? '✅ 查重通过' : '⚠️ 超过 60% 门禁' }} —— 最高相似度 {{ dupResult.score }}%</b>
                <p>标题 {{ dupResult.parts.title }}% · 结构 {{ dupResult.parts.structure }}% · 观点 {{ dupResult.parts.viewpoint }}% · 表达 {{ dupResult.parts.expression }}%<span v-if="dupResult.mostSimilar"> ｜ 最像《{{ dupResult.mostSimilar.title }}》</span></p>
              </div>
              <p v-if="editError" class="studio-msg err">{{ editError }}</p>

              <div class="studio-actions">
                <button class="outline-button" type="button" @click="saveEdit()" :disabled="editSaving">{{ editSaving ? '保存中…' : '保存' }}</button>
                <button class="outline-button" type="button" @click="saveEdit('approved')" :disabled="editSaving" style="color:#5a8a6a">保存并通过</button>
                <button class="outline-button" type="button" @click="saveEdit('rejected')" :disabled="editSaving" style="color:#b4544a">退回</button>
                <button class="outline-button" type="button" @click="checkDupNow" :disabled="dupChecking">{{ dupChecking ? '查重中…' : '立即查重' }}</button>
              </div>
            </section>

            <aside class="editor-right">
              <div class="phone-frame">
                <div class="phone-cover">
                  <img v-if="editorImages[0]" :src="imgProxy(editorImages[0].url)" alt="" />
                  <span v-else>无封面图</span>
                </div>
                <div class="phone-head"><span class="phone-avatar">{{ (editForm.title || 'J').slice(0, 1) }}</span><b>JOIB</b><small>刚刚</small></div>
                <h5>{{ editForm.title || '（标题）' }}</h5>
                <p class="phone-text">{{ editForm.body || '（正文）' }}</p>
                <p class="phone-tags">{{ editForm.tagsText || '（话题标签）' }}</p>
              </div>
              <small class="week-phone-note">发出去之后在手机里就是这样</small>
            </aside>
          </div>
        </div>
      </div>
</template>

        <template v-else-if="props.activeView === 'schedule'">
      <div class="schedule-summary">
        <article class="queue-card panel">
          <span class="queue-icon"><CalendarCheck :size="21" /></span>
          <div><span class="section-label">发布队列</span><strong>{{ pubTasks.filter(t => t.status === 'pending').length }} 条待发布</strong>
          <small>待确认 {{ pubTasks.filter(t => t.status === 'awaiting_confirm').length }} · 已发布 {{ pubTasks.filter(t => t.status === 'done').length }} · 失败 {{ pubTasks.filter(t => t.status === 'failed').length }}</small></div>
        </article>
        <article class="auto-card panel">
          <div><span class="section-label">自动发送</span><strong>{{ pubSet.autoSend ? '开 · 到点直接发' : '关 · 到点需手动确认' }}</strong>
          <small>{{ pubSet.autoSend ? '无需询问，系统到点直接发送' : '到点先转「待确认」，你点确认后才发送' }}</small></div>
          <button type="button" :class="['switch-control', { active: pubSet.autoSend }]" :aria-pressed="pubSet.autoSend"
                  :disabled="pubSetSaving" aria-label="自动发送开关" @click="togglePubSet('autoSend')"><i /></button>
        </article>
        <article class="auto-card panel">
          <div><span class="section-label">发布保护</span><strong>{{ pubSet.protect ? '开 · 五项预检全过才发' : '关 · 跳过预检直接发' }}</strong>
          <small>{{ pubSet.protect ? '发布前 15 分钟自动预检：登录态/查重/配图/正文字数/发布间隔' : '已关闭保护：不会拦截，直接进入发送流程' }}</small></div>
          <button type="button" :class="['switch-control', { active: pubSet.protect }]" :aria-pressed="pubSet.protect"
                  :disabled="pubSetSaving" aria-label="发布保护开关" @click="togglePubSet('protect')"><i /></button>
        </article>
      </div>
      <p v-if="pubSetError" class="panel" style="padding:12px 16px">{{ pubSetError }}</p>
      <p v-if="!pubSet.autoSend && pubTasks.some(t => t.status === 'awaiting_confirm')" class="panel"
         style="padding:12px 16px;border-color:#e0b9a0">
        ⏰ 有 {{ pubTasks.filter(t => t.status === 'awaiting_confirm').length }} 条已到点、等你确认发送 —— 在下面周视图里点开「确认发送」。
      </p>

      <!-- 建议发布时间：默认按运营策略走，想自己定再点「手动调整」 -->
      <div class="module-toolbar panel">
        <div><span class="section-label">BEST TIME</span>
          <h2>建议发布时间：{{ bestTime ? bestTime.recommended : '读取中…' }}</h2>
          <p>{{ bestTime ? bestTime.note : '默认按运营策略走，无需手动设置' }}</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="outline-button" type="button" @click="manualTimeOpen = !manualTimeOpen">{{ manualTimeOpen ? '收起手动设置' : '手动调整' }}</button>
          <button class="outline-button" type="button" @click="loadPublish(true)"><RefreshCw :size="15" />刷新</button>
        </div>
      </div>
      <div v-if="manualTimeOpen" class="panel" style="padding:16px 18px;margin-bottom:0">
        <b style="font-size:13px">手动调整：把内容排到指定日期与时间</b>
        <p style="margin:6px 0 0;font-size:11px;color:#8b8175">不点这里的话，系统就按上面的建议时间（运营策略）走。</p>
        <div style="display:flex;gap:12px;align-items:end;margin-top:12px;flex-wrap:wrap">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175;flex:1;min-width:240px">选择内容
            <select v-model="scheduleForm.contentId" style="padding:9px 11px;border:1px solid var(--border);border-radius:9px;font-size:13px;background:#fff">
              <option value="">— 请选择 —</option>
              <option v-for="c in poolRows" :key="'opt' + c.id" :value="c.id">{{ c.title }}（{{ c.state }}）</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175">发布时间
            <input v-model="scheduleForm.scheduledAt" type="datetime-local" style="padding:9px 11px;border:1px solid var(--border);border-radius:9px;font-size:13px" />
          </label>
          <button class="outline-button" type="button" @click="useBestTime">采用建议</button>
          <button class="outline-button" type="button" :disabled="scheduleSaving" @click="doSchedule">{{ scheduleSaving ? '加入中…' : '加入队列' }}</button>
        </div>
      </div>

      <p v-if="pubError" class="panel" style="padding:12px 16px">{{ pubError }}</p>

      <!-- 发布队列：周视图 -->
      <div class="calendar-board panel">
        <div class="panel-head">
          <div><span class="section-label">PUBLISH WEEK</span><h3>发布队列 · 周视图</h3>
            <p class="pool-note">点日期看当天要发的文章；点文章横条向下展开（左：内容 / 右：小红书手机预览）。</p>
          </div>
          <span class="demo-badge">{{ pubTasks.length }} 个任务</span>
        </div>

        <div class="week-tabs">
          <button v-for="d in weekDays" :key="d.iso" type="button" :class="{ active: d.iso === weekSelected, today: d.isToday }" @click="weekSelected = d.iso">
            <b>{{ d.label }}</b>
            <small>{{ d.md }}</small>
            <i v-if="d.count">{{ d.count }} 条</i>
          </button>
        </div>

        <div v-if="!weekTasks.length" class="pool-empty">这一天没有发布任务 —— 用上面的「手动调整」把内容排进来。</div>

        <div class="week-list">
          <article v-for="t in weekTasks" :key="'wk' + t.id" :class="['week-row', { open: expandedTask === t.id }]">
            <button type="button" class="week-row-head" @click="toggleTask(t)">
              <span class="week-time"><b>{{ hhmm(t.scheduled_at) }}</b><small>{{ t.status === 'done' ? '已发' : '计划' }}</small></span>
              <span class="week-copy">
                <b>{{ t.content_title || '(内容已删除)' }}</b>
                <small>任务 #{{ t.id }}{{ t.retry ? ' · 重试 ' + t.retry : '' }} · 实际发送：{{ t.actual_sent_at ? fmtSent(t.actual_sent_at) : '未发送' }}</small>
              </span>
              <span :class="['queue-state', { waiting: t.status === 'pending' || t.status === 'awaiting_confirm' }]">{{ PUB_STATE[t.status] || t.status }}</span>
              <ChevronRight :size="16" class="week-caret" />
            </button>

            <div v-if="expandedTask === t.id" class="week-expand">
              <!-- 左：文章内容（点「编辑」可改，改完点「保存」落库） -->
              <section class="week-article">
                <template v-if="editingTask === t.id">
                  <input v-model="taskEdit[t.id].title" class="week-input" placeholder="标题" />
                  <textarea v-model="taskEdit[t.id].body" rows="10" class="week-input"></textarea>
                  <input v-model="taskEdit[t.id].tagsText" class="week-input" placeholder="话题标签（空格分隔）" />
                </template>
                <template v-else>
                  <h4>{{ t.content_title || '(无标题)' }}</h4>
                  <p class="week-body">{{ t.content_body || '（这条内容没有正文）' }}</p>
                  <p class="week-tags">{{ taskTags(t) }}</p>
                </template>
                <div class="week-imgs">
                  <img v-for="(im, i) in taskImages(t)" :key="'im' + t.id + i" :src="imgProxy(im.url)" alt="" />
                  <span v-if="!taskImages(t).length" class="week-noimg">这条内容还没有配图</span>
                </div>
              </section>

              <!-- 右：小红书真机预览 -->
              <aside class="week-phone">
                <div class="phone-frame">
                  <div class="phone-cover">
                    <img v-if="taskImages(t)[0]" :src="imgProxy(taskImages(t)[0].url)" alt="" />
                    <span v-else>无封面图</span>
                  </div>
                  <div class="phone-head">
                    <span class="phone-avatar">{{ (t.content_title || 'J').slice(0, 1) }}</span>
                    <b>JOIB</b>
                    <small>刚刚</small>
                  </div>
                  <h5>{{ (editingTask === t.id ? taskEdit[t.id].title : t.content_title) || '(无标题)' }}</h5>
                  <p class="phone-text">{{ (editingTask === t.id ? taskEdit[t.id].body : t.content_body) || '（无正文）' }}</p>
                  <p class="phone-tags">{{ editingTask === t.id ? taskEdit[t.id].tagsText : taskTags(t) }}</p>
                </div>
                <small class="week-phone-note">模拟小红书笔记页（真机里长这样）</small>
              </aside>

              <!-- 按钮 -->
              <div class="week-actions">
                <button type="button" class="outline-button" @click="precheckTask(t)">预检</button>
                <button type="button" class="outline-button" v-if="editingTask !== t.id" @click="startEditTask(t)">编辑</button>
                <button type="button" class="outline-button" v-else :disabled="taskSaving === t.id" @click="saveTaskContent(t)">{{ taskSaving === t.id ? '保存中…' : '保存' }}</button>
                <button type="button" class="outline-button" v-if="t.status === 'awaiting_confirm'" @click="confirmPubTask(t)">确认发送</button>
                <button type="button" class="outline-button" v-if="t.status === 'pending'" @click="cancelPubTask(t.id)">取消</button>
              </div>

              <!-- 预检结果：手机预览下面的独立框 -->
              <div v-if="precheckForId === t.id" class="precheck-box">
                <template v-if="precheckResult">
                  <b :style="precheckResult.pass ? 'color:#5a8a6a' : 'color:#b4544a'">{{ precheckResult.pass ? '✅ 预检全部通过' : '⚠️ 预检未通过' }}</b>
                  <ul>
                    <li v-for="(it, i) in precheckResult.items" :key="'pc' + i" :style="it.ok ? 'color:#5a8a6a' : 'color:#b4544a'">{{ it.ok ? '✓' : '✗' }} {{ it.name }}：{{ it.detail }}</li>
                  </ul>
                </template>
                <template v-else><b>正在预检…</b></template>
              </div>
            </div>
          </article>
        </div>
      </div>
    </template>

<template v-else-if="props.activeView === 'assets'">
      <div class="asset-toolbar panel">
        <div><span class="section-label">素材中心</span><h2>灵感与配图</h2><p>AI 生成图、机构实拍和历史素材统一管理。</p></div>
        <div class="filter-tabs">
          <button v-for="item in ['全部', '上传', 'AI生成', '历史']" :key="item" type="button" :class="{ active: assetFilter === item }" @click="assetFilter = item">{{ item }}</button>
        </div>
        <button class="outline-button" type="button" @click="pickUpload"><CloudUpload :size="16" />上传素材</button>
        <input ref="fileInput" type="file" accept="image/*" multiple style="display:none" @change="onFilesPicked" />
      </div>

      <!-- ===== 在线素材库（上传图 + AI 生成图统一存放，真数据） ===== -->
      <p v-if="assetError" class="panel" style="padding:12px 16px;margin:0 0 12px">{{ assetError }}</p>
      <p v-else-if="assetLoading" class="panel" style="padding:12px 16px;margin:0 0 12px">正在读取素材库…</p>
      <p v-else-if="!assetItems.length" class="panel" style="padding:12px 16px;margin:0 0 12px">
        素材库还是空的 —— 点右上角「上传素材」把图片放进来，AI 生成图也会自动存在这里。
      </p>

      <div class="asset-layout">
        <div class="asset-grid">
          <button v-for="item in filteredAssets" :key="item.id" type="button" :class="['asset-card', 'panel', { selected: selectedAssets.includes(item.id) }]" @click="toggleAsset(item.id)" style="position:relative">
            <span :class="['asset-art', `asset-${item.tone}`]" style="overflow:hidden;position:relative">
              <img v-if="item.url" :src="item.url" :alt="item.title" style="width:100%;height:100%;object-fit:cover;display:block" />
              <svg v-else viewBox="0 0 220 170" aria-hidden="true"><circle cx="130" cy="66" r="43" /><path d="M66 169c13-51 54-75 108-59 20 6 34 25 42 59M108 61c16-18 48-15 58 11M118 80c11 6 23 5 34-3" /></svg>
              <i v-if="selectedAssets.includes(item.id)"><Check :size="14" /></i>
            </span>
            <span class="asset-copy"><small>{{ item.type }}</small><b>{{ item.title }}</b><em>{{ item.meta }}</em></span>
            <span title="从素材库删除" @click.stop="removeAsset(item.id)"
                  style="position:absolute;top:8px;right:8px;width:22px;height:22px;line-height:20px;text-align:center;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:14px;cursor:pointer">×</span>
          </button>
        </div>
        <aside class="selection-card panel">
          <span class="selection-icon"><Layers3 :size="20" /></span><h3>已选择 {{ selectedAssets.length }} 张</h3><p>选择后的素材可以直接加入当前周内容，也可以交给 AI 作为风格参考。</p>
          <div class="mini-stack"><span v-for="id in selectedAssets.slice(0, 4)" :key="id">{{ id }}</span></div>
          <ElButton class="module-primary" type="primary" round :disabled="!selectedAssets.length" @click="attachSelected">加入 D3 内容</ElButton>
        </aside>
      </div>
      <!-- R19：AI 生图入口已统一到「内容工坊」右侧单独生图面板（本页只保留素材库：上传 / 管理 / 删除） -->
    </template>

    <template v-else-if="props.activeView === 'analytics'">
      <p v-if="notesError" class="panel" style="padding:12px 16px;margin:0 0 12px">{{ notesError }}</p>
      <p v-else-if="notesLoading" class="panel" style="padding:12px 16px;margin:0 0 12px">正在读取你的小红书笔记数据（首次约 5–10 秒）…</p>
      <div class="analytics-kpis">
        <article v-for="item in (platformKpis.length ? platformKpis : analyticsKpis)" :key="item.label" class="analytics-kpi panel"><small>{{ item.label }}</small><strong>{{ item.value }}</strong><span><TrendingUp :size="13" />{{ item.delta }}</span></article>
      </div>
      <div class="analytics-main">
        <article class="insight-chart panel">
          <div class="panel-head chart-head">
            <div>
              <span class="section-label">CONTENT PERFORMANCE</span>
              <h3>内容增长趋势 · 浏览量</h3>
            </div>
            <div class="chart-window">
              <button v-for="w in ['seven', 'thirty']" :key="w" type="button" :class="['filter-chip', { active: creatorWindow === w }]" @click="creatorWindow = w">{{ w === 'seven' ? '近 7 天' : '近 30 天' }}</button>
            </div>
          </div>
          <p v-if="creatorError" class="chart-error">{{ creatorError }}</p>
          <div class="chart-body">
            <svg v-if="chartLine" class="chart-svg" viewBox="0 0 720 260" role="img" aria-label="浏览量趋势图">
              <g class="insight-grid"><path d="M45 36H690M45 92H690M45 148H690M45 204H690" /></g>
              <path class="insight-area" :d="chartArea" />
              <path class="insight-line" :d="chartLine" />
              <g class="insight-marks">
                <template v-for="m in chartMarks" :key="m.kind">
                  <circle class="mark-dot" :cx="m.x" :cy="m.y" r="3.5" />
                  <text class="mark-label" :x="m.x" :y="m.y - 11" :text-anchor="m.anchor">{{ m.label }}</text>
                </template>
              </g>
              <g class="insight-labels"><text v-for="t in chartTicks" :key="t.key" :x="chartLabelX(t.i)" y="244">{{ t.date }}</text></g>
            </svg>
            <div v-else class="chart-empty">
              <b>趋势数据积累中</b>
              <p>点下方「采集今日数据」记录今天的互动快照；连续采集 2 天以上就会显示真实曲线。</p>
              <p>当前已有快照：{{ metricsRows.length }} 条</p>
            </div>
          </div>
          <div class="chart-foot">
            <span class="chart-source">
              <template v-if="creatorData">数据来源：小红书创作者中心（平台官方数据）</template>
              <template v-else-if="creatorLoading">正在读取平台数据…</template>
              <template v-else>数据来源：小红书创作者中心</template>
            </span>
            <button class="ghost-mini" type="button" :disabled="collecting" @click="collectToday">
              <RefreshCw :size="13" />{{ collecting ? '采集中…' : '采集今日数据' }}
            </button>
          </div>
        </article>
        <article class="topic-rank panel">
          <div class="panel-head"><div><span class="section-label">TOP TOPICS</span><h3>高潜内容方向</h3></div><BarChart3 :size="19" /></div>
          <div v-if="insightLoading" class="topic-empty">AI 正在分析真实数据…（约 5–15 秒）</div>
          <div v-else-if="insight && insight.suggestions.length" class="topic-tips">
            <div v-for="(s, i) in insight.suggestions" :key="'ts' + i" class="topic-tip">
              <b>{{ s.direction }}</b>
              <small>{{ s.reason }}</small>
              <span>{{ s.action }}</span>
            </div>
          </div>
          <div v-else-if="insightError" class="topic-empty">生成失败：{{ insightError }}<br />可点下方「重新生成」重试。</div>
          <div v-else-if="insight" class="topic-empty">本次生成未给出方向建议（样本较少，先多积累几篇笔记数据再生成）。</div>
          <div v-else class="topic-empty">点下方「生成 AI 解读」，这里会按真实数据给出 2~4 条方向建议（含依据和具体动作）。</div>
        </article>
      </div>
      <!-- ===== 整体数据分析解读（R21 · 契约2）===== -->
      <article class="insight-ai panel">
        <div class="panel-head">
          <div>
            <span class="section-label">AI INSIGHT · 整体数据分析解读</span>
            <h3>把账号数据（浏览量趋势 / 互动 / 最佳内容）做一段整体解读</h3>
            <p v-if="insight" class="insight-meta">
              生成于 {{ fmtInsightTime(insight.generated_at) }} · 本机样本 {{ insight.sources.metricNotes }} 篇
              <template v-if="insight.sources.creator30d"> · 含创作者中心近 30 天数据</template>
              <template v-else-if="insight.sources.creatorError"> · 创作者中心未取到：{{ insight.sources.creatorError }}</template>
            </p>
          </div>
          <button class="outline-button" type="button" :disabled="insightLoading" @click="loadInsight">
            <Sparkles :size="15" />{{ insightLoading ? '解读生成中…' : (insight ? '重新生成' : '生成 AI 解读') }}
          </button>
        </div>
        <div v-if="insightLoading" class="insight-state">正在结合真实数据生成解读（约 5–15 秒，走真实 AI）…</div>
        <template v-else-if="insight">
          <p class="insight-summary">{{ insight.summary }}</p>
          <ul v-if="insight.highlights.length" class="insight-highlights">
            <li v-for="(h, i) in insight.highlights" :key="'hl' + i">{{ h }}</li>
          </ul>
        </template>
        <div v-else-if="insightError" class="insight-state bad">
          <b>当前无法生成：</b>{{ insightError }}
          <button class="ghost-mini" type="button" @click="loadInsight"><RefreshCw :size="13" />重试</button>
        </div>
        <div v-else class="insight-state">还没有生成过解读 —— 点右上角「生成 AI 解读」，系统会结合平台 30 天数据与本机笔记数据，输出整体解读与关键发现（每次生成都走真实 AI，约 5–15 秒）。</div>
      </article>

      <!-- ===== 逐篇文章的数据情况（R21 · 契约3）===== -->
      <article class="perf-panel panel">
        <div class="panel-head">
          <div>
            <span class="section-label">PER-NOTE PERFORMANCE</span>
            <h3>逐篇文章的数据情况</h3>
            <p class="insight-meta">标题 / 日期 / 浏览 / 点赞 / 收藏 / 评论 —— 有则显示，缺则标注「缺」，不用 0 冒充{{ perf && perf.count ? ' · 共 ' + perf.count + ' 篇' : '' }}</p>
          </div>
          <button class="ghost-mini" type="button" :disabled="perfLoading" @click="loadPerformance"><RefreshCw :size="13" />{{ perfLoading ? '读取中…' : '刷新' }}</button>
        </div>
        <div v-if="perfError" class="insight-state bad">{{ perfError }}</div>
        <div v-else-if="perfLoading && !perf" class="insight-state">正在读取逐篇数据…</div>
        <div v-else-if="perf && perf.items.length" class="perf-table-wrap">
          <table class="perf-table">
            <thead><tr><th>标题</th><th>日期</th><th>浏览</th><th>点赞</th><th>收藏</th><th>评论</th></tr></thead>
            <tbody>
              <tr v-for="(n, i) in perf.items" :key="'pn' + i">
                <td class="pn-title" :title="n.title">{{ n.title }}</td>
                <td>{{ n.date || '缺' }}</td>
                <td>{{ n.views === null ? '缺' : n.views.toLocaleString() }}</td>
                <td>{{ n.likes === null ? '缺' : n.likes.toLocaleString() }}</td>
                <td>{{ n.collects === null ? '缺' : n.collects.toLocaleString() }}</td>
                <td>{{ n.comments === null ? '缺' : n.comments.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
          <p class="perf-note">「缺」= 尚未采集到或平台不提供该项（例如平台暂不提供逐篇浏览量）；系统不会用 0 冒充。</p>
        </div>
        <div v-else class="insight-state">还没有可统计的笔记 —— 先导入历史笔记或完成一次发布。</div>
      </article>

      <!-- ===== 复盘报告与建议（R12）===== -->
      <article class="strategy-card panel" style="margin-top:16px">
        <span class="strategy-orb"><Sparkles :size="19" /></span>
        <div style="flex:1">
          <span class="section-label">AI REVIEW · 复盘报告</span>
          <h3 v-if="!report && !reportLoading">生成账号复盘</h3>
          <h3 v-else-if="reportLoading">正在分析…</h3>
          <h3 v-else-if="report && report.status === 'collecting'">{{ report.note }}</h3>
          <h3 v-else-if="report">判据：{{ report.metricUsed.name }}（样本 {{ report.sampleSize }} 篇）</h3>
          <p v-if="!report && !reportLoading">按发布后 24/48/72 小时快照做复盘，输出「本期表现 / 与上期对比 / 支柱调整 / 可执行建议」。</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" :disabled="snapshotBusy" @click="collectSnapshotNow">{{ snapshotBusy ? '采集中…' : '采集快照' }}</button>
          <button type="button" :disabled="reportLoading" @click="loadReport">{{ reportLoading ? '分析中…' : '生成复盘' }}</button>
        </div>
      </article>

      <p v-if="reportError" class="panel" style="padding:12px 16px;margin-top:12px">{{ reportError }}</p>

      <div v-if="report && report.status === 'ready'" class="panel" style="padding:16px 18px;margin-top:14px;font-size:13px">
        <div v-if="report.warnings && report.warnings.length" style="margin-bottom:10px;color:#b4544a;font-size:12px">
          <div v-for="(w,i) in report.warnings" :key="'w'+i">⚠️ {{ w }}</div>
        </div>

        <b>① 本期表现（{{ report.period.from }} ~ {{ report.period.to }}）</b>
        <div style="margin:6px 0 12px;line-height:1.9">
          篇数 {{ report.current.count }} ｜ 平均点赞 {{ report.current.avgLikes }} ｜
          评论率 {{ report.current.commentRate }}% ｜ 收藏率 {{ report.current.collectRate }}%
          <div style="color:#8b8175">
            基准（全量 {{ report.baseline.count }} 篇）：均值 {{ report.baseline.avgLikes }} 赞 ｜
            优于 ≥{{ report.baseline.upThreshold }} ｜ 低于 ≤{{ report.baseline.downThreshold }}
          </div>
        </div>

        <b>② 与上期对比</b>
        <div style="margin:6px 0 12px;line-height:1.9">
          <template v-if="report.previous">
            上期 {{ report.previous.count }} 篇 · 平均点赞 {{ report.previous.avgLikes }} → 本期 {{ report.current.avgLikes }}
          </template>
          <template v-else><span style="color:#8b8175">上期无样本（系统刚上线，数据积累中）</span></template>
          <div style="color:#8b8175">判定：优于 {{ report.verdicts.better }} 篇 / 低于 {{ report.verdicts.worse }} 篇 / 持平 {{ report.verdicts.flat }} 篇</div>
        </div>

        <b>③ 支柱调整（±10%）</b>
        <div style="margin:6px 0 12px">
          <div v-for="p in report.pillarAdjust" :key="'pa'+p.name" style="display:flex;align-items:center;gap:10px;margin:4px 0">
            <span style="flex:0 0 150px">{{ p.name }}</span>
            <span style="color:#8b8175">{{ p.current }}% →</span>
            <b :style="p.delta > 0 ? 'color:#5a8a6a' : (p.delta < 0 ? 'color:#b4544a' : '')">{{ p.suggested }}%（{{ p.delta > 0 ? '+' : '' }}{{ p.delta }}）</b>
            <i style="flex:1;height:6px;background:#f0ebe3;border-radius:3px;overflow:hidden;display:block">
              <em :style="{ display:'block', height:'100%', width: p.suggested + '%', background:'#c8a68a' }" />
            </i>
          </div>
          <small style="color:#8b8175">支柱来源：{{ report.pillarSource }}</small>
        </div>

        <b>④ 可执行建议</b>
        <ol style="margin:6px 0 12px;padding-left:20px;line-height:1.9">
          <li v-for="(s,i) in report.suggestions" :key="'sg'+i">
            <b>改「{{ s.what }}」→「{{ s.to }}」</b>
            <div style="color:#8b8175;font-size:12px">依据：{{ s.because }}</div>
          </li>
        </ol>

        <div v-if="report.aiSummary" style="padding:10px 12px;background:#faf7f3;border-radius:10px;line-height:1.8">
          <b>AI 总结：</b>{{ report.aiSummary }}
        </div>
        <small v-if="report.aiError" style="color:#b4544a">AI 总结失败：{{ report.aiError }}（结构化报告仍可用）</small>
      </div>

      <!-- ===== 对标账号监控（R11）===== -->
      <article class="module-toolbar panel" style="margin-top:16px">
        <div><span class="section-label">PEER RADAR</span><h2>对标账号监控</h2>
        <p>从热榜结果里聚合出高频出现的作者，分析他们的 6 个维度</p></div>
        <div style="display:flex;gap:10px">
          <button class="outline-button" type="button" :disabled="compDiscovering" @click="discoverCompetitors">{{ compDiscovering ? '分析中…' : '发现对标账号' }}</button>
          <button class="outline-button" type="button" @click="loadCompetitors">刷新</button>
        </div>
      </article>

      <div v-if="compDiscover" class="panel" style="padding:14px 18px;margin-bottom:16px">
        <b style="font-size:13px">发现结果</b>
        <p style="margin:6px 0 10px;font-size:12px;color:#8b8175">
          热榜 {{ compDiscover.totalTrendNotes }} 条 / {{ compDiscover.keywords }} 个关键词 ｜
          阈值 请求 {{ compDiscover.thresholdAsked }} → 实际 {{ compDiscover.thresholdUsed }}
          {{ compDiscover.relaxed ? '（已放宽）' : '' }}
          <span v-if="compDiscover.note"> ｜ {{ compDiscover.note }}</span>
        </p>
        <div v-if="!compDiscover.candidates.length" style="font-size:13px;color:#8b8175">没有新的候选账号</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <div v-for="c in compDiscover.candidates" :key="c.authorId"
               style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#faf7f3;border-radius:10px;font-size:12px">
            <b>{{ c.nickname }}</b>
            <span style="color:#8b8175">出现 {{ c.notes }} 次 · 热度 {{ c.score }}</span>
            <button type="button" style="color:#5a8a6a" @click="addCompetitorItem(c)">+ 加入监控</button>
          </div>
        </div>
      </div>

      <p v-if="compError" class="panel" style="padding:12px 16px">{{ compError }}</p>

      <div v-if="!competitors.length && !compLoading" class="panel" style="padding:22px 18px;color:#8b8175;font-size:13px">
        还没有监控任何对标账号 —— 点右上角「发现对标账号」。
      </div>

      <div v-for="c in competitors" :key="'comp' + c.id" class="panel" style="padding:16px 18px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <b style="font-size:15px">{{ c.nickname }}</b>
            <span :style="c.status === 'active' ? 'color:#5a8a6a' : 'color:#b4544a'">
              {{ c.status === 'active' ? '正常' : '样本失效（改名/注销）' }}
            </span>
            <small style="color:#8b8175">样本 {{ c.sampleSize }} 条 · 总点赞 {{ c.totalLiked }}</small>
          </div>
          <div style="display:flex;gap:8px">
            <button type="button" :disabled="compDeepBusy === c.id" @click="deepAnalyze(c.id)">
              {{ compDeepBusy === c.id ? '深度分析中…' : '深度分析(补发布时间)' }}
            </button>
            <button type="button" style="color:#b4544a" @click="removeCompetitorItem(c.id)">移出</button>
          </div>
        </div>

        <div v-if="c.analysis && c.analysis.ok" style="margin-top:12px;font-size:12px;line-height:2">
          <div><b style="display:inline-block;width:88px">① 更新频率</b>{{ c.analysis.frequency.text }}</div>
          <div><b style="display:inline-block;width:88px">② 爆款率</b>{{ c.analysis.hitRate.text }}</div>
          <div><b style="display:inline-block;width:88px">③ 题材分布</b>
            <span v-for="t in c.analysis.topics" :key="t.keyword" style="margin-right:12px">{{ t.keyword }} {{ t.percent }}%（{{ t.count }}条）</span>
          </div>
          <div><b style="display:inline-block;width:88px">④ 发布时段</b>
            <template v-if="c.analysis.slots.length">
              <span v-for="s in c.analysis.slots" :key="s.hour" style="margin-right:12px">{{ s.hour }} ×{{ s.count }}</span>
              <span style="color:#5a8a6a">最佳 {{ c.analysis.bestHour }}</span>
            </template>
            <span v-else style="color:#8b8175">数据不足（点「深度分析」补发布时间）</span>
          </div>
          <div><b style="display:inline-block;width:88px">⑤ 互动结构</b>{{ c.analysis.structure.text }}</div>
          <div><b style="display:inline-block;width:88px">⑥ 标题句式</b>
            <span v-for="s in c.analysis.styles" :key="s.style" style="margin-right:12px">{{ s.style }} {{ s.percent }}%</span>
          </div>
          <div v-if="c.analysis.topNotes.length" style="margin-top:6px;color:#8b8175">
            代表作：<span v-for="(n, i) in c.analysis.topNotes" :key="'tn' + i">{{ n.title }}（👍{{ n.liked }}）{{ i < c.analysis.topNotes.length - 1 ? ' · ' : '' }}</span>
          </div>
        </div>
        <div v-else style="margin-top:10px;font-size:12px;color:#8b8175">暂无分析（样本不足）</div>
      </div>
    </template>

    <template v-else-if="props.activeView === 'outline'">
      <!-- ===================== R22 运营大纲：三板块 + 完整策略 + AI 对话 ===================== -->
      <div class="module-toolbar panel">
        <div><span class="section-label">STRATEGY</span><h2>运营策略</h2>
          <p>AI 生成初稿 → 你可以直接改；也可以跟 AI 对话，让它**真实改这份策略**（改完下面的内容会变）。</p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="outline-button" type="button" :disabled="strategyBusy" @click="genStrategyDraft">{{ strategyBusy ? '生成中…' : 'AI 生成策略初稿' }}</button>
          <button class="outline-button" type="button" v-if="strategy" @click="strategyEditing = !strategyEditing">{{ strategyEditing ? '收起编辑' : '手动编辑策略' }}</button>
        </div>
      </div>
      <p v-if="strategyError" class="panel" style="padding:12px 16px">{{ strategyError }}</p>

      <div v-if="strategy" class="panel outline-strategy">
        <template v-if="!strategyEditing">
          <section>
            <span class="section-label">我们应该怎么做</span>
            <p class="strategy-text">{{ strategy.howTo || '（还没写）' }}</p>
          </section>
          <section>
            <span class="section-label">多长时间达到什么目标</span>
            <p class="strategy-text">{{ strategy.goals || '（还没写）' }}</p>
          </section>
          <section v-if="(strategy.phases || []).length">
            <span class="section-label">分阶段策略与选题</span>
            <div class="phase-list">
              <article v-for="(p, i) in strategy.phases" :key="'ph' + i">
                <b>{{ p.name }}</b>
                <small>{{ p.goal }}</small>
                <ul><li v-for="(tp, j) in p.topics" :key="'tp' + i + j">{{ tp }}</li></ul>
              </article>
            </div>
          </section>
          <p class="strategy-meta">最后更新：{{ strategy.updatedAt ? strategy.updatedAt.slice(0, 16).replace('T', ' ') : '—' }}（来源：{{ strategy.source === 'ai' ? 'AI 初稿' : strategy.source === 'chat' ? 'AI 对话修改' : '手动编辑' }}）</p>
        </template>
        <template v-else>
          <label class="studio-field"><span>我们应该怎么做</span><textarea v-model="strategyForm.howTo" rows="5"></textarea></label>
          <label class="studio-field"><span>多长时间达到什么目标</span><textarea v-model="strategyForm.goals" rows="3"></textarea></label>
          <label class="studio-field"><span>分阶段策略（每行一个阶段：阶段名 | 目标 | 选题1、选题2）</span>
            <textarea v-model="strategyForm.phasesText" rows="6"></textarea></label>
          <div class="studio-actions">
            <button class="outline-button" type="button" :disabled="strategySaving" @click="saveStrategyManual">{{ strategySaving ? '保存中…' : '保存策略' }}</button>
            <button class="outline-button" type="button" @click="strategyForm = formFromStrategy(strategy); strategyEditing = false">取消</button>
          </div>
        </template>
      </div>
      <p v-else class="panel" style="padding:14px 16px">还没有运营策略 —— 点右上「AI 生成策略初稿」，或手动编辑。生成后它会进入内容生成的参考系（权重同参考系②）。</p>

      <!-- AI 对话框：带上下文记忆，改的是真策略 -->
      <div class="panel outline-chat">
        <div class="panel-head">
          <div><span class="section-label">TALK TO AI</span><h3>跟 AI 聊运营方向</h3>
            <p class="pool-note">说清你想怎么调（人群/选题/节奏/目标），它会记着前面说过的，并把结果**真写进上面的策略**。</p></div>
          <button class="outline-button" type="button" @click="resetChatHistory">清空对话</button>
        </div>
        <div class="chat-list" ref="chatBox">
          <p v-if="!chatItems.length" class="chat-empty">还没有对话。可以先说一句：「这周主打学员改造案例，语气再亲切点」。</p>
          <div v-for="m in chatItems" :key="'cm' + m.id" :class="['chat-msg', m.role]">
            <b>{{ m.role === 'user' ? '你' : 'AI' }}</b>
            <p>{{ m.content }}</p>
            <small v-if="m.applied && m.applied.fields && m.applied.fields.length">✅ 已按这轮回答修改策略：{{ m.applied.fields.join(' / ') }}</small>
          </div>
        </div>
        <div class="chat-input">
          <input v-model="chatDraft" placeholder="例：目标人群收窄到 20-35 岁上班族女生" @keyup.enter="sendChat" />
          <button class="outline-button" type="button" :disabled="chatSending" @click="sendChat">{{ chatSending ? '思考中…' : '发送' }}</button>
        </div>
      </div>

      <!-- 三板块：保存后折叠，不点开不展示 -->
      <div class="panel blocks-panel">
        <div class="panel-head">
          <div><span class="section-label">ACCOUNT SETTINGS</span><h3>人物设定 · 目标人群 · 核心要求</h3>
            <p class="pool-note">{{ blocksSummary }}</p></div>
          <button class="outline-button" type="button" @click="blocksOpen = !blocksOpen">{{ blocksOpen ? '收起' : '展开修改' }}</button>
        </div>
        <div v-if="blocksOpen" class="blocks-grid">
          <label class="studio-field"><span>人物设定（我是谁 · 什么语气）</span>
            <textarea v-model="blocks.persona" rows="3" placeholder="例：美妆老师，语气亲切像学姐"></textarea></label>
          <label class="studio-field"><span>目标人群（说给谁听）</span>
            <textarea v-model="blocks.audience" rows="3" placeholder="例：20-35 岁上班族女生"></textarea></label>
          <label class="studio-field"><span>核心要求（卖点 + 转化目标 + 内容要求）</span>
            <textarea v-model="blocks.selling" rows="3" placeholder="例：主推 1 对 1 体验课；结尾引导评论/私信"></textarea></label>
          <div class="studio-actions">
            <button class="outline-button" type="button" :disabled="blocksSaving" @click="saveBlocks">{{ blocksSaving ? '保存中…' : '保存' }}</button>
            <small>保存后会自动收起，不再占版面。</small>
          </div>
        </div>
      </div>

      <!-- ===== 运营计划表（内容生成总纲）===== -->
      <div class="module-toolbar panel">
        <div><span class="section-label">OPERATION PLAN</span><h2>运营计划表 · 账号总纲</h2><p>内容方向的默认依据：无人工干预时，生成的内容跟着它走。</p></div>
        <div style="display:flex;gap:10px;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px">每天发
            <input v-model.number="postsPerDay" type="number" min="1" max="9" style="width:56px;padding:7px 8px;border:1px solid #e3dcd2;border-radius:8px;text-align:center" />
            条
          </label>
          <button class="outline-button" type="button" :disabled="savingPositioning" @click="savePositioning">{{ savingPositioning ? '保存中…' : '保存计划表' }}</button>
        </div>
      </div>
      <p v-if="positioningError" class="panel" style="padding:12px 16px;margin:0 0 12px">{{ positioningError }}</p>
      <div class="panel" style="padding:18px 20px;margin-bottom:18px">
        <p style="margin:0 0 14px;color:#8b8175;font-size:11px;line-height:1.7">
          人设 / 目标人群 / 语气 / 卖点 / 转化目标 统一在<b>上方「人物设定 · 目标人群 · 核心要求」</b>里设置
          （这里不再重复，避免两处打架）。本卡片只保留「内容支柱占比」与「每天发几条」。
        </p>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
          <b style="font-size:13px">内容支柱占比</b>
          <span style="font-size:12px;color:#b4544a" v-if="pillarsDefault">（当前是默认模板，保存后成为你自己的计划）</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          <label v-for="(p, i) in pillars" :key="'pl' + i" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#faf7f3;border-radius:9px;font-size:12px">
            <span>{{ p.name }}</span>
            <input v-model.number="pillars[i].ratio" type="number" min="0" max="100" style="width:48px;padding:4px 6px;border:1px solid #e3dcd2;border-radius:6px;text-align:center;font-size:12px" />%
          </label>
        </div>
        <p style="margin:14px 0 0;font-size:12px;color:#8b8175">每天发 {{ postsPerDay }} 条 → 7 天窗口共需产出 <b>{{ weekTotal }}</b> 篇；之后每天生成 1 次（补第 7 天那批）。</p>
      </div>

      <div class="outline-overview panel">
        <template v-if="weekPlan">
          <div><span class="section-label">WEEKLY STORY ARC</span><h2>本周主线：{{ weekPlan.theme || '(未填主线)' }}</h2><p>{{ weekPlanMeta }}</p></div>
          <div class="arc-progress"><span><b>{{ weekPlanDone }}</b> / {{ weekPlanTotal }} 天</span><i><em :style="`width:${weekPlanPercent}%`" /></i><small>节点完成 {{ weekPlanPercent }}%</small></div>
        </template>
        <template v-else-if="weekPlanError">
          <div><span class="section-label">WEEKLY STORY ARC</span><h2>本周主线：读取失败</h2><p>{{ weekPlanError }}</p></div>
        </template>
        <template v-else-if="weekPlanLoading">
          <div><span class="section-label">WEEKLY STORY ARC</span><h2>本周主线：读取中…</h2><p>正在读取本机计划数据。</p></div>
        </template>
        <div v-else>
          <span class="section-label">WEEKLY STORY ARC</span>
          <h2>本周主线：还没有创建</h2>
          <p>{{ positioningReady ? `本机还没有写入本周大纲，所以这里不显示主线 —— 系统不会自己编一条。下方「运营计划表」已保存，AI 生成内容会按它走（每天 ${postsPerDay} 条）。` : '本机还没有写入本周大纲，所以这里不显示主线 —— 先在下方填好「运营计划表」，再创建本周大纲。' }}</p>
        </div>
      </div>
      <div class="story-map">
        <button v-for="(item, index) in weeklyContents" :key="item.day" type="button" :class="['story-node', 'panel', { active: selectedOutlineDay === index, done: item.rawStatus === 'published' }]" @click="selectedOutlineDay = index">
          <span class="story-index">{{ item.day }}</span><div><small>{{ item.stage }}</small><b>{{ item.title }}</b><em>{{ nodeHint(item) }}</em></div><CircleCheck v-if="item.rawStatus === 'published'" :size="18" /><ChevronRight v-else :size="18" />
        </button>
      </div>
      <article class="continuity-card panel"><span class="continuity-icon"><BookOpenCheck :size="21" /></span><div><span class="section-label">连贯性检查</span><h3>D{{ selectedOutlineDay + 1 }} 如何承上启下</h3><p>{{ selectedOutlineDay === 0 ? '先说出新手真实痛点，为后续工具与方法建立学习动机。' : `承接 D${selectedOutlineDay} 的结论，加入新的证明或行动，并为 D${selectedOutlineDay + 2 > 7 ? 7 : selectedOutlineDay + 2} 留下明确的问题。` }}</p></div><span class="gate-pass"><Check :size="13" />逻辑通过</span></article>
    
      <!-- ===================== R23 互动区 ===================== -->
      <div class="module-toolbar panel">
        <div><span class="section-label">INTERACTION</span><h2>互动区</h2>
          <p>评论自动回复开关在这里；下面是我们回复了谁、谁给我们留言了。</p></div>
        <span class="demo-badge">私信平台未开放自动回复</span>
      </div>

      <div class="panel reply-switch-card">
        <div>
          <span class="section-label">评论自动回复</span>
          <strong>{{ replyOn ? '已开启 · 命中资料库就自动回' : '已关闭 · 只生成不发送，转人工待办' }}</strong>
          <small>{{ replyOn ? '回复前仍会过：人工介入名单 → 资料库命中 → 禁用词 → 观察期' : '评论照常收集与匹配，你在「系统设置」的待办里逐条确认发送' }}</small>
        </div>
        <button type="button" :class="['switch-control', { active: replyOn }]" :aria-pressed="replyOn" :disabled="replySaving" @click="toggleReply" aria-label="评论自动回复开关"><i /></button>
      </div>

      <div class="panel interaction-panel">
        <div class="panel-head">
          <div><span class="section-label">FEED</span><h3>互动动态</h3></div>
          <button class="outline-button" type="button" @click="loadInteractionFeed">刷新</button>
        </div>
        <div class="feed-grid">
          <section class="feed-col">
            <h4>我们回复了谁（{{ feedReplies2.length }}）</h4>
            <p v-if="!feedReplies2.length" class="feed-empty">还没有回复记录 · 开启开关或人工回复后会在这里出现</p>
            <ul v-else class="feed-list">
              <li v-for="(r, i) in feedReplies2" :key="'ir' + (r.id != null ? r.id : i)">
                <div class="feed-line"><b>{{ r.user || '匿名用户' }}</b><span class="feed-tag">{{ r.mode === 'auto' ? '自动回复' : '人工回复' }}</span><time>{{ r.at ? String(r.at).slice(5, 16).replace('T', ' ') : '' }}</time></div>
                <p class="feed-quote">{{ r.comment }}</p>
                <p v-if="r.reply" class="feed-reply">我们：{{ r.reply }}</p>
                <small v-if="r.note">来自笔记《{{ r.note }}》</small>
              </li>
            </ul>
          </section>
          <section class="feed-col">
            <h4>用户留言了什么（{{ feedIncoming2.length }}）</h4>
            <p v-if="!feedIncoming2.length" class="feed-empty">还没有留言 · 新评论进来后会在这里出现</p>
            <ul v-else class="feed-list">
              <li v-for="(m, i) in feedIncoming2" :key="'im2' + i">
                <div class="feed-line"><b>{{ m.user || '匿名用户' }}</b><time>{{ m.at ? String(m.at).slice(5, 16).replace('T', ' ') : '' }}</time></div>
                <p class="feed-quote">{{ m.text }}</p>
                <small v-if="m.note">来自笔记《{{ m.note }}》</small>
              </li>
            </ul>
          </section>
        </div>
        <div class="dm-entry">
          <b>私信</b>
          <small>平台未给接口，自动回复做不了（已实测确认）。这里给一个人工入口：</small>
          <a class="outline-button" href="https://www.xiaohongshu.com/messages" target="_blank" rel="noopener">打开小红书私信（人工回）</a>
        </div>
      </div>
</template>

    <template v-else-if="props.activeView === 'library'">
      <div class="library-toolbar panel">
        <div><span class="section-label">历史内容资产</span><h2>文案库 · {{ libraryRows.length }} 篇</h2><p>已发布、草稿和排期内容都会参与语义查重。</p></div>
        <label class="search-field"><Search :size="16" /><input v-model="libraryQuery" type="search" placeholder="搜索标题、来源或状态"></label>
        <button class="outline-button" type="button" :disabled="importing" @click="importHistory"><FileText :size="16" />{{ importing ? '导入中…' : '从我的小红书导入' }}</button>
      </div>
      <p v-if="libraryError" class="panel" style="padding:12px 16px;margin:0 0 12px">{{ libraryError }}</p>
      <p v-else-if="libraryLoading" class="panel" style="padding:12px 16px;margin:0 0 12px">正在读取文案库…</p>
      <div class="library-layout">
        <div class="library-table panel">
          <div class="library-head"><span>内容标题</span><span>主题</span><span>状态</span><span>最高相似度</span><span>收录日期</span></div>
          <article v-for="item in filteredLibrary" :key="item.id || item.title" class="library-row"><b>{{ item.title }}</b><span>{{ item.topic }}</span><span>{{ item.status }}</span><span class="pass-text"><LockKeyhole :size="13" />{{ item.similarity === null ? '—' : item.similarity + '%' }}</span><small>{{ item.date }}</small></article>
          <div v-if="!filteredLibrary.length" class="empty-library"><Search :size="22" /><b>{{ libraryRows.length ? '没有找到相关文案' : '文案库还是空的' }}</b><small>{{ libraryRows.length ? '换一个关键词试试。' : '点右上角「从我的小红书导入」，把你已经发过的笔记收进来。' }}</small></div>
        </div>
        <aside class="gate-policy panel"><span class="policy-icon"><LockKeyhole :size="21" /></span><span class="section-label">原创度规则</span><h3>60% 硬门禁</h3><p>每次生成会比较标题、正文结构、核心观点和表达方式。</p><div class="threshold"><span>当前最高 {{ maxSimilarity === null ? '—' : maxSimilarity + '%' }}</span><b>门禁 60%</b><i><em :style="{ width: (maxSimilarity === null ? 0 : Math.min(100, maxSimilarity)) + '%' }" /></i></div><ul><li><Check :size="13" />达到 60% 自动退回</li><li><Check :size="13" />最多自动重写 3 次</li><li><Check :size="13" />通过后才允许排期</li></ul></aside>
      </div>
    
      <!-- ===================== R24 资料库（文案库下方） ===================== -->
      <div class="module-toolbar panel">
        <div><span class="section-label">KNOWLEDGE BASE</span><h2>资料库</h2>
          <p>上传文档（docx / pdf / txt / md）→ 服务端解析成 AI 能用的知识条目 → **评论回复只能靠它回答**，不许乱编。</p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <input ref="docInput" type="file" multiple accept=".docx,.pdf,.txt,.md" style="display:none" @change="onDocsPicked" />
          <button class="outline-button" type="button" :disabled="docUploading" @click="pickDocs">{{ docUploading ? '解析中…（PDF 稍慢）' : '上传文档' }}</button>
          <button class="outline-button" type="button" @click="loadLibraryDocs">刷新</button>
        </div>
      </div>
      <p v-if="docError" class="panel" style="padding:12px 16px">{{ docError }}</p>
      <p v-if="docMsg" class="panel" style="padding:12px 16px;border-color:#b9d3c1">{{ docMsg }}</p>

      <div class="panel docs-panel">
        <div class="panel-head">
          <div><span class="section-label">DOCS</span><h3>已上传资料 · {{ docs.length }} 份</h3>
            <p class="pool-note">共生成 {{ docEntries }} 条知识条目，自动进入评论回复的匹配库。</p></div>
        </div>
        <p v-if="!docs.length" class="pool-empty">还没有资料 —— 先传一份服务手册/价目表/常见问题，回复才有依据。</p>
        <div v-else class="doc-list">
          <article v-for="d in docs" :key="'dc' + d.id" class="doc-row">
            <span class="doc-ext">{{ (d.ext || '').replace('.', '').toUpperCase() }}</span>
            <span class="doc-copy">
              <b>{{ d.name }}</b>
              <small>{{ d.status === 'ok' ? `${d.chars} 字 · 生成 ${d.entries} 条知识条目` : '解析失败：' + (d.note || '') }}</small>
              <small class="doc-preview">{{ d.preview }}…</small>
            </span>
            <span class="doc-actions">
              <button type="button" @click="rebuildDoc(d)" :disabled="docBusy === d.id">重建条目</button>
              <button type="button" style="color:#b4544a" @click="removeDoc(d)">删除</button>
            </span>
          </article>
        </div>

        <div class="doc-test">
          <b>命中自测（验收用）</b>
          <small>输入一句客户可能问的话，看能不能从资料里命中 —— 命中才可能被正确回复。</small>
          <div class="chat-input">
            <input v-model="matchProbe" placeholder="例：体验课多少钱 / 怎么预约" @keyup.enter="runMatchProbe" />
            <button class="outline-button" type="button" :disabled="matchProbing" @click="runMatchProbe">{{ matchProbing ? '匹配中…' : '测一下' }}</button>
          </div>
          <div v-if="matchResult" class="match-result">
            <b :style="matchResult.matched ? 'color:#5a8a6a' : 'color:#b4544a'">
              {{ matchResult.matched ? `✅ 命中（得分 ${matchResult.score}，来源：${matchResult.source === 'library' ? '资料库' : '手工知识库'}）` : '❌ 没命中 —— 系统不会乱回，会转人工待办' }}
            </b>
            <p v-if="matchResult.matched">命中内容：{{ (matchResult.answer || '').slice(0, 120) }}…</p>
          </div>
        </div>
      </div>
</template>

    <template v-else-if="props.activeView === 'settings'">
      <div class="settings-banner panel"><span class="settings-icon"><ServerCog :size="23" /></span><div><span class="section-label">本机运行状态</span><h2>{{ bannerTitle }}</h2><p>{{ realStatus.error || (realStatus.checkedAt ? `检测时间 ${realStatus.checkedAt} · 数据来自本机服务，密钥只存本机` : '正在读取本机服务状态…') }}</p></div><span class="status-good"><Check :size="14" />{{ healthyCount }} / 4 正常</span></div>

      <!-- ============ ① 账号与密钥（客户机没有 Hermes，全部在界面里填） ============ -->
      <div class="settings-grid">
        <!-- 小红书登录 / 切换账号：二维码直接嵌在卡里 -->
        <article class="setting-panel panel account-card">
          <div class="panel-head">
            <div><span class="section-label">XIAOHONGSHU</span><h3>小红书账号</h3></div>
            <span :class="['conn-state', acc.loggedIn ? 'ok' : 'bad']">{{ acc.loading ? '检测中…' : (acc.loggedIn ? '已登录' : '未登录') }}</span>
          </div>
          <p class="acc-line">
            <b>{{ acc.loggedIn ? (acc.username || '已登录账号') : '还没有登录' }}</b>
            <small>{{ acc.loggedIn ? '授权保存在本机，失效时重新扫码即可' : '扫码后系统才能发内容、读评论' }}</small>
          </p>
          <div class="acc-actions">
            <button class="outline-button" type="button" :disabled="qr.busy" @click="openSwitchAccount">
              {{ qr.img ? '换一张二维码' : (acc.loggedIn ? '切换账号（扫码）' : '扫码登录') }}
            </button>
            <button class="outline-button" type="button" @click="loadAccStatus">刷新状态</button>
          </div>
          <div v-if="qr.img || qr.error || qr.busy" class="qr-inline">
            <img v-if="qr.img" :src="qr.img" alt="小红书登录二维码" />
            <div v-else class="qr-empty">{{ qr.busy ? '正在获取二维码…' : qr.error }}</div>
            <small v-if="qr.img">用【小红书 App】→ 扫一扫 → 确认登录。二维码 {{ qr.left }} 秒后失效{{ qr.justOk ? ' · 已登录成功' : '' }}</small>
          </div>
        </article>

        <!-- DeepSeek Key：手动输入 + 保存并检查 -->
        <article class="setting-panel panel">
          <div class="panel-head">
            <div><span class="section-label">AI · DEEPSEEK</span><h3>文案/回复模型</h3></div>
            <span :class="['conn-state', ds.ready ? 'ok' : 'bad']">{{ ds.ready ? '已配置' : '未配置' }}</span>
          </div>
          <label class="studio-field"><span>API Key（{{ ds.keyMasked || '未填' }}）</span>
            <input v-model="keyForm.deepseekKey" type="password" placeholder="sk-…（粘贴后点右侧保存并检查）" /></label>
          <div class="key-row">
            <label class="studio-field"><span>Base（可留空用官方）</span><input v-model="keyForm.deepseekBase" :placeholder="ds.base || 'https://api.deepseek.com'" /></label>
            <label class="studio-field"><span>模型</span><input v-model="keyForm.deepseekModel" :placeholder="ds.model || 'deepseek-chat'" /></label>
          </div>
          <div class="acc-actions">
            <button class="outline-button" type="button" :disabled="keyBusy" @click="saveAndTest('deepseek')">{{ keyBusy === 'deepseek' ? '检查中…' : '保存并检查' }}</button>
            <span v-if="keyResult.deepseek" :class="['key-result', keyResult.deepseek.ok ? 'ok' : 'bad']">
              {{ keyResult.deepseek.ok ? `✅ 可用（${keyResult.deepseek.ms}ms）` : '❌ ' + (keyResult.deepseek.error || '不可用') }}
            </span>
          </div>
        </article>

        <!-- 生图渠道：渠道可切换 + 真实像素档位 -->
        <article class="setting-panel panel">
          <div class="panel-head">
            <div><span class="section-label">AI · IMAGE</span><h3>生图渠道</h3></div>
            <span :class="['conn-state', img.ready ? 'ok' : 'bad']">{{ img.ready ? '已配置' : '未配置' }}</span>
          </div>
          <label class="studio-field"><span>渠道</span>
            <select v-model="keyForm.imageProvider">
              <option v-for="p in (img.providers || [])" :key="p.key" :value="p.key">{{ p.name }}（{{ p.model }}）</option>
            </select></label>
          <label class="studio-field"><span>API Key（{{ img.keyMasked || '未填' }}）</span>
            <input v-model="keyForm.imageKey" type="password" placeholder="粘贴生图渠道 Key" /></label>
          <label class="studio-field"><span>Base URL</span><input v-model="keyForm.imageBase" :placeholder="img.base || 'https://www.apikiki.com'" /></label>
          <div class="tier-table">
            <b>这个渠道能出多大（真实像素，不是宣传词）</b>
            <span v-for="t in (img.tiers ? Object.values(img.tiers) : [])" :key="t.key">
              {{ t.name }} · {{ t.pixels }} <small>{{ t.note }}</small>
            </span>
            <small class="tier-note">⚠️ qweapi 的 gpt-image 系最高 1K（生不了 2K/4K）；image2.5 需先在渠道方开通，否则会 404。</small>
          </div>
          <div class="acc-actions">
            <button class="outline-button" type="button" :disabled="keyBusy" @click="saveAndTest('image')">{{ keyBusy === 'image' ? '检查中…' : '保存并检查' }}</button>
            <button class="outline-button" type="button" :disabled="shotBusy" @click="runTestShot">{{ shotBusy ? '出图中…（约60-90秒）' : '试出一张' }}</button>
          </div>
          <p v-if="keyResult.image" :class="['key-result', keyResult.image.ok ? 'ok' : 'bad']">
            {{ keyResult.image.ok ? '✅ ' + (keyResult.image.note || 'Key 有效') : '❌ ' + (keyResult.image.error || '不可用') }}
          </p>
          <div v-if="shotResult" class="shot-result">
            <img :src="imgProxy(shotResult.url)" alt="" />
            <small>试出成功：{{ shotResult.pixels || shotResult.imageSize }} · {{ shotResult.tierName }} · 耗时 {{ (shotResult.spentMsTotal / 1000).toFixed(0) }}s · 已入素材库 #{{ shotResult.assetId }}</small>
          </div>
        </article>

        <!-- 内容与发布保护：真开关 -->
        <article class="setting-panel panel">
          <div class="panel-head">
            <div><span class="section-label">CONTENT SAFETY</span><h3>内容与发布保护</h3></div><ShieldCheck :size="19" />
          </div>
          <div class="setting-rows">
            <div><span><b>发布前人工确认</b><small>开 = 到点先转「待确认」，你点确认才发（无人值守发布会自动关）</small></span>
              <button type="button" :class="['switch-control', { active: !guard.autoSend }]" :disabled="guardSaving" @click="toggleGuard('autoSend')"><i /></button></div>
            <div><span><b>相似度超限自动重写</b><small>达到 60% 门禁时自动重写（最多 3 次）；关掉就直接落库但仍记录相似度</small></span>
              <button type="button" :class="['switch-control', { active: guard.dedupeRewrite }]" :disabled="guardSaving" @click="toggleGuard('dedupeRewrite')"><i /></button></div>
            <div><span><b>允许无人值守发布</b><small>开 = 到点无需询问，系统直接发送</small></span>
              <button type="button" :class="['switch-control', { active: guard.autoSend }]" :disabled="guardSaving" @click="toggleGuard('autoSend')"><i /></button></div>
            <div><span><b>发布保护（五项预检）</b><small>登录态 / 查重 / 配图 / 正文 / 发布间隔，全过才发</small></span>
              <button type="button" :class="['switch-control', { active: guard.protect }]" :disabled="guardSaving" @click="toggleGuard('protect')"><i /></button></div>
          </div>
        </article>
      </div>

      <div class="settings-grid" style="margin-top:16px">
        <article class="setting-panel panel"><div class="panel-head"><div><span class="section-label">LOCAL DEPLOYMENT</span><h3>本地运行环境</h3></div><ServerCog :size="19" /></div><div class="environment-list"><span><Check :size="14" /><b>系统环境</b><small>{{ envOsText }}</small></span><span><Check :size="14" /><b>服务组件</b><small>已安装</small></span><span><Check :size="14" /><b>数据目录</b><small>可读写</small></span><span><Check :size="14" /><b>定时任务</b><small>服务正常</small></span></div><button class="outline-button full" type="button" @click="recheckEnv"><RefreshCw :size="15" />重新检测环境</button></article>
      </div>

      <!-- ============ 评论自动回复（保留） ============ -->
      <article class="module-toolbar panel" style="margin-top:16px">
        <div><span class="section-label">COMMENT AUTO-REPLY</span><h2>评论自动回复</h2>
        <p>后台每 5 分钟纯规则轮询；<b>命中知识库才用 AI 生成回复</b>，未命中一律进人工待办（不瞎回）</p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="outline-button" type="button" :disabled="commentBusy" @click="pollCommentsNow">{{ commentBusy ? '处理中…' : '立即跑一轮' }}</button>
          <button class="outline-button" type="button" @click="loadComments">刷新</button>
        </div>
      </article>

      <div v-if="commentStats" class="panel" style="padding:14px 18px;margin-bottom:16px;font-size:13px">
        <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center">
          <div><span class="section-label">总计</span><b style="font-size:17px">{{ commentStats.total }}</b></div>
          <div><span class="section-label">待人工</span><b style="font-size:17px">{{ commentStats.pending_review || 0 }}</b></div>
          <div><span class="section-label">自动回复</span><b style="font-size:17px">{{ commentStats.auto || 0 }}</b></div>
          <div><span class="section-label">人工回复</span><b style="font-size:17px">{{ commentStats.manual || 0 }}</b></div>
          <div style="margin-left:auto;text-align:right">
            <span class="section-label">观察期</span>
            <b :style="commentStats.inObservation ? 'color:#b4544a' : 'color:#5a8a6a'">{{ commentStats.inObservation ? '进行中（至 ' + commentStats.observationUntil + '）' : '已结束' }}</b>
          </div>
        </div>
      </div>

      <div class="panel" style="padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b style="font-size:13px">评论处理</b>
          <div style="display:flex;gap:6px">
            <button v-for="f in [['pending_review','待人工'],['auto','自动'],['manual','人工'],['skipped','已跳过'],['','全部']]" :key="'cf'+f[0]" type="button" :style="commentFilter === f[0] ? 'color:#b4544a' : ''" @click="switchCommentFilter(f[0])">{{ f[1] }}</button>
          </div>
        </div>
        <div v-if="!commentList.length" style="color:#8b8175;font-size:13px">没有该状态的评论记录</div>
        <div v-for="c in commentList" :key="'cm' + c.id" style="border-top:1px solid #f0ebe3;padding:10px 0;font-size:13px">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:260px">
              <b>{{ c.user_name || '(匿名)' }}</b><span style="color:#8b8175"> · {{ c.note_title || c.note_id }}</span>
              <div style="margin-top:4px">💬 {{ c.content }}</div>
              <div v-if="c.reply_text" style="margin-top:6px;color:#5a8a6a">↩ 拟回复（{{ c.reply_text.length }}字）：{{ c.reply_text }}</div>
              <div v-if="c.skip_reason" style="margin-top:4px;color:#8b8175;font-size:12px">原因：{{ c.skip_reason }}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <span :class="['queue-state', { waiting: c.reply_status === 'pending_review' }]">{{ COMMENT_STATE[c.reply_status] || c.reply_status }}</span>
              <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                <button v-if="!c.replied && c.reply_text" type="button" style="color:#5a8a6a" @click="approveReply(c)">通过并发送</button>
                <button type="button" @click="addTakeoverByUser(c)">暂停该用户自动回复</button>
              </div>
              <div v-if="!c.replied" style="display:flex;gap:6px;margin-top:2px">
                <input v-model="manualReplyText[c.id]" placeholder="人工回复内容" style="padding:6px 9px;border:1px solid #e3dcd2;border-radius:8px;font-size:12px;width:170px" />
                <button type="button" @click="sendManualReply(c)">发送</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ 人设卡（定性 + 继承） + 禁用词 ============ -->
      <div class="settings-grid" style="margin-bottom:16px">
        <article class="setting-panel panel">
          <div class="panel-head"><div><span class="section-label">REPLY PERSONA</span><h3>评论回复人设</h3></div></div>
          <p class="pool-note">
            <b>这张卡只管「评论回复怎么说话」</b>，不是账号人设 —— 账号人设（我是谁 / 给谁看 / 核心要求）在「运营大纲 · 三板块」。
            没单独设置时<b>自动继承运营大纲</b>{{ personaCard && personaCard.inheritedFrom ? '（当前：继承中）' : '' }}，不会两边打架。
          </p>
          <div v-if="personaCard" style="display:flex;flex-direction:column;gap:8px;font-size:13px">
            <label class="studio-field"><span>称呼</span><input v-model="personaCard.name" /></label>
            <label class="studio-field"><span>角色定位</span><input v-model="personaCard.role" /></label>
            <label class="studio-field"><span>回复语气</span><input v-model="personaCard.tone" /></label>
            <label class="studio-field"><span>禁忌（逗号分隔）</span><input :value="(personaCard.taboo || []).join('、')" @input="personaCard.taboo = $event.target.value.split(/[、,，]/).filter(Boolean)" /></label>
            <div class="acc-actions">
              <button class="outline-button" type="button" @click="savePersonaCard">保存回复人设</button>
              <button class="outline-button" type="button" @click="resetPersonaCard">恢复继承运营大纲</button>
            </div>
          </div>
        </article>

        <article class="setting-panel panel">
          <div class="panel-head"><div><span class="section-label">FORBIDDEN</span><h3>禁用词表（{{ forbiddenCount }} 个）</h3></div></div>
          <p class="pool-note">已内置一套**专业词表**（广告法绝对化用语 / 医疗违规 / 引流私加 / 贬低同行）。命中任一 → 转人工，不自动发。可直接改、可加。</p>
          <textarea v-model="forbiddenText" rows="7" class="forbidden-box" placeholder="每行或空格分隔一个词"></textarea>
          <div class="acc-actions">
            <button class="outline-button" type="button" @click="saveForbidden">保存禁用词</button>
            <button class="outline-button" type="button" @click="loadDefaultForbidden">载入专业词表（默认）</button>
          </div>
        </article>
      </div>

      <!-- ============ 知识库（两部分） ============ -->
      <div class="module-toolbar panel">
        <div><span class="section-label">KNOWLEDGE</span><h2>知识库 · 自动回复的唯一依据</h2>
          <p>两条路把知识喂进来：① 上传文档，AI 自动提炼成能用的问答条目；② 直接跟 AI 对话，把店里的实际情况说清楚，它帮你写条目。</p></div>
        <div class="acc-actions">
          <input ref="docInput2" type="file" multiple accept=".docx,.pdf,.txt,.md" style="display:none" @change="onDocsPicked" />
          <button class="outline-button" type="button" :disabled="docUploading" @click="pickDocs">{{ docUploading ? '解析中…' : '上传文档' }}</button>
        </div>
      </div>
      <p v-if="docMsg" class="panel" style="padding:12px 16px;border-color:#b9d3c1">{{ docMsg }}</p>
      <p v-if="docError" class="panel" style="padding:12px 16px">{{ docError }}</p>

      <div class="settings-grid" style="margin-bottom:16px">
        <!-- ① 文档 → 知识 -->
        <article class="setting-panel panel">
          <div class="panel-head"><div><span class="section-label">FROM DOCS</span><h3>① 文档提炼（{{ docs.length }} 份）</h3></div></div>
          <p v-if="!docs.length" class="pool-empty">还没有文档 —— 先传一份服务手册 / 价目表 / 常见问题。</p>
          <div v-else class="doc-list">
            <article v-for="d in docs" :key="'kdoc' + d.id" class="doc-row">
              <span class="doc-ext">{{ (d.ext || '').replace('.', '').toUpperCase() }}</span>
              <span class="doc-copy"><b>{{ d.name }}</b>
                <small>{{ d.status === 'ok' ? `${d.chars} 字` : '解析失败：' + (d.note || '') }}</small>
              </span>
              <span class="doc-actions">
                <button type="button" :disabled="analyzeBusy === d.id" @click="runAnalyze(d)">{{ analyzeBusy === d.id ? 'AI 提炼中…' : 'AI 提炼' }}</button>
                <button type="button" style="color:#b4544a" @click="removeDoc(d)">删除</button>
              </span>
            </article>
          </div>
          <div class="doc-test">
            <b>命中自测</b><small>输入客户可能问的话，看能不能从知识里命中</small>
            <div class="chat-input">
              <input v-model="matchProbe" placeholder="例：体验课多少钱" @keyup.enter="runMatchProbe" />
              <button class="outline-button" type="button" :disabled="matchProbing" @click="runMatchProbe">测一下</button>
            </div>
            <div v-if="matchResult" class="match-result">
              <b :style="matchResult.matched ? 'color:#5a8a6a' : 'color:#b4544a'">{{ matchResult.matched ? `✅ 命中（${matchResult.score} 分 · 来源：${matchResult.source === 'library' || matchResult.source === 'library_ai' ? '资料库' : matchResult.source === 'chat' ? 'AI 对话' : '手工'}）` : '❌ 没命中 —— 不会乱回，转人工待办' }}</b>
              <p v-if="matchResult.matched">命中内容：{{ (matchResult.answer || '').slice(0, 100) }}…</p>
            </div>
          </div>
        </article>

        <!-- ② 对话补全知识 -->
        <article class="setting-panel panel outline-chat" style="padding:16px 18px">
          <div class="panel-head"><div><span class="section-label">TALK TO AI</span><h3>② 跟 AI 补全知识库</h3></div>
            <button class="outline-button" type="button" @click="resetKnowledgeChat">清空对话</button></div>
          <div class="chat-list" style="max-height:260px">
            <p v-if="!kbChat.length" class="chat-empty">例：「体验课 199 元 90 分钟，可美团预约，不退款」—— 说清事实，AI 会写成客户问得出来的问答条目。</p>
            <div v-for="m in kbChat" :key="'kc' + m.id" :class="['chat-msg', m.role]">
              <b>{{ m.role === 'user' ? '你' : 'AI' }}</b>
              <p>{{ m.content }}</p>
              <small v-if="m.added && m.added.length">✅ 已写入 {{ m.added.length }} 条知识：{{ m.added.map(a => a.question).join('；') }}</small>
            </div>
          </div>
          <div class="chat-input">
            <input v-model="kbDraft" placeholder="把店里的实际情况说给 AI（价格/时长/预约方式等）" @keyup.enter="sendKnowledgeChat" />
            <button class="outline-button" type="button" :disabled="kbSending" @click="sendKnowledgeChat">{{ kbSending ? '整理中…' : '发送' }}</button>
          </div>
        </article>
      </div>

      <!-- 知识条目清单 -->
      <div class="panel" style="padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <b style="font-size:13px">知识条目（{{ kbEntries.length }} 条 · 自动回复只从这里取答案）</b>
          <div class="acc-actions">
            <button v-for="f in [['','全部'],['library_ai','文档提炼'],['chat','AI 对话'],['manual','手工']]" :key="'kf'+f[0]" type="button" :style="kbFilter === f[0] ? 'color:#b4544a;font-weight:700' : ''" @click="kbFilter = f[0]; loadKbEntries()">{{ f[1] }}</button>
          </div>
        </div>
        <p v-if="!kbEntries.length" style="color:#8b8175;font-size:13px;margin-top:10px">还没有知识条目 —— 不添加就永远不会自动回复（这是设计，不是 bug）。</p>
        <div v-for="k in kbEntries" :key="'kb' + k.id" class="kb-row">
          <div>
            <b>{{ k.question }}</b>
            <span class="kb-src">{{ k.source === 'library_ai' ? '文档提炼' : k.source === 'chat' ? 'AI 对话' : k.source === 'library' ? '资料原文' : '手工' }}</span>
            <div class="kb-ans">{{ k.answer }}</div>
            <div class="kb-kw">关键词：{{ (k.keywords || []).join('、') }}</div>
          </div>
          <button type="button" style="color:#b4544a" @click="removeKbEntry(k)">删除</button>
        </div>
      </div>

    </template>
  </section>
</template>
