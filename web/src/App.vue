<script setup>
/* finesse · register=product · shell=atelier-operations-console · motion=state-transition */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElButton } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import ModuleViews from './components/ModuleViews.vue'
import { api } from './api.js'
import {
  ArrowUpRight,
  Bell,
  BookOpenText,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  Image,
  LayoutDashboard,
  LibraryBig,
  LockKeyhole,
  MoreHorizontal,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  TrendingUp,
  WandSparkles,
} from '@lucide/vue'

// 主导航驱动各业务演示页切换。
const navItems = [
  { id: 'dashboard', label: '今日运营', icon: LayoutDashboard },
  { id: 'studio', label: '内容工坊', icon: WandSparkles },
  { id: 'schedule', label: '排期发布', icon: CalendarDays },
  { id: 'assets', label: '素材灵感', icon: Image },
  { id: 'analytics', label: '数据洞察', icon: ChartNoAxesCombined },
  { id: 'outline', label: '运营大纲', icon: BookOpenText },
  { id: 'library', label: '文案库', icon: LibraryBig },
]

// 每个页面使用独立标题，让切换后的工作目标保持清晰。
const todayLabel = (() => { const d = new Date(); const w = ['日','一','二','三','四','五','六'][d.getDay()]; return `${d.getMonth() + 1}月${d.getDate()}日 · 星期${w}` })()

const viewMeta = {
  dashboard: { kicker: todayLabel, title: '把今天的灵感，变成明天的增长。' },
  studio: { kicker: 'CONTENT WORKSHOP', title: '先定一周主线，再批量生成每一天。' },
  schedule: { kicker: 'AUTO PUBLISHING', title: '所有内容，按最佳时间有序发布。' },
  assets: { kicker: 'CREATIVE LIBRARY', title: '把妆容、穿搭和课堂灵感收进素材库。' },
  analytics: { kicker: 'GROWTH INSIGHT', title: '看懂内容表现，再决定下一步怎么改。' },
  outline: { kicker: 'CONTENT STRATEGY', title: '七天连成一条线，逐步走向信任与转化。' },
  library: { kicker: 'ORIGINALITY LIBRARY', title: '每篇都留档，每次生成都先查重。' },
  settings: { kicker: 'LOCAL CONTROL', title: '账号、模型和发布能力，一页检查清楚。' },
}

// 首页指标：显示真实账号数据（来自本机服务 /api/mcp/me），不再是演示数字。
const accountInfo = ref({ loading: true })
async function loadAccount() {
  try {
    accountInfo.value = { loading: false, ...(await api.me()) }
  } catch (e) {
    accountInfo.value = { loading: false, error: e.message || '读取账号数据失败' }
  }
}
onMounted(loadAccount)

/* -------- 周计划 / 今日发布：真实数据 -------- */
const weeklyPlan = ref(null)      // 最新一条运营计划 { theme, nodes:[...], status }
const maxDupScore = ref(0)        // 文案库最高相似度（0~1 分数，0.42 = 42%）
const maxDupPost = ref(null)      // 相似度最高的那条内容（抽屉默认预览对象）
const bestTime = ref(null)        // 建议发布时间 { recommended, confidence, note }

// 后端 /api/plans 返回的 nodes 是 JSON 字符串，需解析成数组
function parsePlanNodes(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
// contents.images / contents.tags 都是 JSON 字符串
function parseImages(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
function parseTags(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
// 把 /api/contents 的一条原始记录映射成视图对象（排期行 / 抽屉预览共用同一映射，避免两处口径不一致）
function toPostView(it, i) {
  return {
    id: it.id,
    day: i === 0 ? '最近' : '',
    time: '',
    title: it.title || '(无标题)',
    body: it.body || '',
    tag: it.source === 'generated' ? 'AI 生成' : '历史笔记',
    tags: parseTags(it.tags),
    tone: ['rose', 'wine', 'cream', 'silver'][i % 4],
    images: parseImages(it.images),
    similarity: typeof it.dup_score === 'number' ? it.dup_score : null,
  }
}

async function loadPlanAndPosts() {
  try {
    const pr = await api.plans()
    const raw = (pr.items || [])[0]
    if (raw) {
      const nodes = parsePlanNodes(raw.nodes)
      weeklyPlan.value = { theme: raw.theme || '', status: raw.status || '', nodes }
      outlineDays.value = nodes.map((n, i) => ({
        day: n.day || ('D' + (i + 1)),
        title: n.title || n.承接 || '未命名',
        status: n.status || '待生成',
      }))
    } else {
      weeklyPlan.value = null
      outlineDays.value = []
    }
  } catch (e) { weeklyPlan.value = null; outlineDays.value = [] }
  try {
    const cr = await api.contents()
    const items = cr.items || []
    const scored = items.filter((it) => typeof it.dup_score === 'number')
    maxDupScore.value = scored.length ? Math.max(...scored.map((it) => it.dup_score)) : 0
    posts.value = items.slice(0, 4).map(toPostView)
    // 抽屉默认预览「相似度最高」的那条（查重的实际对象），而不是随便拿第一条
    maxDupPost.value = scored.length
      ? toPostView(scored.reduce((a, b) => (b.dup_score > a.dup_score ? b : a)), 0)
      : null
  } catch (e) { maxDupScore.value = 0; maxDupPost.value = null; posts.value = [] }
  try {
    bestTime.value = await api.bestTime()
  } catch (e) { bestTime.value = null }
}

/* -------- 互动运营（R18）：我们回复了谁 / 用户留言了什么（契约1 GET /api/interaction/feed） -------- */
const feedReplies = ref([])   // 已回复记录：{ user, comment, reply, mode, at, note }
const feedIncoming = ref([])  // 用户留言：{ user, text, at, note }
const feedLoading = ref(true)
const feedError = ref('')
async function loadInteractionFeed() {
  feedLoading.value = true
  try {
    const r = await api.interactionFeed(40)
    feedReplies.value = Array.isArray(r.replies) ? r.replies : []
    feedIncoming.value = Array.isArray(r.incoming) ? r.incoming : []
    feedError.value = ''
  } catch (e) {
    // 契约1 未就绪（404）先静默走空态：不假装有数据，也不弹假错误
    feedError.value = e.status === 404 ? '' : (e.message || '读取互动记录失败')
    feedReplies.value = []
    feedIncoming.value = []
  } finally {
    feedLoading.value = false
  }
}
// 互动时间显示：ISO → MM-DD HH:mm（解析不了就截前 16 字符，不编造）
function formatFeedTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
onMounted(loadInteractionFeed)

onMounted(loadPlanAndPosts)

/* -------- 内容热度趋势：真数据（小红书创作者中心 · 自己内容的每日浏览量） -------- */
// 来源：GET /api/creator/overview → thirty.series.view_count（平台官方每日浏览量）
const trendSeries = ref([])
const trendLoading = ref(true)
const trendError = ref('')
async function loadTrendSeries() {
  try {
    const r = await api.creatorOverview()
    const win = (r && (r.thirty || r.seven)) || null
    const s = (win && win.series && win.series.view_count) || []
    trendSeries.value = s.map((p) => ({
      date: String(p.date).slice(5).replace('-', '/'),
      value: Number(p.count) || 0,
    }))
    trendError.value = ''
  } catch (e) {
    const msg = String(e.message || '')
    trendError.value = /401|未登录|失效/.test(msg)
      ? '登录态已失效 · 点左下角扫码登录后即可恢复'
      : '读取平台数据失败：' + (msg || '未知错误')
    trendSeries.value = []
  } finally {
    trendLoading.value = false
  }
}
onMounted(loadTrendSeries)

// 图表坐标：沿用样稿 viewBox「0 0 520 210」的网格（x 34→500，基线 y=176，顶部 y=35）
const DASH_CHART = { x0: 34, y0: 176, w: 466, h: 141 }

// 有真数据才画线（全是 0 视为「平台数据还没积累」，走空态，不画假的平线）
const trendHasData = computed(
  () => trendSeries.value.length >= 2 && trendSeries.value.some((p) => p.value > 0),
)

const trendLine = computed(() => {
  if (!trendHasData.value) return ''
  const pts = trendSeries.value
  const max = Math.max(...pts.map((p) => p.value), 1)
  const step = DASH_CHART.w / (pts.length - 1)
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(DASH_CHART.x0 + i * step).toFixed(1)} ${(DASH_CHART.y0 - (p.value / max) * DASH_CHART.h).toFixed(1)}`)
    .join(' ')
})

const trendArea = computed(() => {
  if (!trendLine.value) return ''
  return `${trendLine.value} L${DASH_CHART.x0 + DASH_CHART.w} ${DASH_CHART.y0} L${DASH_CHART.x0} ${DASH_CHART.y0} Z`
})

// 轴刻度：最多 6 个，按真实采样点取（30 天窗口不挤）
const trendTicks = computed(() => {
  const pts = trendSeries.value
  if (pts.length < 2) return []
  const n = Math.min(6, pts.length)
  const step = DASH_CHART.w / (pts.length - 1)
  return Array.from({ length: n }, (_, k) => {
    const i = Math.round((k * (pts.length - 1)) / (n - 1))
    return { key: pts[i].date + '-' + i, date: pts[i].date, x: (DASH_CHART.x0 + i * step).toFixed(1) }
  })
})

const trendTotal = computed(() => trendSeries.value.reduce((a, p) => a + p.value, 0))
const trendWindowLabel = computed(() => (trendSeries.value.length > 7 ? '近 30 天' : '近 7 天'))

/* -------- 小红书扫码登录（客户机没有 Hermes，登录入口必须长在页面里） -------- */
const loginOpen = ref(false)
const loginState = ref({ service: true, loggedIn: false, username: '' })
const qrImage = ref('')
const qrLoading = ref(false)
const qrError = ref('')
const pollFails = ref(0) // 登录轮询连续失败计数（用于指数退避，避免打磨 MCP）
const qrSecondsLeft = ref(0)
const justLoggedIn = ref(false)
let qrCountdown = null
let loginPoll = null

const qrStatusText = computed(() => {
  if (qrLoading.value) return '正在获取二维码…'
  if (qrError.value) return qrError.value
  if (qrSecondsLeft.value > 0) return '等待扫码…'
  return '二维码已过期，请点「换一张」'
})

// 登录态每次都问本机服务，不缓存（客户可能换账号，也可能刚过期）
async function refreshLoginStatus() {
  try {
    const s = await api.mcpStatus()
    loginState.value = { service: !!s.service, loggedIn: !!s.loggedIn, username: s.username || '' }
  } catch (e) {
    loginState.value = { service: false, loggedIn: false, username: '' }
  }
  return loginState.value
}

function startQrCountdown(seconds) {
  clearInterval(qrCountdown)
  qrSecondsLeft.value = Math.max(30, Math.round(Number(seconds) || 240)) // MCP 二维码默认 4 分钟有效
  qrCountdown = setInterval(() => {
    qrSecondsLeft.value = Math.max(0, qrSecondsLeft.value - 1)
    if (qrSecondsLeft.value === 0) clearInterval(qrCountdown)
  }, 1000)
}

async function fetchLoginQrcode() {
  qrLoading.value = true
  qrError.value = ''
  clearInterval(qrCountdown)
  try {
    const r = await api.mcpQrcode()
    const d = (r && r.data) || {}
    const img = String((d && d.img) || (typeof d === 'string' ? d : '') || '')
    if (!img.startsWith('data:image')) throw new Error('二维码返回异常')
    qrImage.value = img
    justLoggedIn.value = false
    // MCP 会回 timeout（毫秒），有就按它算倒计时，没有就按 4 分钟
    const ttl = Number(d && d.timeout)
    startQrCountdown(ttl > 1000 ? ttl / 1000 : (ttl > 0 ? ttl : 240))
  } catch (e) {
    qrImage.value = ''
    qrError.value = loginState.value.service
      ? '获取二维码失败：' + (e.message || '未知错误')
      : '本机服务未启动，无法获取二维码'
  } finally {
    qrLoading.value = false
  }
}

// 打开登录窗口：先问登录态 → 出二维码 → 每 3 秒轮询，扫码成功即刷新页面数据
async function openLogin() {
  loginOpen.value = true
  justLoggedIn.value = false
  qrLoading.value = true // 立刻进入「获取中」，避免先显示「二维码已过期」误导用户
  // 两个请求并行（都走 MCP，各自要几秒）
  await Promise.allSettled([refreshLoginStatus(), fetchLoginQrcode()])
  // 轮询登录态（2026-09-21 重写）：
  // 旧版固定 4 秒一次、不退避、切到后台还继续跑 —— 实测把 MCP 打磨到错误日志 33.8MB。
  // 现策略：① 页面不可见时不轮询（切回来立刻补一次）
  //        ② 服务异常时指数退避 4→8→16→32→60s
  //        ③ 连续失败 10 次即彻底停止，留「换一张」按钮让用户主动重试
  clearTimeout(loginPoll)
  pollFails.value = 0
  const poll = async () => {
    if (document.hidden) {
      loginPoll = setTimeout(poll, 3000)
      return
    }
    const s = await refreshLoginStatus()
    if (s.loggedIn) {
      clearInterval(qrCountdown)
      qrSecondsLeft.value = 0
      qrImage.value = ''
      justLoggedIn.value = true
      await Promise.allSettled([loadAccount(), loadPlanAndPosts(), loadTrendSeries(), loadInteractionFeed()])
      return
    }
    // 服务正常（只是没扫码）→ 保持 4 秒；服务异常 → 退避
    if (s.service) pollFails.value = 0
    else pollFails.value += 1

    if (pollFails.value >= 10) {
      qrError.value = '本机服务连接异常，已暂停自动刷新；修好后点上方「换一张」重新获取'
      return
    }
    const delay = s.service ? 4000 : Math.min(60000, 4000 * Math.pow(2, Math.min(pollFails.value, 4)))
    loginPoll = setTimeout(poll, delay)
  }
  loginPoll = setTimeout(poll, 4000)
}

// 页面从后台切回前台时，若登录弹窗还开着就立刻补问一次（不必等退避）
function onVisibilityChange() {
  if (!document.hidden && loginOpen.value && !loginState.value.loggedIn) {
    clearTimeout(loginPoll)
    loginPoll = setTimeout(() => { if (loginOpen.value) refreshLoginStatus() }, 300)
  }
}

function closeLogin() {
  loginOpen.value = false
  clearTimeout(loginPoll)
  clearInterval(qrCountdown)
}

onUnmounted(closeLogin)
onMounted(refreshLoginStatus) // 首帧就把左下角登录态显示成真值
onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange))


// 账号 ID 脱敏：客户页不露明文 ID（长度 ≤8 原样；否则 前4****后4）
function maskId(id) {
  const s = String(id == null ? '' : id).trim()
  if (s.length <= 8) return s
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}

// 指标卡右上角胶囊：只放接口能拿到的真实字段，不放「真实数据」这种自证文案
function metricHint(loading, error, text) {
  if (error) return '读取失败'
  if (loading) return '读取中…'
  return text || '—'
}

const metrics = computed(() => {
  const a = accountInfo.value
  return [
    {
      label: '粉丝', unit: '人', icon: TrendingUp,
      value: a.loading ? '…' : String(a.fans ?? '—'),
      delta: metricHint(a.loading, a.error, a.noteCount != null ? `${a.noteCount} 篇笔记` : ''),
    },
    {
      label: '关注', unit: '人', icon: CalendarDays,
      value: a.loading ? '…' : String(a.follows ?? '—'),
      delta: metricHint(a.loading, a.error, a.redId ? `红书号 ${maskId(a.redId)}` : ''),
    },
    {
      label: '获赞与收藏', unit: '次', icon: LibraryBig,
      value: a.loading ? '…' : String(a.likes ?? '—'),
      delta: metricHint(a.loading, a.error, '来源：创作者中心'),
    },
  ]
})

// 七天内容先共用一条叙事主线，再拆分为每天的内容任务。
const outlineDays = ref([])

// 内容排期预览数据。
const posts = ref([])

const previewOpen = ref(false)
const previewPost = ref(null) // 抽屉当前预览的内容对象（点击排期行/卡片时传入）
const selectedDay = ref(2)
const activeView = ref('dashboard')
const currentView = computed(() => viewMeta[activeView.value])

// 文案库真实最高相似度（量纲 0~1 → 百分比）；无数据时置 null 表示「未查重」
const dedupeMaxPct = computed(() =>
  maxDupScore.value > 0 ? Math.round(maxDupScore.value * 100) : null,
)
const dedupeAllPass = computed(() => maxDupScore.value < 0.6)
// 门禁进度条宽度：按真实最高相似度（去掉 CSS 里写死的 42%）
const dedupeBarWidth = computed(() => {
  const p = dedupeMaxPct.value
  if (p == null) return '0%'
  return `${Math.min(Math.max(p, 0), 100)}%`
})

// 本周计划主题/主线（来自 /api/plans 的 theme 字段）；空则 null
const planTheme = computed(() => (weeklyPlan.value && weeklyPlan.value.theme) || null)
const planReady = computed(() => !!weeklyPlan.value && weeklyPlan.value.nodes.length > 0)

// spotlight 大卡「第 3 天」标题：读大纲第 3 个节点（无则退回主题）
const spotlightTitle = computed(() => {
  const d = outlineDays.value[2]
  return (d && d.title && d.title !== '未命名') ? d.title : (planTheme.value || '')
})
const spotlightDesc = computed(() => {
  if (!planReady.value) return ''
  const d = outlineDays.value[2]
  return d ? `${d.title} · ${d.status}；整周主线：${planTheme.value || '未设定'}` : ''
})

// 内容状态 → 流程节点样式：只有 published 算已完成（approved 未真发布，不算完成），其余第一个未完成的算「当前」
const DONE_STATUS = ['published']
// 抽屉大纲：按真实 status 算进度与节点态，不再写死「3 / 7」和 index<2 的假进度
const outlineFlow = computed(() => {
  const items = outlineDays.value.map((d) => ({ ...d, done: DONE_STATUS.includes(d.status) }))
  const firstOpen = items.findIndex((d) => !d.done)
  return items.map((d, i) => ({ ...d, cls: d.done ? 'done' : (i === firstOpen ? 'current' : '') }))
})
// 无计划时返回 null，由模板走空态，不再兜底成「0 / 7」这种像有数据的假值
const outlineProgress = computed(() => {
  const list = outlineFlow.value
  if (!list.length) return null
  return `${list.filter((d) => d.done).length} / ${list.length}`
})

// 建议发布时间（best-time 接口返回 recommended + confidence；冷启动标「仅供参考」）
const bestTimeLabel = computed(() => {
  const b = bestTime.value
  if (!b || !b.recommended) return '待定'
  return b.confidence === 'own-data' ? `建议 ${b.recommended}` : `建议 ${b.recommended}（仅供参考）`
})

// 打开质量检查抽屉：按点击目标传对应内容，不再一套假数据打天下
function openPreview(post = null) {
  previewPost.value = post
  previewOpen.value = true
}

// 抽屉手机预览区取哪条内容：优先点中的那行，否则取排期列表第一条
const phonePreview = computed(() => previewPost.value || posts.value[0] || null)
const phoneCoverTitle = computed(() => (phonePreview.value ? phonePreview.value.title : ''))
const phoneCoverSub = computed(() => (phonePreview.value ? phonePreview.value.tag : ''))
const phoneBodyLead = computed(() => {
  if (!phonePreview.value || !phonePreview.value.body) return ''
  return phonePreview.value.body.split('\n').find((l) => l.trim()) || ''
})
// 正文去掉首行后的摘要（原来这里是写死的第二段文案）
const phoneBodyRest = computed(() => {
  if (!phonePreview.value || !phonePreview.value.body) return ''
  return phonePreview.value.body
    .split('\n').map((l) => l.trim()).filter(Boolean).slice(1).join(' ')
})
// 真实话题标签（contents.tags，JSON 字符串）
const phoneTagsText = computed(() => {
  const t = phonePreview.value ? phonePreview.value.tags : null
  return Array.isArray(t) && t.length ? t.join(' ') : ''
})
const phoneImageCount = computed(() => (phonePreview.value ? phonePreview.value.images.length : 0))
const phoneSimilarity = computed(() => {
  const s = phonePreview.value ? phonePreview.value.similarity : null
  return typeof s === 'number' ? Math.round(s * 100) : null
})
</script>

<template>
  <main class="demo-stage theme-atelier">
    <section class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">
            <svg viewBox="0 0 42 42" role="img" aria-label="绮点 AI 标志">
              <path d="M8 22C8 12 14 6 22 6c8 0 13 5 13 12 0 8-6 14-16 18 2-6 1-10-4-12-2-1-5-1-7-2Z" />
              <path d="M14 13c6 1 10 4 13 10" />
              <circle cx="29" cy="12" r="2" />
            </svg>
          </span>
          <span class="brand-name"><b>绮点</b><small>AI SOCIAL STUDIO</small></span>
        </div>

        <nav class="main-nav" aria-label="主导航">
          <button
            v-for="item in navItems"
            :key="item.label"
            type="button"
            :class="['nav-item', { active: activeView === item.id }]"
            @click="activeView = item.id"
          >
            <component :is="item.icon" :size="18" :stroke-width="1.8" />
            <span>{{ item.label }}</span>
            <span v-if="activeView === item.id" class="nav-live" />
          </button>
        </nav>

        <div class="sidebar-foot">
          <button type="button" :class="['nav-item', { active: activeView === 'settings' }]" @click="activeView = 'settings'">
            <Settings :size="18" :stroke-width="1.8" />
            <span>系统设置</span>
          </button>
          <button class="account-mini" type="button" aria-label="小红书扫码登录" title="点此扫码登录 / 换账号" @click="openLogin">
            <span class="avatar">{{ (loginState.username || accountInfo.nickname || '?').charAt(0).toUpperCase() }}</span>
            <span>
              <b>{{ loginState.username || accountInfo.nickname || '未登录' }}</b>
              <small>{{ (loginState.username || accountInfo.nickname) ? '授权正常 · 点此换号' : (accountInfo.loading ? '检测中…' : '未登录 · 点此扫码登录') }}</small>
            </span>
            <MoreHorizontal :size="18" />
          </button>
        </div>
      </aside>

      <div class="workspace">
        <header class="topbar">
          <div>
            <span class="today">{{ currentView.kicker }}</span>
            <h1>{{ currentView.title }}</h1>
          </div>
          <div class="top-actions">
            <button class="icon-button glass-button" type="button" aria-label="查看通知">
              <Bell :size="18" />
              <span class="alert-dot" />
            </button>
            <button class="primary-button glass-button" type="button" aria-label="生成 7 天内容" @click="openPreview(maxDupPost)">
              <Sparkles :size="17" />
              <span>生成 7 天内容</span>
              <ArrowUpRight :size="16" />
            </button>
          </div>
        </header>

        <nav class="mobile-module-nav" aria-label="移动端模块导航">
          <button
            v-for="item in [...navItems, { id: 'settings', label: '设置', icon: Settings }]"
            :key="item.id"
            type="button"
            :class="{ active: activeView === item.id }"
            @click="activeView = item.id"
          >
            <component :is="item.icon" :size="15" />
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <Transition name="view" mode="out-in">
          <div v-if="activeView === 'dashboard'" key="dashboard" class="dashboard-grid">
            <article class="spotlight panel">
              <div class="spotlight-copy">
                <span class="section-label">{{ planReady ? '本周内容主线 · 第 3 天' : '本周内容主线' }}</span>
                <h2 v-if="planReady">{{ spotlightTitle }}</h2>
                <h2 v-else>还没有运营计划</h2>
                <p v-if="planReady">{{ spotlightDesc }}</p>
                <p v-else>先去「运营大纲」定下这一周的内容主线，再回来批量生成每一天的文案。</p>
                <button type="button" class="text-action" @click="activeView = 'outline'">
                  <Play :size="15" fill="currentColor" />
                  {{ planReady ? '查看内容方案' : '去创建运营计划' }}
                </button>
              </div>

              <div class="beauty-visual" aria-label="美妆与穿搭趋势 SVG 视觉图">
                <svg class="face-art" viewBox="0 0 420 380" aria-hidden="true">
                  <defs>
                    <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stop-color="var(--visual-soft)" />
                      <stop offset="1" stop-color="var(--visual-deep)" />
                    </linearGradient>
                    <filter id="blur"><feGaussianBlur stdDeviation="22" /></filter>
                  </defs>
                  <circle class="visual-halo" cx="218" cy="176" r="130" />
                  <path class="visual-fill" d="M155 37c64-22 144 22 153 100 8 69-20 155-91 188-25 12-68 1-88-42-35-74-38-223 26-246Z" />
                  <path class="face-line" d="M184 76c-21 31-25 74-15 115 8 35 25 66 55 86M177 159c17-9 36-8 51 1M187 174c10 6 20 6 31-1M218 208c-3 17-1 28 9 34M202 259c23 9 45 6 64-8" />
                  <path class="fashion-line" d="M102 344c40-53 86-74 137-62 40 9 72 30 94 62" />
                  <circle class="makeup-swatch swatch-a" cx="98" cy="107" r="30" />
                  <circle class="makeup-swatch swatch-b" cx="338" cy="250" r="19" />
                  <path class="orbit-line" d="M70 274C47 153 125 49 232 28c71-14 131 11 170 63" />
                  <circle class="orbit-dot" cx="70" cy="274" r="5" />
                </svg>
                <div class="visual-caption">
                  <span>本周统一内容母题</span>
                  <b v-if="planTheme">{{ planTheme }}</b>
                  <b v-else>还没有设定 · 去运营大纲创建</b>
                </div>
              </div>
            </article>

            <section class="metric-zone" aria-label="运营指标">
              <article v-for="metric in metrics" :key="metric.label" class="metric-card panel">
                <div class="metric-head">
                  <span class="metric-icon"><component :is="metric.icon" :size="17" /></span>
                  <span class="delta">{{ metric.delta }}</span>
                </div>
                <small>{{ metric.label }}</small>
                <strong>{{ metric.value }}<i>{{ metric.unit }}</i></strong>
              </article>
            </section>

            <article class="schedule panel">
              <div class="panel-head">
                <div><span class="section-label">CONTENT CALENDAR</span><h3>本周内容排期</h3></div>
                <button type="button" class="round-link" aria-label="查看全部排期"><ChevronRight :size="18" /></button>
              </div>
              <div class="post-list">
                <button v-for="post in posts" :key="post.id" type="button" class="post-row" @click="openPreview(post)">
                  <span class="post-date"><b>{{ post.day }}</b><small>{{ post.time }}</small></span>
                  <span :class="['cover-art', `tone-${post.tone}`]">
                    <svg viewBox="0 0 60 60" aria-hidden="true">
                      <path d="M14 47c4-13 13-21 25-22 5 7 8 14 7 22M23 25c-2-9 2-15 10-15 7 0 11 6 9 15" />
                      <path d="M26 18c4 2 9 2 13 0" />
                    </svg>
                  </span>
                  <span class="post-copy"><b>{{ post.title }}</b><small># {{ post.tag }}</small></span>
                  <span class="post-state originality-pass"><LockKeyhole :size="14" /> <template v-if="post.similarity != null">相似 {{ Math.round(post.similarity * 100) }}%</template><template v-else>未查重</template></span>
                  <ChevronRight class="post-arrow" :size="17" />
                </button>
              </div>
            </article>

            <article class="feed panel">
              <div class="panel-head">
                <div><span class="section-label">INTERACTION</span><h3>互动运营</h3></div>
                <span v-if="feedReplies.length || feedIncoming.length" class="feed-count">
                  已回复 {{ feedReplies.length }} · 留言 {{ feedIncoming.length }}
                </span>
              </div>
              <div class="feed-grid">
                <section class="feed-col">
                  <h4>我们回复了谁</h4>
                  <p v-if="feedLoading" class="feed-empty">正在读取互动记录…</p>
                  <p v-else-if="feedError" class="feed-empty">{{ feedError }}</p>
                  <p v-else-if="!feedReplies.length" class="feed-empty">还没有互动 · 有回复记录后在这里显示</p>
                  <ul v-else class="feed-list">
                    <li v-for="(r, i) in feedReplies" :key="'r' + (r.id != null ? r.id : i)">
                      <div class="feed-line">
                        <b>{{ r.user || '匿名用户' }}</b>
                        <span class="feed-tag">{{ r.mode === 'auto' ? '自动回复' : '人工回复' }}</span>
                        <time>{{ formatFeedTime(r.at) }}</time>
                      </div>
                      <p class="feed-quote">{{ r.comment }}</p>
                      <p v-if="r.reply" class="feed-reply">我们：{{ r.reply }}</p>
                      <small v-if="r.note">来自笔记《{{ r.note }}》</small>
                    </li>
                  </ul>
                </section>
                <section class="feed-col">
                  <h4>用户留言</h4>
                  <p v-if="feedLoading" class="feed-empty">正在读取留言…</p>
                  <p v-else-if="feedError" class="feed-empty">{{ feedError }}</p>
                  <p v-else-if="!feedIncoming.length" class="feed-empty">还没有互动 · 有新留言后在这里显示</p>
                  <ul v-else class="feed-list">
                    <li v-for="(m, i) in feedIncoming" :key="'m' + i">
                      <div class="feed-line">
                        <b>{{ m.user || '匿名用户' }}</b>
                        <time>{{ formatFeedTime(m.at) }}</time>
                      </div>
                      <p class="feed-quote">{{ m.text }}</p>
                      <small v-if="m.note">来自笔记《{{ m.note }}》</small>
                    </li>
                  </ul>
                </section>
              </div>
            </article>

            <article class="trend-card panel">
              <div class="panel-head">
                <div><span class="section-label">TREND PULSE</span><h3>内容热度趋势</h3></div>
                <span class="live-pill"><span /> 平台数据</span>
              </div>
              <div class="chart-wrap">
                <svg v-if="trendLine" viewBox="0 0 520 210" role="img" :aria-label="`每日浏览量趋势图 · ${trendWindowLabel}`">
                  <g class="chart-grid">
                    <path d="M34 35H500M34 82H500M34 129H500M34 176H500" />
                  </g>
                  <path class="chart-area" :d="trendArea" />
                  <path class="chart-line" pathLength="1" :d="trendLine" />
                  <g class="chart-labels">
                    <text v-for="t in trendTicks" :key="t.key" :x="t.x" y="202">{{ t.date }}</text>
                  </g>
                </svg>
                <p v-else class="chart-empty">
                  {{ trendLoading ? '正在读取平台数据…' : (trendError || `${trendWindowLabel}暂无浏览量数据 · 平台数据积累中`) }}
                </p>
              </div>
              <div class="trend-note">
                <TrendingUp :size="16" />
                <span>{{ trendHasData ? `数据来源：小红书创作者中心 · ${trendWindowLabel}每日浏览量（合计 ${trendTotal}）` : '数据来源：小红书创作者中心（平台官方数据）' }}</span>
                <b>{{ accountInfo.loading ? '…' : (accountInfo.fans ?? '—') }} 粉丝</b>
              </div>
            </article>

            <article class="ai-card panel">
              <div class="ai-head">
                <span class="ai-orb"><Sparkles :size="20" /></span>
                <div>
                  <small>文案库原创守门</small>
                  <h3 v-if="dedupeMaxPct != null">{{ dedupeAllPass ? '全部低于 60% 门禁' : '存在超过 60% 门禁的文案' }}</h3>
                  <h3 v-else>还没有可查重的文案</h3>
                </div>
                <span v-if="dedupeMaxPct == null" class="gate-warn"><LockKeyhole :size="13" /> 待查重</span>
                <span v-else-if="dedupeAllPass" class="complete"><Check :size="13" /> 已通过</span>
                <span v-else class="gate-warn"><LockKeyhole :size="13" /> 需处理</span>
              </div>
              <p>标题、正文结构、核心观点和表达方式都会与文案库全部历史文案逐一比对；达到 60% 时自动退回重写。</p>
              <div class="ai-steps">
                <span><Check :size="13" /> 读取文案库</span>
                <i />
                <span><Check :size="13" /> 语义查重</span>
                <i />
                <span><LockKeyhole :size="13" /> 当前最高 {{ dedupeMaxPct == null ? '—' : dedupeMaxPct + '%' }}</span>
              </div>
              <button type="button" class="ai-action" @click="openPreview(maxDupPost)">查看查重与大纲 <ArrowUpRight :size="15" /></button>
            </article>
          </div>
          <ModuleViews v-else :active-view="activeView" @open-preview="openPreview()" />
        </Transition>
      </div>
    </section>

    <Transition name="drawer">
      <div v-if="previewOpen" class="preview-layer" @click.self="previewOpen = false">
        <aside class="preview-card" aria-label="生成前质量检查">
          <header>
            <span><Eye :size="17" /> 生成前质量检查</span>
            <button type="button" aria-label="关闭预览" @click="previewOpen = false">×</button>
          </header>
          <section class="quality-gate">
            <div class="gate-head">
              <span class="gate-icon"><LockKeyhole :size="18" /></span>
              <div>
                <small>原创度门禁</small>
                <b>{{ dedupeMaxPct == null ? '还没有可查重的文案' : `最高相似度 ${dedupeMaxPct}%` }}</b>
              </div>
              <span v-if="dedupeMaxPct == null" class="gate-warn"><LockKeyhole :size="13" /> 待查重</span>
              <span v-else-if="dedupeAllPass" class="gate-pass"><Check :size="13" /> 通过</span>
              <span v-else class="gate-warn"><LockKeyhole :size="13" /> 超阈值</span>
            </div>
            <div class="gate-bar"><i :style="{ width: dedupeBarWidth }" /></div>
            <p>阈值为 60%。若标题、结构或核心表达达到阈值，系统会自动重写并再次检测。</p>
          </section>
          <section class="drawer-outline">
            <div class="drawer-title">
              <span>{{ outlineFlow.length ? `${outlineFlow.length} 天内容大纲` : '内容大纲' }}</span>
              <small v-if="outlineProgress">{{ outlineProgress }} 推进中</small>
              <small v-else>还没有大纲</small>
            </div>
            <div v-if="outlineFlow.length" class="outline-flow">
              <span
                v-for="(item, index) in outlineFlow"
                :key="item.day + '-' + index"
                :class="item.cls"
              >
                <i>{{ index + 1 }}</i><small>{{ item.title }}</small>
              </span>
            </div>
            <p v-else>还没有内容大纲。去「运营大纲」创建本周计划后，这里会显示每天的主题与推进状态。</p>
          </section>
          <div class="phone-preview">
            <div class="phone-cover">
              <svg viewBox="0 0 240 230" aria-hidden="true">
                <circle cx="132" cy="92" r="66" />
                <path d="M89 86c19-37 83-45 99 5 11 36-11 87-49 104-30-14-51-62-50-109Z" />
                <path d="M115 92c12-6 26-5 38 2M123 112c8 5 17 5 25-1M137 126c0 8 3 14 8 17" />
              </svg>
              <span v-if="phonePreview">{{ phoneCoverSub }}<br><b>{{ phoneCoverTitle }}</b></span>
              <span v-else>暂无可预览内容</span>
            </div>
            <div class="phone-copy">
              <b>{{ phoneBodyLead || '该条内容暂无正文' }}</b>
              <p v-if="phoneBodyRest">{{ phoneBodyRest }}</p>
              <small v-if="phoneTagsText">{{ phoneTagsText }}</small>
              <small v-else>{{ phonePreview ? `# ${phonePreview.tag}` : '' }}</small>
            </div>
          </div>
          <div class="preview-meta">
            <span><Clock3 :size="15" /> {{ bestTimeLabel }}</span>
            <span v-if="phonePreview"><Image :size="15" /> {{ phoneImageCount }} 张配图</span>
            <span v-else><Image :size="15" /> 暂无配图数据</span>
          </div>
          <ElButton class="preview-cta" type="primary" round @click="previewOpen = false">确认大纲与原创度</ElButton>
        </aside>
      </div>
    </Transition>

    <!-- ============ 小红书扫码登录（客户端无 Hermes，必须自带登录入口）============ -->
    <Transition name="drawer">
      <div v-if="loginOpen" class="preview-layer" @click.self="closeLogin">
        <aside class="preview-card" aria-label="小红书扫码登录">
          <header>
            <span><LockKeyhole :size="17" /> 小红书扫码登录</span>
            <button type="button" aria-label="关闭登录窗口" @click="closeLogin">×</button>
          </header>

          <section class="quality-gate">
            <div class="gate-head">
              <span class="gate-icon"><Check :size="18" /></span>
              <div>
                <small>当前登录账号</small>
                <b>{{ loginState.loggedIn ? (loginState.username || '已登录') : (loginState.service ? '未登录' : '本机服务未启动') }}</b>
              </div>
              <span v-if="loginState.loggedIn" class="gate-pass"><Check :size="13" /> 授权正常</span>
              <span v-else class="gate-warn"><LockKeyhole :size="13" /> 待登录</span>
            </div>
            <p v-if="justLoggedIn" class="login-ok">登录成功，账号与数据已刷新。</p>
            <p v-else>登录态保存在本机，不用每次打开都扫码；失效时回到这里再扫一次即可。扫码也可以直接换成另一个账号。</p>
          </section>

          <section class="login-qr-block">
            <div class="login-qr">
              <img v-if="qrImage" :src="qrImage" alt="小红书登录二维码" />
              <div v-else class="login-qr-empty">{{ qrStatusText }}</div>
            </div>
            <p class="login-qr-hint"><Clock3 :size="13" /> {{ qrSecondsLeft > 0 ? `二维码 ${qrSecondsLeft} 秒后失效` : qrStatusText }}</p>
            <button class="primary-button glass-button login-qr-btn" type="button" :disabled="qrLoading" @click="fetchLoginQrcode">
              <RefreshCw :size="15" />{{ qrLoading ? '获取中…' : '换一张二维码' }}
            </button>
            <p class="login-qr-steps">打开【小红书 App】→ 左上角「扫一扫」→ 扫描后在手机上确认登录。</p>
          </section>
        </aside>
      </div>
    </Transition>

  </main>
</template>
