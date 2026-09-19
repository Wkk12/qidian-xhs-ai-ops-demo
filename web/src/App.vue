<script setup>
/* finesse · register=product · shell=atelier-operations-console · motion=state-transition */
import { computed, onMounted, ref } from 'vue'
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
async function loadPlanAndPosts() {
  try {
    const pr = await api.plans()
    const plan = (pr.items || [])[0]
    if (plan && Array.isArray(plan.nodes) && plan.nodes.length) {
      outlineDays.value = plan.nodes.map((n, i) => ({
        day: n.day || ('D' + (i + 1)),
        title: n.title || n.承接 || '未命名',
        status: n.status || '待生成',
      }))
    }
  } catch (e) { /* 保持空 */ }
  try {
    const cr = await api.contents()
    const items = cr.items || []
    posts.value = items.slice(0, 4).map((it, i) => ({
      day: i === 0 ? '最近' : '',
      time: '',
      title: it.title || '(无标题)',
      tag: it.source === 'generated' ? 'AI 生成' : '历史笔记',
      tone: ['rose', 'wine', 'cream', 'silver'][i % 4],
      similarity: typeof it.dup_score === 'number' ? it.dup_score : 0,
    }))
  } catch (e) { /* 保持空 */ }
}

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
    trendError.value = e.message || '读取平台数据失败'
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


const metrics = computed(() => [
  {
    label: '粉丝', unit: '人', icon: TrendingUp,
    value: accountInfo.value.loading ? '…' : String(accountInfo.value.fans ?? '—'),
    delta: accountInfo.value.error
      ? '读取失败'
      : (accountInfo.value.nickname ? `账号 ${accountInfo.value.nickname}` : '真实数据'),
  },
  {
    label: '关注', unit: '人', icon: CalendarDays,
    value: accountInfo.value.loading ? '…' : String(accountInfo.value.follows ?? '—'),
    delta: '真实数据',
  },
  {
    label: '获赞与收藏', unit: '次', icon: LibraryBig,
    value: accountInfo.value.loading ? '…' : String(accountInfo.value.likes ?? '—'),
    delta: '真实数据',
  },
])

// 七天内容先共用一条叙事主线，再拆分为每天的内容任务。
const outlineDays = ref([])

// 内容排期预览数据。
const posts = ref([])

const previewOpen = ref(false)
const selectedDay = ref(2)
const activeView = ref('dashboard')
const currentView = computed(() => viewMeta[activeView.value])
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
          <div class="account-mini">
            <span class="avatar">{{ (accountInfo.nickname || '?').charAt(0).toUpperCase() }}</span>
            <span><b>{{ accountInfo.nickname || '未登录' }}</b><small>{{ accountInfo.nickname ? '授权正常' : (accountInfo.loading ? '检测中…' : '未登录') }}</small></span>
            <MoreHorizontal :size="18" />
          </div>
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
            <button class="primary-button glass-button" type="button" aria-label="生成 7 天内容" @click="previewOpen = true">
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
                <span class="section-label">本周内容主线 · 第 3 天</span>
                <h2>从“会化妆”到<br><em>会表达自己</em></h2>
                <p>前两天建立痛点和工具认知，今天进入核心手法；后续自然衔接穿搭、案例和课程转化。</p>
                <button type="button" class="text-action" @click="previewOpen = true">
                  <Play :size="15" fill="currentColor" />
                  查看内容方案
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
                  <b>找到适合自己的风格，而不是照搬模板</b>
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
                <button v-for="post in posts" :key="post.day" type="button" class="post-row" @click="previewOpen = true">
                  <span class="post-date"><b>{{ post.day }}</b><small>{{ post.time }}</small></span>
                  <span :class="['cover-art', `tone-${post.tone}`]">
                    <svg viewBox="0 0 60 60" aria-hidden="true">
                      <path d="M14 47c4-13 13-21 25-22 5 7 8 14 7 22M23 25c-2-9 2-15 10-15 7 0 11 6 9 15" />
                      <path d="M26 18c4 2 9 2 13 0" />
                    </svg>
                  </span>
                  <span class="post-copy"><b>{{ post.title }}</b><small># {{ post.tag }}</small></span>
                  <span class="post-state originality-pass"><LockKeyhole :size="14" /> 相似 {{ post.similarity }}%</span>
                  <ChevronRight class="post-arrow" :size="17" />
                </button>
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
                  {{ trendLoading ? '正在读取平台数据…' : (trendError ? '读取平台数据失败：' + trendError : `${trendWindowLabel}暂无浏览量数据 · 平台数据积累中`) }}
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
                <div><small>文案库原创守门</small><h3>全部低于 60% 门禁</h3></div>
                <span class="complete"><Check :size="13" /> 已通过</span>
              </div>
              <p>标题、正文结构、核心观点和表达方式都会与文案库全部历史文案逐一比对；达到 60% 时自动退回重写。</p>
              <div class="ai-steps">
                <span><Check :size="13" /> 读取文案库</span>
                <i />
                <span><Check :size="13" /> 语义查重</span>
                <i />
                <span><LockKeyhole :size="13" /> 低于 60%</span>
              </div>
              <button type="button" class="ai-action" @click="previewOpen = true">查看查重与大纲 <ArrowUpRight :size="15" /></button>
            </article>
          </div>
          <ModuleViews v-else :active-view="activeView" @open-preview="previewOpen = true" />
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
              <div><small>原创度门禁</small><b>最高相似度 42%</b></div>
              <span class="gate-pass"><Check :size="13" /> 通过</span>
            </div>
            <div class="gate-bar"><i /></div>
            <p>阈值为 60%。若标题、结构或核心表达达到阈值，系统会自动重写并再次检测。</p>
          </section>
          <section class="drawer-outline">
            <div class="drawer-title"><span>7 天内容大纲</span><small>3 / 7 推进中</small></div>
            <div class="outline-flow">
              <span
                v-for="(item, index) in outlineDays"
                :key="item.day"
                :class="{ done: index < 2, current: index === 2 }"
              >
                <i>{{ index + 1 }}</i><small>{{ item.title }}</small>
              </span>
            </div>
          </section>
          <div class="phone-preview">
            <div class="phone-cover">
              <svg viewBox="0 0 240 230" aria-hidden="true">
                <circle cx="132" cy="92" r="66" />
                <path d="M89 86c19-37 83-45 99 5 11 36-11 87-49 104-30-14-51-62-50-109Z" />
                <path d="M115 92c12-6 26-5 38 2M123 112c8 5 17 5 25-1M137 126c0 8 3 14 8 17" />
              </svg>
              <span>新手化妆<br><b>第一支刷子怎么选？</b></span>
            </div>
            <div class="phone-copy">
              <b>别急着买一整套，零基础先认准这 3 支。</b>
              <p>底妆刷、眼影铺色刷和晕染刷，已经足够完成一套干净的日常妆。</p>
              <small>#化妆培训 #新手化妆 #美妆干货</small>
            </div>
          </div>
          <div class="preview-meta">
            <span><Clock3 :size="15" /> 今天 19:30</span>
            <span><Image :size="15" /> 6 张配图</span>
          </div>
          <ElButton class="preview-cta" type="primary" round @click="previewOpen = false">确认大纲与原创度</ElButton>
        </aside>
      </div>
    </Transition>

    <div class="theme-caption" aria-live="polite">
      <span><LockKeyhole :size="14" /></span>
      <div><b>原创度门禁已开启</b><small>相似度必须低于 60%</small></div>
    </div>
  </main>
</template>
