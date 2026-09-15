<script setup>
/* finesse · register=product · shell=multi-module-workbench · motion=feedback-only */
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElButton } from 'element-plus'
import 'element-plus/es/components/button/style/css'
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

// 七天内容卡片复用同一条认知到转化的故事线。
const weeklyContents = [
  { day: 'D1', date: '周一', stage: '痛点共鸣', title: '为什么跟着教程画，妆面还是显脏？', similarity: 31, state: '已发布' },
  { day: 'D2', date: '周二', stage: '工具入门', title: '零基础的第一套化妆刷，不要买多', similarity: 34, state: '已发布' },
  { day: 'D3', date: '今天', stage: '手法建立', title: '底妆服帖的关键，不是粉底有多贵', similarity: 42, state: '待确认' },
  { day: 'D4', date: '周四', stage: '穿搭延伸', title: '同一件西装，妆容决定你的气质', similarity: 38, state: '草稿' },
  { day: 'D5', date: '周五', stage: '案例证明', title: '学员 21 天改妆记录：从不敢拍照到主动出镜', similarity: 27, state: '草稿' },
  { day: 'D6', date: '周六', stage: '课程价值', title: '化妆课真正教你的，是一套判断方法', similarity: 36, state: '草稿' },
  { day: 'D7', date: '周日', stage: '行动转化', title: '想系统变美，从一次风格诊断开始', similarity: 29, state: '草稿' },
]

const scheduleItems = [
  { date: '09/16', week: '今天', time: '19:30', title: weeklyContents[2].title, type: '图文 · 6图', state: '等待确认' },
  { date: '09/17', week: '周四', time: '12:10', title: weeklyContents[3].title, type: '图文 · 7图', state: '已排期' },
  { date: '09/18', week: '周五', time: '20:00', title: weeklyContents[4].title, type: '图文 · 6图', state: '已排期' },
  { date: '09/19', week: '周六', time: '11:40', title: weeklyContents[5].title, type: '图文 · 5图', state: '已排期' },
]

const assets = [
  { id: 1, type: '妆容', title: '秋日奶咖眼妆', meta: '竖版 · 3:4', tone: 'rose' },
  { id: 2, type: '穿搭', title: '轻职场西装组合', meta: '竖版 · 3:4', tone: 'wine' },
  { id: 3, type: '课堂', title: '一对一实操课', meta: '横版 · 4:3', tone: 'cream' },
  { id: 4, type: '案例', title: '学员妆前妆后', meta: '竖版 · 3:4', tone: 'silver' },
  { id: 5, type: '妆容', title: '通勤清透底妆', meta: '竖版 · 3:4', tone: 'peach' },
  { id: 6, type: '穿搭', title: '约会氛围感配色', meta: '方图 · 1:1', tone: 'plum' },
]

const libraryRows = [
  { title: '零基础的第一套化妆刷，不要买多', topic: '工具入门', status: '已发布', similarity: 34, date: '09/15' },
  { title: '为什么跟着教程画，妆面还是显脏？', topic: '痛点共鸣', status: '已发布', similarity: 31, date: '09/14' },
  { title: '圆脸显瘦不是靠修容越重越好', topic: '脸型诊断', status: '历史内容', similarity: 39, date: '09/11' },
  { title: '面试妆容的重点，是让人记住你的精气神', topic: '职场妆容', status: '历史内容', similarity: 28, date: '09/08' },
  { title: '冷暖皮不是限制，是选色的起点', topic: '色彩搭配', status: '历史内容', similarity: 41, date: '09/05' },
]

const generating = ref(false)
const generationDone = ref(false)
const autoPublish = ref(true)
const assetFilter = ref('全部')
const selectedAssets = ref([1, 4])
const selectedOutlineDay = ref(2)
const libraryQuery = ref('')
const systemToggles = ref({ review: true, rewrite: true, publish: false })
const notice = ref('')
let generationTimer
let noticeTimer

const filteredAssets = computed(() => (
  assetFilter.value === '全部' ? assets : assets.filter((item) => item.type === assetFilter.value)
))

const filteredLibrary = computed(() => {
  const query = libraryQuery.value.trim().toLowerCase()
  if (!query) return libraryRows
  return libraryRows.filter((item) => `${item.title}${item.topic}${item.status}`.toLowerCase().includes(query))
})

// 模拟前端生成过程，展示最终产品需要承接的任务状态。
const startGeneration = () => {
  window.clearTimeout(generationTimer)
  generating.value = true
  generationDone.value = false
  generationTimer = window.setTimeout(() => {
    generating.value = false
    generationDone.value = true
  }, 1300)
}

// 素材卡支持多选，便于演示批量加入内容任务。
const toggleAsset = (id) => {
  selectedAssets.value = selectedAssets.value.includes(id)
    ? selectedAssets.value.filter((item) => item !== id)
    : [...selectedAssets.value, id]
}

// 模拟设置开关，不保存真实密钥或发布配置。
const toggleSetting = (key) => {
  systemToggles.value = { ...systemToggles.value, [key]: !systemToggles.value[key] }
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
        <ElButton class="module-primary" type="primary" round :loading="generating" @click="startGeneration">
          <Sparkles :size="16" />{{ generating ? '正在生成...' : '重新生成 7 天草稿' }}
        </ElButton>
      </div>

      <div v-if="generating || generationDone" :class="['generation-strip', { done: generationDone }]" aria-live="polite">
        <span class="generation-orb"><RefreshCw v-if="generating" :size="16" /><Check v-else :size="16" /></span>
        <div><b>{{ generating ? 'AI 正在沿大纲创作' : '7 天草稿已生成' }}</b><small>{{ generating ? '匹配热点 → 生成文案 → 文案库查重 → 安排配图' : '7 条内容全部低于 60% 相似度，可逐篇编辑。' }}</small></div>
      </div>

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
            <div><span class="pass-text"><LockKeyhole :size="13" /> 相似 {{ item.similarity }}%</span><button type="button" @click="emit('open-preview')">编辑内容 <ChevronRight :size="14" /></button></div>
          </div>
        </article>
      </div>
    </template>

    <template v-else-if="props.activeView === 'schedule'">
      <div class="schedule-summary">
        <article class="queue-card panel">
          <span class="queue-icon"><CalendarCheck :size="21" /></span>
          <div><span class="section-label">未来 7 天</span><strong>5 条已排期</strong><small>1 条待确认 · 1 条待生成</small></div>
        </article>
        <article class="auto-card panel">
          <div><span class="section-label">自动发布</span><strong>{{ autoPublish ? '已开启' : '已暂停' }}</strong><small>{{ autoPublish ? '到点前 15 分钟再次检查' : '内容不会自动发送' }}</small></div>
          <button type="button" :class="['switch-control', { active: autoPublish }]" :aria-pressed="autoPublish" @click="autoPublish = !autoPublish"><i /></button>
        </article>
        <article class="safe-card panel"><ShieldCheck :size="22" /><div><strong>发布保护</strong><small>原创度、图片数量、账号授权均通过才发送</small></div></article>
      </div>
      <div class="calendar-board panel">
        <div class="panel-head"><div><span class="section-label">PUBLISH QUEUE</span><h3>本周发布队列</h3></div><span class="demo-badge">演示排期</span></div>
        <div class="calendar-days">
          <span v-for="item in weeklyContents" :key="item.day" :class="{ current: item.date === '今天' }"><small>{{ item.date }}</small><b>{{ item.day.replace('D', '') }}</b><i v-if="item.state !== '草稿'" /></span>
        </div>
        <div class="queue-list">
          <article v-for="item in scheduleItems" :key="item.date" class="queue-row">
            <div class="queue-date"><b>{{ item.date }}</b><small>{{ item.week }}</small></div>
            <span class="queue-time"><Clock3 :size="14" />{{ item.time }}</span>
            <div class="queue-copy"><b>{{ item.title }}</b><small>{{ item.type }}</small></div>
            <span :class="['queue-state', { waiting: item.state === '等待确认' }]">{{ item.state }}</span>
            <button type="button" aria-label="预览排期内容" @click="emit('open-preview')"><Eye :size="16" /></button>
          </article>
        </div>
      </div>
    </template>

    <template v-else-if="props.activeView === 'assets'">
      <div class="asset-toolbar panel">
        <div><span class="section-label">素材中心</span><h2>灵感与配图</h2><p>AI 生成图、机构实拍和历史素材统一管理。</p></div>
        <div class="filter-tabs">
          <button v-for="item in ['全部', '妆容', '穿搭', '课堂', '案例']" :key="item" type="button" :class="{ active: assetFilter === item }" @click="assetFilter = item">{{ item }}</button>
        </div>
        <button class="outline-button" type="button" @click="showNotice('演示：素材上传入口已响应')"><CloudUpload :size="16" />上传素材</button>
      </div>
      <div class="asset-layout">
        <div class="asset-grid">
          <button v-for="item in filteredAssets" :key="item.id" type="button" :class="['asset-card', 'panel', { selected: selectedAssets.includes(item.id) }]" @click="toggleAsset(item.id)">
            <span :class="['asset-art', `asset-${item.tone}`]">
              <svg viewBox="0 0 220 170" aria-hidden="true"><circle cx="130" cy="66" r="43" /><path d="M66 169c13-51 54-75 108-59 20 6 34 25 42 59M108 61c16-18 48-15 58 11M118 80c11 6 23 5 34-3" /></svg>
              <i v-if="selectedAssets.includes(item.id)"><Check :size="14" /></i>
            </span>
            <span class="asset-copy"><small>{{ item.type }}</small><b>{{ item.title }}</b><em>{{ item.meta }}</em></span>
          </button>
        </div>
        <aside class="selection-card panel">
          <span class="selection-icon"><Layers3 :size="20" /></span><h3>已选择 {{ selectedAssets.length }} 张</h3><p>选择后的素材可以直接加入当前周内容，也可以交给 AI 作为风格参考。</p>
          <div class="mini-stack"><span v-for="id in selectedAssets.slice(0, 4)" :key="id">{{ id }}</span></div>
          <ElButton class="module-primary" type="primary" round :disabled="!selectedAssets.length" @click="showNotice(`已将 ${selectedAssets.length} 张素材加入 D3`) ">加入 D3 内容</ElButton>
        </aside>
      </div>
    </template>

    <template v-else-if="props.activeView === 'analytics'">
      <div class="analytics-kpis">
        <article v-for="item in [{ label: '近7日浏览', value: '18,620', delta: '+21.4%' }, { label: '新增粉丝', value: '386', delta: '+18.7%' }, { label: '咨询线索', value: '47', delta: '+12.3%' }, { label: '预计到店', value: '16', delta: '+6.8%' }]" :key="item.label" class="analytics-kpi panel"><small>{{ item.label }}</small><strong>{{ item.value }}</strong><span><TrendingUp :size="13" />{{ item.delta }}</span></article>
      </div>
      <div class="analytics-main">
        <article class="insight-chart panel">
          <div class="panel-head"><div><span class="section-label">CONTENT PERFORMANCE</span><h3>内容增长趋势</h3></div><span class="demo-badge">近 7 天 · 演示数据</span></div>
          <svg viewBox="0 0 720 260" role="img" aria-label="浏览量与新增粉丝趋势图">
            <g class="insight-grid"><path d="M45 36H690M45 92H690M45 148H690M45 204H690" /></g>
            <path class="insight-area" d="M45 191C110 182 128 135 196 151S282 177 354 110s105-16 160-59 113 14 176-20V215H45Z" />
            <path class="insight-line" d="M45 191C110 182 128 135 196 151S282 177 354 110s105-16 160-59 113 14 176-20" />
            <g class="insight-labels"><text x="45" y="244">周四</text><text x="155" y="244">周五</text><text x="265" y="244">周六</text><text x="375" y="244">周日</text><text x="485" y="244">周一</text><text x="595" y="244">周二</text><text x="664" y="244">今天</text></g>
          </svg>
        </article>
        <article class="topic-rank panel">
          <div class="panel-head"><div><span class="section-label">TOP TOPICS</span><h3>高潜内容方向</h3></div><BarChart3 :size="19" /></div>
          <div class="rank-list">
            <div v-for="(item, index) in [{ name: '通勤妆容', value: 92, grow: '+26%' }, { name: '学员改造', value: 78, grow: '+19%' }, { name: '穿搭配色', value: 65, grow: '+14%' }, { name: '新手工具', value: 54, grow: '+11%' }]" :key="item.name"><span>{{ index + 1 }}</span><b>{{ item.name }}</b><i><em :style="{ width: `${item.value}%` }" /></i><small>{{ item.grow }}</small></div>
          </div>
        </article>
      </div>
      <article class="strategy-card panel"><span class="strategy-orb"><Sparkles :size="19" /></span><div><span class="section-label">今日复盘建议</span><h3>把 D4 的“西装穿搭”改成“面试妆容 + 西装配色”</h3><p>通勤妆容热度上升 26%，且近三篇案例类内容带来的咨询率高于平均值。保留七天主线，只优化明天的选题切口。</p></div><button type="button" @click="showNotice('复盘建议已应用到 D4，七天主线保持不变')">应用到后续大纲 <ArrowRight :size="15" /></button></article>
    </template>

    <template v-else-if="props.activeView === 'outline'">
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
        <div><span class="section-label">历史内容资产</span><h2>文案库 · 328 篇</h2><p>已发布、草稿和排期内容都会参与语义查重。</p></div>
        <label class="search-field"><Search :size="16" /><input v-model="libraryQuery" type="search" placeholder="搜索标题、主题或状态"></label>
        <button class="outline-button" type="button" @click="showNotice('演示：历史文案导入入口已响应')"><FileText :size="16" />导入历史文案</button>
      </div>
      <div class="library-layout">
        <div class="library-table panel">
          <div class="library-head"><span>内容标题</span><span>主题</span><span>状态</span><span>最高相似度</span><span>收录日期</span></div>
          <article v-for="item in filteredLibrary" :key="item.title" class="library-row"><b>{{ item.title }}</b><span>#{{ item.topic }}</span><span>{{ item.status }}</span><span class="pass-text"><LockKeyhole :size="13" />{{ item.similarity }}%</span><small>{{ item.date }}</small></article>
          <div v-if="!filteredLibrary.length" class="empty-library"><Search :size="22" /><b>没有找到相关文案</b><small>换一个关键词试试。</small></div>
        </div>
        <aside class="gate-policy panel"><span class="policy-icon"><LockKeyhole :size="21" /></span><span class="section-label">原创度规则</span><h3>60% 硬门禁</h3><p>每次生成会比较标题、正文结构、核心观点和表达方式。</p><div class="threshold"><span>当前最高 42%</span><b>门禁 60%</b><i><em /></i></div><ul><li><Check :size="13" />达到 60% 自动退回</li><li><Check :size="13" />最多自动重写 3 次</li><li><Check :size="13" />通过后才允许排期</li></ul></aside>
      </div>
    </template>

    <template v-else-if="props.activeView === 'settings'">
      <div class="settings-banner panel"><span class="settings-icon"><ServerCog :size="23" /></span><div><span class="section-label">本机运行状态</span><h2>环境检测全部通过</h2><p>以下为前端演示状态，不会读取或保存真实密钥。</p></div><span class="status-good"><Check :size="14" />4 / 4 正常</span></div>
      <div class="connection-grid">
        <article v-for="item in [{ icon: 'xhs', name: '小红书账号', detail: '慕色美妆学院', state: '授权正常' }, { icon: 'ai', name: 'DeepSeek', detail: '内容生成与复盘', state: '已配置' }, { icon: 'img', name: 'QweAPI · img2.5', detail: '美妆与穿搭生图', state: '已配置' }, { icon: 'mcp', name: '小红书 MCP', detail: '发布与数据读取', state: '连接正常' }]" :key="item.name" class="connection-card panel"><span :class="['connection-icon', item.icon]"><KeyRound v-if="item.icon === 'ai'" :size="19" /><Palette v-else-if="item.icon === 'img'" :size="19" /><Send v-else-if="item.icon === 'mcp'" :size="19" /><ShieldCheck v-else :size="19" /></span><div><small>{{ item.name }}</small><b>{{ item.detail }}</b></div><span class="connection-state"><i />{{ item.state }}</span></article>
      </div>
      <div class="settings-grid">
        <article class="setting-panel panel"><div class="panel-head"><div><span class="section-label">CONTENT SAFETY</span><h3>内容与发布保护</h3></div><ShieldCheck :size="19" /></div><div class="setting-rows"><div><span><b>发布前人工确认</b><small>每条内容必须点确认后才能进入队列</small></span><button type="button" aria-label="发布前人工确认" :aria-pressed="systemToggles.review" :class="['switch-control', { active: systemToggles.review }]" @click="toggleSetting('review')"><i /></button></div><div><span><b>相似度超限自动重写</b><small>达到 60% 时最多自动重写 3 次</small></span><button type="button" aria-label="相似度超限自动重写" :aria-pressed="systemToggles.rewrite" :class="['switch-control', { active: systemToggles.rewrite }]" @click="toggleSetting('rewrite')"><i /></button></div><div><span><b>允许无人值守发布</b><small>建议完成首篇引导后再开启</small></span><button type="button" aria-label="允许无人值守发布" :aria-pressed="systemToggles.publish" :class="['switch-control', { active: systemToggles.publish }]" @click="toggleSetting('publish')"><i /></button></div></div></article>
        <article class="setting-panel panel"><div class="panel-head"><div><span class="section-label">LOCAL DEPLOYMENT</span><h3>本地运行环境</h3></div><ServerCog :size="19" /></div><div class="environment-list"><span><Check :size="14" /><b>系统环境</b><small>macOS · 可运行</small></span><span><Check :size="14" /><b>服务组件</b><small>已安装</small></span><span><Check :size="14" /><b>数据目录</b><small>可读写</small></span><span><Check :size="14" /><b>定时任务</b><small>服务正常</small></span></div><button class="outline-button full" type="button" @click="showNotice('本地环境复检完成，4 项全部正常')"><RefreshCw :size="15" />重新检测环境</button></article>
      </div>
    </template>

    <Transition name="toast">
      <div v-if="notice" class="demo-toast" role="status"><Check :size="15" />{{ notice }}</div>
    </Transition>
  </section>
</template>
