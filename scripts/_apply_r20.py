# -*- coding: utf-8 -*-
"""R20 前端：排期发布改版
 - 「自动发布调度」→「自动发送」开关（关=到点需手动确认）
 - 新增「发布保护」开关
 - 建议发布时间：默认按策略走 + 「手动调整」按钮 + 「实际发送时间」
 - 发布队列 → 周一~周日 周视图；点击文章横条向下展开：左=文章内容 右=手机真机预览；
   下方 预检/编辑/保存；预检结果显示在手机预览下面的独立框
"""
import io

V = r"C:\Users\12543\xhs-ops-platform\web\src\components\ModuleViews.vue"
A = r"C:\Users\12543\xhs-ops-platform\web\src\api.js"
C = r"C:\Users\12543\xhs-ops-platform\web\src\styles\modules.css"

def load(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()

def save(p, d, must):
    for m in must:
        assert m in d, f"{p} 落盘校验失败：缺 {m!r}"
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(d)
    print("  ✔", p.split("\\")[-1], "已写")

def sub1(t, old, new, tag):
    crlf = "\r\n" in t
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert t.count(o) == 1, f"[{tag}] 锚点 count={t.count(o)}"
    return t.replace(o, n, 1)

# ---------------- 1) api.js ----------------
a = load(A)
old = """  // 设置（密钥只回掩码）
  settings: () => req('/settings'),
  saveSetting: (key, value) => req('/settings', { method: 'POST', body: { key, value } }),
}"""
new = """  // 设置（密钥只回掩码）
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
}"""
a = sub1(a, old, new, "api.methods")
save(A, a, ["libraryUpload", "sendOutlineChat", "confirmTask", "setReplySettings"])

# ---------------- 2) ModuleViews.vue 模板 ----------------
v = load(V)
s = v.index("<template v-else-if=\"props.activeView === 'schedule'\">")
e = v.index("<template v-else-if=\"props.activeView === 'assets'\">")
old_block = v[s:e]
assert "自动发布调度" in old_block and "发布队列" in old_block, "排期页模板块没找到"

NEW = '''    <template v-else-if="props.activeView === 'schedule'">
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

'''
v = v[:s] + NEW.replace("\n", "\r\n" if "\r\n" in old_block else "\n") + v[e:]

# ---------------- 3) ModuleViews.vue 脚本 ----------------
R20 = '''/* ================= R20 排期发布：自动发送 / 发布保护 / 周视图 ================= */

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
  const m = s.match(/^(\\d{4}-\\d{2}-\\d{2})/)
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
      tags: JSON.stringify(d.tagsText.split(/[\\s,，]+/).filter(Boolean)),
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
  if (!window.confirm('确认现在发送这条到小红书？\\n会真实发布到你的账号上。')) return
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

'''
v = sub1(v, "/* ================= R19 内容工坊：统一生成入口", R20 + "/* ================= R19 内容工坊：统一生成入口", "R20.script")

# 视图切换时加载设置 + 默认定位今天
old = "  if (v === 'schedule') { loadContents(); loadPublish(true); loadScheduler() }"
new = """  if (v === 'schedule') {
    loadContents(); loadPublish(true); loadPubSettings()
    if (!weekSelected.value) weekSelected.value = isoDate(new Date())
  }"""
v = sub1(v, old, new, "R20.onViewChange")

save(V, v, ["week-tabs", "togglePubSet", "loadPubSettings", "phone-frame"])

# ---------------- 4) CSS ----------------
c = load(C)
CSS = '''/* ============ R20 排期发布：周视图 + 展开（左内容 / 右手机预览）+ 预检框 ============ */
.week-tabs { margin-top: 16px; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 7px; }
.week-tabs button { min-height: 58px; padding: 8px 6px; display: grid; place-items: center; align-content: center; gap: 3px;
  border: 1px solid var(--border); border-radius: 13px; color: var(--muted); background: var(--panel-two); cursor: pointer; }
.week-tabs button b { color: var(--ink); font-size: 11px; }
.week-tabs button small { font-size: 8px; }
.week-tabs button i { color: var(--accent); font-size: 8px; font-style: normal; font-weight: 700; }
.week-tabs button.active { color: var(--button-ink); border-color: var(--accent); background: var(--accent); }
.week-tabs button.active b, .week-tabs button.active small, .week-tabs button.active i { color: var(--button-ink); }
.week-tabs button.today:not(.active) { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.week-list { margin-top: 14px; display: grid; gap: 8px; }
.week-row { border: 1px solid var(--border); border-radius: 14px; background: var(--panel); overflow: hidden; }
.week-row.open { border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.week-row-head { width: 100%; min-height: 60px; padding: 10px 14px; display: grid; grid-template-columns: 62px minmax(0, 1fr) 70px 18px;
  align-items: center; gap: 12px; border: 0; color: var(--ink); text-align: left; background: transparent; cursor: pointer; }
.week-row-head:hover { background: var(--row-hover); }
.week-time b, .week-time small, .week-copy b, .week-copy small { display: block; }
.week-time b { font-size: 12px; font-variant-numeric: tabular-nums; }
.week-time small { margin-top: 3px; color: var(--muted); font-size: 8px; }
.week-copy { min-width: 0; }
.week-copy b { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; }
.week-copy small { margin-top: 5px; color: var(--muted); font-size: 8px; }
.week-caret { color: var(--muted); transition: transform .25s var(--ease); }
.week-row.open .week-caret { transform: rotate(90deg); }
.week-expand { padding: 4px 14px 16px; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(240px, .75fr); gap: 14px; align-items: start; }
.week-article { display: grid; gap: 9px; }
.week-article h4 { margin: 0; font-size: 13px; line-height: 1.5; }
.week-body { margin: 0; max-height: 260px; overflow-y: auto; color: var(--ink); font-size: 11px; line-height: 1.85; white-space: pre-wrap; }
.week-tags { margin: 0; color: var(--accent); font-size: 10px; }
.week-input { width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: 10px; color: var(--ink); background: var(--panel-two); font-size: 11px; font-family: inherit; resize: vertical; }
.week-imgs { display: flex; flex-wrap: wrap; gap: 7px; }
.week-imgs img { width: 74px; height: 74px; object-fit: cover; border-radius: 9px; border: 1px solid var(--border); }
.week-noimg { color: var(--muted); font-size: 10px; }
.week-phone { display: grid; gap: 6px; justify-items: center; }
.phone-frame { width: 100%; max-width: 246px; padding: 9px; border-radius: 22px; background: var(--preview-frame); box-shadow: 0 14px 32px -22px var(--shadow); }
.phone-frame > * { border-radius: 14px; }
.phone-cover { height: 132px; display: grid; place-items: center; overflow: hidden; background: var(--visual-bg); color: var(--muted); font-size: 10px; }
.phone-cover img { width: 100%; height: 100%; object-fit: cover; }
.phone-head { margin-top: 8px; padding: 0 4px; display: flex; align-items: center; gap: 6px; color: var(--ai-ink); }
.phone-avatar { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; color: var(--ai-button-ink); background: var(--ai-accent); font-size: 9px; font-weight: 700; }
.phone-head b { font-size: 10px; }
.phone-head small { margin-left: auto; color: var(--ai-muted); font-size: 8px; }
.phone-frame h5 { margin: 8px 4px 0; color: var(--ai-ink); font-size: 11px; line-height: 1.45; }
.phone-text { margin: 6px 4px 0; max-height: 150px; overflow-y: auto; color: var(--ai-muted); font-size: 9px; line-height: 1.8; white-space: pre-wrap; }
.phone-tags { margin: 7px 4px 0; color: var(--ai-accent); font-size: 9px; }
.week-phone-note { color: var(--muted); font-size: 8px; }
.week-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; padding-top: 10px; border-top: 1px dashed var(--border); }
.precheck-box { grid-column: 1 / -1; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel-two); }
.precheck-box b { font-size: 11px; }
.precheck-box ul { margin: 8px 0 0; padding-left: 18px; font-size: 10px; line-height: 1.9; }
@media (max-width: 1180px) { .week-expand { grid-template-columns: 1fr; } .week-phone { justify-items: start; } }
@media (max-width: 640px) { .week-tabs { grid-template-columns: repeat(4, minmax(0, 1fr)); } .week-row-head { grid-template-columns: 54px minmax(0, 1fr) 16px; } }

'''
c = sub1(c, "@media (prefers-reduced-motion: reduce) {", CSS + "@media (prefers-reduced-motion: reduce) {", "R20.css")
save(C, c, [".week-tabs", ".phone-frame", ".precheck-box"])
print("R20 前端落地完成")
