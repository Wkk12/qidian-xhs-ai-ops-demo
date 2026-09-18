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

async function loadRealStatus() {
  realStatus.value.loading = true
  realStatus.value.error = ''
  try {
    const [h, m, s] = await Promise.allSettled([api.health(), api.mcpStatus(), api.settings()])
    if (h.status === 'fulfilled') realStatus.value.mcpService = !!h.value.ok
    if (m.status === 'fulfilled') {
      realStatus.value.mcpService = !!m.value.service
      realStatus.value.loggedIn = !!m.value.loggedIn
      realStatus.value.username = m.value.username || ''
      realStatus.value.account = m.value.account || ''
    }
    if (s.status === 'fulfilled') {
      const keys = (s.value.items || []).map((x) => x.key)
      realStatus.value.deepseek = keys.some((k) => /deepseek/i.test(k))
      realStatus.value.image = keys.some((k) => /image|qwe|img/i.test(k))
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
  const tag = notesError.value ? '读取失败' : (pending ? '读取中…' : '真实数据')
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
      similarity: typeof it.dup_score === 'number' ? it.dup_score : null,
      date: (it.created_at || '').slice(5, 10).replace('-', '/'),
    }
  }),
)

// 高潜内容方向：按内容库真实构成统计（替代原假话题榜）
const topicRanks = computed(() => {
  const items = libraryItems.value
  const total = items.length || 1
  const bySource = {}
  for (const it of items) {
    const k = it.source === 'history' ? '历史笔记' : (it.source === 'generated' ? 'AI 生成' : '手动录入')
    bySource[k] = (bySource[k] || 0) + 1
  }
  return Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, cnt]) => ({ name, value: Math.round((cnt / total) * 100), grow: cnt + ' 篇' }))
})

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
  } catch (e) {
    /* 读取失败保持空，页面显示空状态 */
  } finally {
    contentsLoading.value = false
  }
}

// 注意：ModuleViews 由 App.vue 的 v-else 挂载，首次进入某模块时组件刚挂载，
// watch 默认不捕获初始值 → 必须 immediate:true，否则首次进入不加载数据。
const onViewChange = (v) => {
  if (v === 'settings') { loadRealStatus(); loadComments() }
  if (v === 'assets') { loadAssets(); api.imageStatus().then(r => { imgStatus.value = r }).catch(() => {}) }
  if (v === 'analytics') { loadMyNotes(); loadMetrics(); loadCreator(); loadCompetitors(); loadManual() }
  if (v === 'studio') { loadContents(); loadTrends(); loadAiStatus(); syncGenConfig() }
  if (v === 'library') loadLibrary()
  if (v === 'schedule') { loadContents(); loadPublish(true) }
  if (v === 'outline' || v === 'dashboard') { loadContents(); loadPositioning(); loadCompetitors() }
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

/* -------- 手工填报（R13：咨询数/到店数） -------- */
const manualRows = ref([])
const manualTotal = ref({ inquiries: 0, visits: 0 })
const manualForm = ref({ date: new Date().toISOString().slice(0, 10), inquiries: '', visits: '', note: '' })
const manualSaving = ref(false)
const manualError = ref('')

async function loadManual() {
  manualError.value = ''
  try {
    const r = await api.manualMetrics(30)
    manualRows.value = r.items || []
    manualTotal.value = r.total || { inquiries: 0, visits: 0 }
  } catch (e) {
    manualError.value = '读取手工填报失败：' + (e.message || '')
  }
}

async function saveManual() {
  manualSaving.value = true
  manualError.value = ''
  try {
    await api.saveManualMetrics({
      date: manualForm.value.date,
      inquiries: manualForm.value.inquiries === '' ? 0 : Number(manualForm.value.inquiries),
      visits: manualForm.value.visits === '' ? 0 : Number(manualForm.value.visits),
      note: manualForm.value.note,
    })
    showNotice('已保存（同日重复录入会覆盖）')
    await loadManual()
  } catch (e) {
    manualError.value = '保存失败：' + (e.message || '')
  } finally {
    manualSaving.value = false
  }
}

async function deleteManual(date) {
  if (!window.confirm('删除 ' + date + ' 的填报？')) return
  try {
    await api.deleteManualMetrics(date)
    await loadManual()
  } catch (e) { showNotice('删除失败：' + (e.message || '')) }
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

onBeforeUnmount(() => {
  window.clearTimeout(generationTimer)
  window.clearTimeout(noticeTimer)
})
</script>

<template>
  <section class="module-view">
    <template v-if="props.activeView === 'studio'">
      <div class="module-toolbar panel">
        <div><span class="section-label">生成方案</span><h2>一周内容批量创作</h2><p>先锁定连续大纲，再生成 7 条可逐篇编辑的内容。</p></div>
        <div class="config-pills" aria-label="生成配置">
          <span><b>7</b> 天</span><span><b>1</b> 条/天</span><span><b>6</b> 图/条</span><span><b>图文</b> 类型</span>
        </div>
        <ElButton class="module-primary" type="primary" round :loading="genRunning" @click="runGenerate">
          <Sparkles :size="16" />{{ generating ? '正在生成...' : '重新生成 7 天草稿' }}
        </ElButton>
      </div>

      <div v-if="generating || generationDone" :class="['generation-strip', { done: generationDone }]" aria-live="polite">
        <span class="generation-orb"><RefreshCw v-if="generating" :size="16" /><Check v-else :size="16" /></span>
        <div><b>{{ generating ? 'AI 正在沿大纲创作' : '7 天草稿已生成' }}</b><small>{{ generating ? '匹配热点 → 生成文案 → 文案库查重 → 安排配图' : '7 条内容全部低于 60% 相似度，可逐篇编辑。' }}</small></div>
      </div>

      <!-- ===== AI 内容生成（策略输入 + 7天窗口）===== -->
      <div class="module-toolbar panel">
        <div><span class="section-label">AI GENERATION</span><h2>生成内容 · 7 天窗口</h2><p>四参考系加权：<b>你的指定 0.45</b> &gt; 运营计划表 0.25 &gt; 历史好文 0.20 &gt; 行业热榜 0.10</p></div>
        <div style="display:flex;gap:10px;align-items:center">
          <span v-if="aiReady === false" style="font-size:12px;color:#b4544a">AI 未配置</span>
          <span v-else-if="aiReady" style="font-size:12px;color:#5a8a6a">AI 已就绪</span>
        </div>
      </div>
      <div class="panel" style="padding:16px 18px;margin-bottom:14px">
        <label style="display:flex;flex-direction:column;gap:7px;font-size:12px;color:#8b8175">这次想说什么方向？（权重最高，可留空=跟运营计划表走）
          <textarea v-model="strategyInput" rows="2" placeholder="例：这周主推新手化妆体验课，语气亲切像学姐；不要硬广" style="padding:10px 12px;border:1px solid #e3dcd2;border-radius:10px;font-size:13px;resize:vertical;font-family:inherit"></textarea>
        </label>
        <div style="display:flex;gap:14px;align-items:end;margin-top:14px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px">生成
            <input v-model.number="genDays" type="number" min="1" max="14" style="width:56px;padding:7px 8px;border:1px solid #e3dcd2;border-radius:8px;text-align:center" /> 天
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px">每天
            <input v-model.number="genPostsPerDay" type="number" min="1" max="9" style="width:56px;padding:7px 8px;border:1px solid #e3dcd2;border-radius:8px;text-align:center" /> 条
          </label>
          <span style="font-size:12px;color:#8b8175">共 {{ genDays * genPostsPerDay }} 条</span>
          <button class="outline-button" type="button" :disabled="genRunning || aiReady === false" @click="runGenerate">
            <Sparkles :size="15" />{{ genRunning ? '生成中…（约 10–60 秒）' : '开始生成' }}
          </button>
        </div>
      </div>
      <p v-if="genError" class="panel" style="padding:12px 16px;margin:0 0 12px">{{ genError }}</p>
      <div v-if="genResult" class="panel" style="padding:14px 18px;margin:0 0 16px">
        <b>本次主线：{{ genResult.theme }}</b>
        <p style="margin:6px 0 0;font-size:12px;color:#8b8175">已生成 {{ genResult.saved }} 条草稿（{{ genResult.elapsed }} 秒，{{ (genResult.usage||{}).total_tokens }} tokens），可在下方查看与编辑。</p>
      </div>

      <!-- ===== 行业热榜（定时抓取 + 手动触发）===== -->
      <div class="module-toolbar panel">
        <div><span class="section-label">TREND RADAR</span><h2>行业热榜 · 真实爆款</h2><p>每天 09:30 / 20:30 自动抓取（<b>{{ trendTotal }}</b> 条已入库{{ trendLast ? '，最近 ' + trendLast : '' }}），生成内容时作为热点参考。</p></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="font-size:12px;color:#8b8175">关键词：{{ trendKeywords.join(' / ') || '—' }}</span>
          <button class="outline-button" type="button" @click="scanAllDrafts"><RefreshCw :size="15" />全部草稿查重</button>
          <button class="outline-button" type="button" :disabled="trendScraping" @click="runScrapeNow"><RefreshCw :size="15" />{{ trendScraping ? '抓取中…（约 30 秒）' : '立即抓取' }}</button>
        </div>
      </div>
      <p v-if="trendError" class="panel" style="padding:12px 16px;margin:0 0 12px">{{ trendError }}</p>
      <p v-else-if="trendLoading" class="panel" style="padding:12px 16px;margin:0 0 12px">正在读取热榜…</p>
      <div v-if="trendItems.length" class="asset-grid" style="margin-bottom:18px">
        <a v-for="it in trendItems.slice(0, 8)" :key="'tr-' + it.id" class="asset-card panel" :href="it.url" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
          <span class="asset-art" style="background:#f4efe8;overflow:hidden;display:block">
            <img v-if="it.cover" :src="imgProxy(it.cover)" alt="" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer" />
          </span>
          <span class="asset-copy"><small>{{ it.author || '小红书' }} · 👍 {{ it.liked }} · {{ it.keyword }}</small><b>{{ it.title || '（无标题）' }}</b><em>点击看原帖</em></span>
        </a>
      </div>
      <p v-else-if="!trendLoading" class="panel" style="padding:14px 16px;margin:0 0 18px">热榜还是空的 —— 点右上角「立即抓取」，或等每天 09:30 / 20:30 自动抓取。</p>

      <div class="week-content-grid">
        <article v-for="(item, index) in weeklyContents" :key="item.day" class="content-draft panel">
          <div class="draft-cover" :class="`draft-tone-${index % 4}`">
            <span>{{ item.day }}</span>
            <svg viewBox="0 0 180 130" aria-hidden="true"><circle cx="104" cy="48" r="34" /><path d="M61 126c10-35 37-53 76-48 20 3 34 19 42 48M88 45c12-15 37-13 45 8M98 58c9 5 18 4 26-2" /></svg>
            <small>{{ item.stage }}</small>
          </div>
          <div class="draft-body">
            <span class="draft-state">{{ item.date }} · {{ item.state }}</span>
            <h3>{{ item.title }}</h3>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="pass-text" :style="item.similarity !== null && item.similarity >= 60 ? 'color:#b4544a' : ''">
                <LockKeyhole :size="13" /> {{ item.similarity === null ? '未查重' : '相似 ' + item.similarity + '%' }}
              </span>
              <button type="button" @click="openEditor(item)">编辑内容 <ChevronRight :size="14" /></button>
              <button type="button" v-if="item.id && item.rawStatus === 'draft'" @click="saveEditById(item.id, 'approved')" style="color:#5a8a6a">通过</button>
              <button type="button" v-if="item.id && item.rawStatus === 'draft'" @click="saveEditById(item.id, 'rejected')" style="color:#b4544a">退回</button>
            </div>
          </div>
        </article>
      </div>

      <!-- ===== 文案编辑器 ===== -->
      <div v-if="editorOpen" class="preview-layer" style="position:fixed;inset:0;background:rgba(40,34,28,.42);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px" @click.self="closeEditor">
        <div class="panel" style="width:min(720px,94vw);max-height:88vh;overflow:auto;padding:22px 24px;background:#fff;border-radius:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <div><span class="section-label">CONTENT EDITOR</span><b style="font-size:15px">编辑文案</b></div>
            <button type="button" @click="closeEditor" style="font-size:20px;line-height:1;padding:0 6px">×</button>
          </div>

          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175;margin-bottom:12px">标题
            <input v-model="editForm.title" style="padding:10px 12px;border:1px solid #e3dcd2;border-radius:10px;font-size:14px" />
          </label>

          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175;margin-bottom:12px">正文
            <textarea v-model="editForm.body" rows="10" style="padding:10px 12px;border:1px solid #e3dcd2;border-radius:10px;font-size:13px;line-height:1.7;resize:vertical;font-family:inherit"></textarea>
          </label>

          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175;margin-bottom:14px">话题标签（空格分隔）
            <input v-model="editForm.tagsText" placeholder="#新手化妆 #化妆教程" style="padding:10px 12px;border:1px solid #e3dcd2;border-radius:10px;font-size:13px" />
          </label>

          <p v-if="editError" style="margin:0 0 10px;color:#b4544a;font-size:13px">{{ editError }}</p>

          <div v-if="dupResult" class="panel" style="padding:12px 14px;margin-bottom:14px;background:#faf7f3;border-radius:10px">
            <b :style="dupResult.pass ? 'color:#5a8a6a' : 'color:#b4544a'">
              {{ dupResult.pass ? '✅ 查重通过' : '⚠️ 超过 60% 门禁' }} —— 最高相似度 {{ dupResult.score }}%
            </b>
            <p style="margin:6px 0 0;font-size:12px;color:#8b8175">
              标题 {{ dupResult.parts.title }}% · 结构 {{ dupResult.parts.structure }}% · 观点 {{ dupResult.parts.viewpoint }}% · 表达 {{ dupResult.parts.expression }}%
              <span v-if="dupResult.mostSimilar"> ｜ 最像《{{ dupResult.mostSimilar.title }}》</span>
            </p>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <button class="outline-button" type="button" @click="saveEdit()" :disabled="editSaving">{{ editSaving ? '保存中…' : '保存' }}</button>
            <button class="outline-button" type="button" @click="saveEdit('approved')" :disabled="editSaving" style="color:#5a8a6a">保存并通过</button>
            <button class="outline-button" type="button" @click="saveEdit('rejected')" :disabled="editSaving" style="color:#b4544a">退回</button>
            <button class="outline-button" type="button" @click="checkDupNow" :disabled="dupChecking">{{ dupChecking ? '查重中…' : '立即查重' }}</button>
            <small style="color:#8b8175">长度：标题 {{ editForm.title.length }} 字 · 正文 {{ editForm.body.length }} 字</small>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="props.activeView === 'schedule'">
      <div class="schedule-summary">
        <article class="queue-card panel">
          <span class="queue-icon"><CalendarCheck :size="21" /></span>
          <div><span class="section-label">发布队列</span><strong>{{ pubTasks.filter(t => t.status === 'pending').length }} 条待发布</strong>
          <small>已发布 {{ pubTasks.filter(t => t.status === 'done').length }} · 失败 {{ pubTasks.filter(t => t.status === 'failed').length }}</small></div>
        </article>
        <article class="auto-card panel">
          <div><span class="section-label">自动发布调度</span><strong>已开启</strong><small>每分钟扫描 · 到点前 15 分钟预检</small></div>
          <button type="button" class="switch-control active" aria-pressed="true"><i /></button>
        </article>
        <article class="safe-card panel"><ShieldCheck :size="22" /><div><strong>发布保护</strong><small>登录态 · 查重 · 配图 · 正文 · 发布间隔，五项全过才发送</small></div></article>
      </div>

      <!-- 建议发布时间 -->
      <div class="module-toolbar panel">
        <div><span class="section-label">BEST TIME</span><h2>建议发布时间：{{ bestTime ? bestTime.recommended : '读取中…' }}</h2>
        <p>{{ bestTime ? bestTime.note : '' }}</p></div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="outline-button" type="button" @click="useBestTime">采用建议</button>
          <button class="outline-button" type="button" @click="loadPublish(true)">刷新</button>
        </div>
      </div>
      <div v-if="bestTime && bestTime.reasons.length" class="panel" style="padding:14px 18px;margin-bottom:16px">
        <b style="font-size:13px">依据</b>
        <ul style="margin:8px 0 0;padding-left:20px;font-size:12px;color:#8b8175;line-height:1.9">
          <li v-for="(r, i) in bestTime.reasons" :key="'bt' + i">{{ r }}</li>
        </ul>
        <p style="margin:10px 0 0;font-size:12px;color:#8b8175">行业参考时段：
          <span v-for="s in bestTime.slots" :key="s.time" style="margin-right:12px">{{ s.label }} {{ s.time }}（{{ s.suitable }}）</span>
        </p>
      </div>

      <!-- 排期表单 -->
      <div class="panel" style="padding:16px 18px;margin-bottom:16px">
        <b style="font-size:13px">把内容加入发布队列</b>
        <div style="display:flex;gap:12px;align-items:end;margin-top:12px;flex-wrap:wrap">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175;flex:1;min-width:240px">选择内容
            <select v-model="scheduleForm.contentId" style="padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px;background:#fff">
              <option value="">— 请选择 —</option>
              <option v-for="c in weeklyContents" :key="'opt' + c.id" :value="c.id">D{{ c.day.replace('D','') }} {{ c.title }}（{{ c.state }}）</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175">发布时间
            <input v-model="scheduleForm.scheduledAt" type="datetime-local" style="padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px" />
          </label>
          <button class="outline-button" type="button" :disabled="scheduleSaving" @click="doSchedule">{{ scheduleSaving ? '加入中…' : '加入队列' }}</button>
        </div>
      </div>

      <p v-if="pubError" class="panel" style="padding:12px 16px;margin:0 0 12px">{{ pubError }}</p>

      <!-- 发布队列 -->
      <div class="calendar-board panel">
        <div class="panel-head"><div><span class="section-label">PUBLISH QUEUE</span><h3>发布队列</h3></div><span class="demo-badge">{{ pubTasks.length }} 个任务</span></div>
        <div v-if="!pubTasks.length && !pubLoading" style="padding:22px 6px;color:#8b8175;font-size:13px">队列是空的 —— 用上面的表单把内容加进来。</div>
        <div class="queue-list">
          <article v-for="item in pubTasks" :key="'pt' + item.id" class="queue-row" style="align-items:center">
            <div class="queue-date"><b>{{ (item.scheduled_at || '').slice(5, 10) }}</b><small>{{ (item.scheduled_at || '').slice(11, 16) }}</small></div>
            <div class="queue-copy"><b>{{ item.content_title || '(内容已删除)' }}</b><small>任务 #{{ item.id }}{{ item.retry ? ' · 重试 ' + item.retry : '' }}{{ item.note_id ? ' · 笔记 ' + item.note_id : '' }}</small></div>
            <span :class="['queue-state', { waiting: item.status === 'pending' }]">{{ PUB_STATE[item.status] || item.status }}</span>
            <div style="display:flex;gap:6px">
              <button type="button" v-if="item.status === 'pending' || item.status === 'failed'" @click="publishNow(item)" :disabled="pubRunning === item.id">{{ pubRunning === item.id ? '…' : '立即发布' }}</button>
              <button type="button" v-if="item.status === 'pending'" @click="cancelPubTask(item.id)">取消</button>
              <button type="button" @click="runPrecheck(item.content_id)">预检</button>
            </div>
          </article>
        </div>
        <div v-if="precheckResult" class="panel" style="padding:14px 16px;margin-top:14px;background:#faf7f3;border-radius:10px">
          <b :style="precheckResult.pass ? 'color:#5a8a6a' : 'color:#b4544a'">{{ precheckResult.pass ? '✅ 预检全部通过' : '⚠️ 预检未通过' }}</b>
          <ul style="margin:8px 0 0;padding-left:18px;font-size:12px;line-height:1.9">
            <li v-for="(it, i) in precheckResult.items" :key="'pc' + i" :style="it.ok ? 'color:#5a8a6a' : 'color:#b4544a'">{{ it.ok ? '✓' : '✗' }} {{ it.name }}：{{ it.detail }}</li>
          </ul>
        </div>
        <div v-if="precheckFor" style="margin-top:8px"><small style="color:#8b8175">最近预检内容 ID：{{ precheckFor }}</small></div>
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

      <!-- ===== AI 生图两档（R15）===== -->
      <article class="module-toolbar panel" style="margin-top:16px">
        <div><span class="section-label">AI IMAGE GEN</span><h2>AI 生图（两档）</h2>
        <p>提示词一律先经 DeepSeek 扩写再出图（避免直出原始提示词）；产物自动进素材库</p></div>
      </article>

      <div class="panel" style="padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
          <label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:#8b8175;flex:1;min-width:240px">需求（一句话即可）
            <input v-model="imgForm.prompt" placeholder="例：美容院海报配图，一位女性在护理" style="padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:#8b8175">档位
            <select v-model="imgForm.tier" style="padding:8px 10px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px;background:#fff">
              <option value="standard">标准档（2K，快）</option>
              <option value="fine">精细档（4K，细节好）</option>
            </select>
          </label>
          <label style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:#8b8175">比例
            <select v-model="imgForm.ratio" style="padding:8px 10px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px;background:#fff">
              <option v-for="r in ['1:1','2:3','3:4','4:3','3:2','9:16','16:9','4:5']" :key="'r'+r" :value="r">{{ r }}</option>
            </select>
          </label>
          <button class="outline-button" type="button" :disabled="imgExpanding" @click="expandImgPrompt">{{ imgExpanding ? '扩写中…' : '先扩写提示词' }}</button>
          <button class="outline-button" type="button" :disabled="imgBusy" @click="runImgGen">{{ imgBusy ? '出图中…（约1分钟）' : '生成图片' }}</button>
        </div>

        <div v-if="imgExpanded" style="margin-top:12px;padding:10px 12px;background:#faf7f3;border-radius:10px;font-size:12px;line-height:1.8">
          <b>扩写后提示词（实际发给模型的就是这段）：</b><br />{{ imgExpanded }}
        </div>
        <p v-if="imgError" style="margin:10px 0 0;color:#b4544a;font-size:13px">{{ imgError }}</p>
      </div>

      <div v-if="imgResult" class="panel" style="padding:16px 18px;margin-bottom:16px">
        <b style="font-size:13px">本次出图结果</b>
        <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
          <img :src="imgProxy(imgResult.url)" alt="" style="width:220px;border-radius:10px" />
          <div style="font-size:12px;line-height:1.9">
            档位：{{ imgResult.tierName }}（{{ imgResult.imageSize }}）｜比例 {{ imgResult.ratio }}<br />
            扩写耗时 {{ (imgResult.spentMsExpand/1000).toFixed(1) }}s ｜ 生图耗时 {{ (imgResult.callMs/1000).toFixed(1) }}s ｜ 合计 {{ (imgResult.spentMsTotal/1000).toFixed(1) }}s<br />
            已入素材库：#{{ imgResult.assetId }}<br />
            <span style="color:#8b8175">原始需求：{{ imgResult.promptRaw }}</span>
          </div>
        </div>
      </div>

      <div v-if="imgHistory.length > 1" class="panel" style="padding:14px 18px;margin-bottom:16px">
        <b style="font-size:12px">本次会话历史（{{ imgHistory.length }} 张）</b>
        <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
          <img v-for="(g,i) in imgHistory.slice(0,10)" :key="'gh'+i" :src="imgProxy(g.url)" style="width:88px;height:88px;object-fit:cover;border-radius:8px" />
        </div>
      </div>
    </template>

    <template v-else-if="props.activeView === 'analytics'">
      <p v-if="notesError" class="panel" style="padding:12px 16px;margin:0 0 12px">{{ notesError }}</p>
      <p v-else-if="notesLoading" class="panel" style="padding:12px 16px;margin:0 0 12px">正在读取你的小红书笔记数据（首次约 5–10 秒）…</p>
      <div class="analytics-kpis">
        <article v-for="item in (platformKpis.length ? platformKpis : analyticsKpis)" :key="item.label" class="analytics-kpi panel"><small>{{ item.label }}</small><strong>{{ item.value }}</strong><span><TrendingUp :size="13" />{{ item.delta }}</span></article>
      </div>
      <div class="analytics-main">
        <article class="insight-chart panel">
          <div class="panel-head"><div><span class="section-label">CONTENT PERFORMANCE</span><h3>内容增长趋势 · 浏览量</h3></div><div style="display:flex;gap:8px;align-items:center"><button v-for="w in ['seven', 'thirty']" :key="w" type="button" :class="['filter-chip', { active: creatorWindow === w }]" @click="creatorWindow = w">{{ w === 'seven' ? '近 7 天' : '近 30 天' }}</button><button class="outline-button" type="button" :disabled="collecting" @click="collectToday"><RefreshCw :size="15" />{{ collecting ? '采集中…' : '采集今日数据' }}</button></div></div>
          <p v-if="creatorError" style="margin:0 0 8px;color:#b4544a">{{ creatorError }}</p>
          <p v-else-if="creatorData" style="margin:0 0 8px;color:#8b8175;font-size:12px">数据来源：小红书创作者中心（平台官方数据）</p>
          <p v-else-if="creatorLoading" style="margin:0 0 8px;color:#8b8175;font-size:12px">正在读取平台数据…</p>
          <svg v-if="chartLine" viewBox="0 0 720 260" role="img" aria-label="浏览量趋势图">
            <g class="insight-grid"><path d="M45 36H690M45 92H690M45 148H690M45 204H690" /></g>
            <path class="insight-area" :d="chartArea" />
            <path class="insight-line" :d="chartLine" />
            <g class="insight-labels"><text v-for="(p, i) in (platformPoints.length >= 2 ? platformPoints : trendPoints)" :key="p.date" :x="chartLabelX(i, platformPoints.length >= 2 ? platformPoints : trendPoints)" y="244">{{ p.date }}</text></g>
          </svg>
          <div v-else style="padding:30px 18px;text-align:center;color:#8b8175">
            <b style="display:block;margin-bottom:6px">趋势数据积累中</b>
            <p style="margin:0">点右上角「采集今日数据」记录今天的互动快照；连续采集 2 天以上就会显示真实曲线。</p>
            <p style="margin:6px 0 0">当前已有快照：{{ metricsRows.length }} 条</p>
          </div>
        </article>
        <article class="topic-rank panel">
          <div class="panel-head"><div><span class="section-label">TOP TOPICS</span><h3>高潜内容方向</h3></div><BarChart3 :size="19" /></div>
          <div class="rank-list">
            <div v-for="(item, index) in topicRanks" :key="item.name"><span>{{ index + 1 }}</span><b>{{ item.name }}</b><i><em :style="{ width: `${item.value}%` }" /></i><small>{{ item.grow }}</small></div>
          </div>
        </article>
      </div>
      <!-- ===== 手工填报（R13）===== -->
      <article class="module-toolbar panel" style="margin-top:16px">
        <div><span class="section-label">MANUAL INPUT</span><h2>手工填报 · 咨询数 / 到店数</h2>
        <p>平台不提供这两项业务数据，需每日手工录入（同日重复录入会覆盖）</p></div>
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#8b8175">日期
            <input v-model="manualForm.date" type="date" style="padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px;font-size:13px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#8b8175">咨询数
            <input v-model="manualForm.inquiries" type="number" min="0" step="1" style="width:92px;padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px;font-size:13px" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#8b8175">到店数
            <input v-model="manualForm.visits" type="number" min="0" step="1" style="width:92px;padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px;font-size:13px" />
          </label>
          <button class="outline-button" type="button" :disabled="manualSaving" @click="saveManual">{{ manualSaving ? '保存中…' : '保存' }}</button>
        </div>
      </article>

      <p v-if="manualError" class="panel" style="padding:12px 16px">{{ manualError }}</p>

      <div class="panel" style="padding:14px 18px;margin-bottom:16px;font-size:13px">
        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:10px">
          <div><span class="section-label">近 30 天合计</span><b style="font-size:18px">{{ manualTotal.inquiries }}</b> 咨询</div>
          <div><span class="section-label">&nbsp;</span><b style="font-size:18px">{{ manualTotal.visits }}</b> 到店</div>
          <div style="align-self:flex-end;color:#8b8175">来源：<b>手工填报</b>（区别于平台数据）</div>
        </div>
        <div v-if="!manualRows.length" style="color:#8b8175">还没有填报记录 —— 用上面的表单录入今天的数据。</div>
        <table v-else style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="color:#8b8175;text-align:left">
            <th style="padding:6px 4px">日期</th><th style="padding:6px 4px">咨询数</th>
            <th style="padding:6px 4px">到店数</th><th style="padding:6px 4px">备注</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="m in manualRows" :key="'mm' + m.date" style="border-top:1px solid #f0ebe3">
              <td style="padding:6px 4px">{{ m.date }}</td>
              <td style="padding:6px 4px">{{ m.inquiries }}</td>
              <td style="padding:6px 4px">{{ m.visits }}</td>
              <td style="padding:6px 4px;color:#8b8175">{{ m.note || '—' }}</td>
              <td style="padding:6px 4px"><button type="button" style="color:#b4544a" @click="deleteManual(m.date)">删除</button></td>
            </tr>
          </tbody>
        </table>
      </div>

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
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 22px">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175">人设定位
            <input v-model="positioning.persona" placeholder="如：绮点化妆学校的课程顾问小绮" style="padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px" /></label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175">目标人群
            <input v-model="positioning.audience" placeholder="如：18–30 岁想学化妆的女生" style="padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px" /></label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175">语气风格
            <input v-model="positioning.tone" placeholder="如：专业但亲切，像学姐不像销售" style="padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px" /></label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175">核心卖点
            <input v-model="positioning.selling" placeholder="如：小班实操、老师一对一改妆" style="padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px" /></label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#8b8175">转化目标
            <input v-model="positioning.goal" placeholder="如：私信咨询 → 预约试听 → 报名" style="padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:13px" /></label>
        </div>
        <div style="margin-top:18px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <b style="font-size:13px">内容支柱占比</b>
            <span style="font-size:12px;color:#b4544a" v-if="pillarsDefault">（当前是默认模板，保存后成为你自己的计划）</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            <label v-for="(p, i) in pillars" :key="'pl' + i" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#faf7f3;border-radius:9px;font-size:12px">
              <span>{{ p.name }}</span>
              <input v-model.number="pillars[i].ratio" type="number" min="0" max="100" style="width:48px;padding:4px 6px;border:1px solid #e3dcd2;border-radius:6px;text-align:center;font-size:12px" />%
            </label>
          </div>
        </div>
        <p style="margin:14px 0 0;font-size:12px;color:#8b8175">每天发 {{ postsPerDay }} 条 → 7 天窗口共需产出 <b>{{ weekTotal }}</b> 篇；之后每天生成 1 次（补第 7 天那批）。</p>
      </div>

      <div class="outline-overview panel">
        <div><span class="section-label">WEEKLY STORY ARC</span><h2>本周主线：找到适合自己的风格</h2><p>让用户从“我不会”逐步走到“我愿意来做一次专业诊断”。</p></div>
        <div class="arc-progress"><span><b>3</b> / 7 天</span><i><em /></i><small>认知建立阶段进行中</small></div>
      </div>
      <div class="story-map">
        <button v-for="(item, index) in weeklyContents" :key="item.day" type="button" :class="['story-node', 'panel', { active: selectedOutlineDay === index, done: index < 2 }]" @click="selectedOutlineDay = index">
          <span class="story-index">{{ item.day }}</span><div><small>{{ item.stage }}</small><b>{{ item.title }}</b><em>{{ index < 2 ? '已完成并沉淀数据' : index === 2 ? '今天重点执行' : '承接前一日结论' }}</em></div><CircleCheck v-if="index < 2" :size="18" /><ChevronRight v-else :size="18" />
        </button>
      </div>
      <article class="continuity-card panel"><span class="continuity-icon"><BookOpenCheck :size="21" /></span><div><span class="section-label">连贯性检查</span><h3>D{{ selectedOutlineDay + 1 }} 如何承上启下</h3><p>{{ selectedOutlineDay === 0 ? '先说出新手真实痛点，为后续工具与方法建立学习动机。' : `承接 D${selectedOutlineDay} 的结论，加入新的证明或行动，并为 D${selectedOutlineDay + 2 > 7 ? 7 : selectedOutlineDay + 2} 留下明确的问题。` }}</p></div><span class="gate-pass"><Check :size="13" />逻辑通过</span></article>
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
        <aside class="gate-policy panel"><span class="policy-icon"><LockKeyhole :size="21" /></span><span class="section-label">原创度规则</span><h3>60% 硬门禁</h3><p>每次生成会比较标题、正文结构、核心观点和表达方式。</p><div class="threshold"><span>当前最高 {{ maxSimilarity === null ? '—' : maxSimilarity + '%' }}</span><b>门禁 60%</b><i><em /></i></div><ul><li><Check :size="13" />达到 60% 自动退回</li><li><Check :size="13" />最多自动重写 3 次</li><li><Check :size="13" />通过后才允许排期</li></ul></aside>
      </div>
    </template>

    <template v-else-if="props.activeView === 'settings'">
      <div class="settings-banner panel"><span class="settings-icon"><ServerCog :size="23" /></span><div><span class="section-label">本机运行状态</span><h2>{{ bannerTitle }}</h2><p>{{ realStatus.error || (realStatus.checkedAt ? `检测时间 ${realStatus.checkedAt} · 数据来自本机服务，密钥只存本机` : '正在读取本机服务状态…') }}</p></div><span class="status-good"><Check :size="14" />{{ healthyCount }} / 4 正常</span></div>
      <div class="connection-grid">
        <article v-for="item in connectionList" :key="item.name" class="connection-card panel"><span :class="['connection-icon', item.icon]"><KeyRound v-if="item.icon === 'ai'" :size="19" /><Palette v-else-if="item.icon === 'img'" :size="19" /><Send v-else-if="item.icon === 'mcp'" :size="19" /><ShieldCheck v-else :size="19" /></span><div><small>{{ item.name }}</small><b>{{ item.detail }}</b></div><span class="connection-state"><i />{{ item.state }}</span></article>
      </div>
      <div class="settings-grid">
        <article class="setting-panel panel"><div class="panel-head"><div><span class="section-label">CONTENT SAFETY</span><h3>内容与发布保护</h3></div><ShieldCheck :size="19" /></div><div class="setting-rows"><div><span><b>发布前人工确认</b><small>每条内容必须点确认后才能进入队列</small></span><button type="button" aria-label="发布前人工确认" :aria-pressed="systemToggles.review" :class="['switch-control', { active: systemToggles.review }]" @click="toggleSetting('review')"><i /></button></div><div><span><b>相似度超限自动重写</b><small>达到 60% 时最多自动重写 3 次</small></span><button type="button" aria-label="相似度超限自动重写" :aria-pressed="systemToggles.rewrite" :class="['switch-control', { active: systemToggles.rewrite }]" @click="toggleSetting('rewrite')"><i /></button></div><div><span><b>允许无人值守发布</b><small>建议完成首篇引导后再开启</small></span><button type="button" aria-label="允许无人值守发布" :aria-pressed="systemToggles.publish" :class="['switch-control', { active: systemToggles.publish }]" @click="toggleSetting('publish')"><i /></button></div></div></article>
        <article class="setting-panel panel"><div class="panel-head"><div><span class="section-label">LOCAL DEPLOYMENT</span><h3>本地运行环境</h3></div><ServerCog :size="19" /></div><div class="environment-list"><span><Check :size="14" /><b>系统环境</b><small>macOS · 可运行</small></span><span><Check :size="14" /><b>服务组件</b><small>已安装</small></span><span><Check :size="14" /><b>数据目录</b><small>可读写</small></span><span><Check :size="14" /><b>定时任务</b><small>服务正常</small></span></div><button class="outline-button full" type="button" @click="recheckEnv"><RefreshCw :size="15" />重新检测环境</button></article>
      </div>

      <!-- ============ 评论自动回复（R14）============ -->
      <article class="module-toolbar panel" style="margin-top:16px">
        <div><span class="section-label">COMMENT AUTO-REPLY</span><h2>评论自动回复</h2>
        <p>后台每 5 分钟纯规则轮询；命中知识库才用 AI 生成回复，未命中进人工待办</p></div>
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
          <div><span class="section-label">已跳过</span><b style="font-size:17px">{{ commentStats.skipped || 0 }}</b></div>
          <div style="margin-left:auto;text-align:right">
            <span class="section-label">观察期</span>
            <b :style="commentStats.inObservation ? 'color:#b4544a' : 'color:#5a8a6a'">
              {{ commentStats.inObservation ? '进行中（至 ' + commentStats.observationUntil + '）' : '已结束' }}
            </b>
            <div style="color:#8b8175;font-size:12px">观察期内所有回复需人工复核后才发送</div>
          </div>
        </div>
      </div>

      <!-- 待办 -->
      <div class="panel" style="padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b style="font-size:13px">评论处理</b>
          <div style="display:flex;gap:6px">
            <button v-for="f in [['pending_review','待人工'],['auto','自动'],['manual','人工'],['skipped','已跳过'],['','全部']]" :key="'cf'+f[0]"
                    type="button" :style="commentFilter === f[0] ? 'color:#b4544a' : ''" @click="switchCommentFilter(f[0])">{{ f[1] }}</button>
          </div>
        </div>
        <div v-if="!commentList.length" style="color:#8b8175;font-size:13px">没有该状态的评论记录</div>
        <div v-for="c in commentList" :key="'cm' + c.id" style="border-top:1px solid #f0ebe3;padding:10px 0;font-size:13px">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:260px">
              <b>{{ c.user_name || '(匿名)' }}</b>
              <span style="color:#8b8175"> · {{ c.note_title || c.note_id }}</span>
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

      <div class="settings-grid" style="margin-bottom:16px">
        <!-- 人设卡 -->
        <article class="setting-panel panel">
          <div class="panel-head"><div><span class="section-label">PERSONA</span><h3>人设卡</h3></div></div>
          <div v-if="personaCard" style="display:flex;flex-direction:column;gap:8px;font-size:13px">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#8b8175">称呼
              <input v-model="personaCard.name" style="padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px" /></label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#8b8175">角色定位
              <input v-model="personaCard.role" style="padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px" /></label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#8b8175">语气
              <input v-model="personaCard.tone" style="padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px" /></label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#8b8175">禁忌（逗号分隔）
              <input :value="(personaCard.taboo || []).join('、')" @input="personaCard.taboo = $event.target.value.split(/[、,，]/).filter(Boolean)" style="padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px" /></label>
            <button class="outline-button" type="button" @click="savePersonaCard">保存人设卡</button>
          </div>
        </article>

        <!-- 禁用词 -->
        <article class="setting-panel panel">
          <div class="panel-head"><div><span class="section-label">FORBIDDEN</span><h3>禁用词表</h3></div></div>
          <p style="font-size:12px;color:#8b8175;margin:0 0 8px">AI 生成的回复命中任一禁用词 → 转人工，不自动发送</p>
          <textarea v-model="forbiddenText" rows="6" style="width:100%;padding:9px 11px;border:1px solid #e3dcd2;border-radius:9px;font-size:12px;line-height:1.7;font-family:inherit"></textarea>
          <button class="outline-button" type="button" style="margin-top:8px" @click="saveForbidden">保存禁用词</button>
        </article>
      </div>

      <!-- 知识库 -->
      <div class="panel" style="padding:16px 18px;margin-bottom:16px">
        <b style="font-size:13px">知识库（自动回复的唯一依据，未命中就不回）</b>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
          <input v-model="knowledgeForm.category" placeholder="分类" style="width:100px;padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px;font-size:12px" />
          <input v-model="knowledgeForm.question" placeholder="问题" style="flex:1;min-width:150px;padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px;font-size:12px" />
          <input v-model="knowledgeForm.answer" placeholder="答案" style="flex:1.4;min-width:180px;padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px;font-size:12px" />
          <input v-model="knowledgeForm.keywords" placeholder="关键词（空格分隔）" style="width:170px;padding:7px 10px;border:1px solid #e3dcd2;border-radius:8px;font-size:12px" />
          <button class="outline-button" type="button" @click="addKnowledgeItem">添加</button>
        </div>
        <div v-if="!knowledgeItems.length" style="color:#8b8175;font-size:13px">知识库是空的 —— 不添加就永远不会自动回复</div>
        <div v-for="k in knowledgeItems" :key="'kb' + k.id" style="border-top:1px solid #f0ebe3;padding:8px 0;font-size:12px">
          <b>{{ k.category }}</b> · {{ k.question }}
          <div style="color:#8b8175">{{ k.answer }}</div>
          <div style="color:#8b8175">关键词：{{ (() => { try { return JSON.parse(k.keywords || '[]').join('、') } catch { return k.keywords } })() }}</div>
        </div>
      </div>

      <!-- 人工介入名单 -->
      <div class="panel" style="padding:16px 18px;margin-bottom:16px">
        <b style="font-size:13px">人工介入名单（名单内用户不再自动回复）</b>
        <div v-if="!takeoverItems.length" style="color:#8b8175;font-size:12px;margin-top:8px">名单为空</div>
        <div v-for="t in takeoverItems" :key="'tk' + t.user_id" style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #f0ebe3;padding:7px 0;font-size:12px">
          <span><b>{{ t.nickname || t.user_id }}</b> · {{ t.reason }} · {{ (t.since || '').slice(0, 16) }}</span>
          <button type="button" @click="removeTakeoverItem(t.user_id)">恢复自动回复</button>
        </div>
      </div>
    </template>

    <Transition name="toast">
      <div v-if="notice" class="demo-toast" role="status"><Check :size="15" />{{ notice }}</div>
    </Transition>
  </section>
</template>
