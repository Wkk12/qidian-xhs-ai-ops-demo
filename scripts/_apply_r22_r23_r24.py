# -*- coding: utf-8 -*-
"""R22 运营大纲（三板块折叠 + 完整策略 + AI 对话带记忆真实改策略）
   R23 互动区（自动回复开关 + 互动动态 + 私信跳转）
   R24 资料库（上传文档 → 知识条目 → 回复有支撑 + 命中自测）
   全部插进现有页面结构（不新增导航项，符合红线）"""
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

# ---------- api.js: 命中自测 ----------
a = load(A)
old = "  // R24 资料库：上传文档 → 知识条目（评论回复的知识支撑）"
new = """  // 回复命中自测（资料库/知识库能不能撑住这条提问）
  matchTest: (text) => req('/comments/match-test', { method: 'POST', body: { text } }),

  // R24 资料库：上传文档 → 知识条目（评论回复的知识支撑）"""
assert a.count(old) == 1, "api.js 锚点异常"
a = a.replace(old, new, 1)
save(A, a, ["matchTest: (text) =>"])

# ---------- ModuleViews.vue ----------
v = load(V)
NL = "\r\n" if "\r\n" in v else "\n"
def nl(s): return s.replace("\n", NL)

OUTLINE_OPEN = "    <template v-else-if=\"props.activeView === 'outline'\">"
LIB_OPEN = "    <template v-else-if=\"props.activeView === 'library'\">"
SET_OPEN = "    <template v-else-if=\"props.activeView === 'settings'\">"

i_out = v.index(OUTLINE_OPEN)
i_lib = v.index(LIB_OPEN)
i_set = v.index(SET_OPEN)

R22_BLOCK = '''
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
'''

R23_BLOCK = '''
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
'''

R24_BLOCK = '''
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
'''

R_SCRIPT = '''/* ================= R22 运营大纲 / R23 互动区 / R24 资料库 ================= */

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
    phasesText: (s.phases || []).map((p) => `${p.name || ''} | ${p.goal || ''} | ${(p.topics || []).join('、')}`).join('\\n'),
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
  return String(text || '').split('\\n').map((line) => line.trim()).filter(Boolean).map((line) => {
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
  if (!window.confirm(`确认删除《${d.name}》？\n连带它生成的知识条目一起删除（评论回复将不再引用它）。`)) return
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

'''

v = v[:i_out + len(OUTLINE_OPEN)] + nl(R22_BLOCK) + v[i_out + len(OUTLINE_OPEN):]

# 互动区插到 outline 模板结束前（library 模板之前的最后一个 </template>）
i_lib2 = v.index(LIB_OPEN)
j = v.rindex("</template>", i_out, i_lib2)
v = v[:j] + nl(R23_BLOCK) + v[j:]

# 资料库插到 library 模板结束前（settings 模板之前的最后一个 </template>）
i_lib3 = v.index(LIB_OPEN)
i_set3 = v.index(SET_OPEN)
k = v.rindex("</template>", i_lib3, i_set3)
v = v[:k] + nl(R24_BLOCK) + v[k:]

# 脚本
v = v.replace("/* ================= R20 排期发布", nl(R_SCRIPT) + "/* ================= R20 排期发布", 1)

# onViewChange 挂 loader（R21 老坑：区块在、数据空）
old = "  if (v === 'library') loadLibrary()"
new = "  if (v === 'library') { loadLibrary(); loadLibraryDocs() }"
assert v.count(old) == 1, "library loader 锚点异常"
v = v.replace(old, new, 1)
old2 = "  if (v === 'outline' || v === 'dashboard') { loadContents(); loadPositioning(); loadCompetitors(); loadWeekPlan() }"
new2 = "  if (v === 'outline' || v === 'dashboard') { loadContents(); loadPositioning(); loadCompetitors(); loadWeekPlan(); loadOutline(); loadChat(); loadReplySetting(); loadInteractionFeed() }"
assert v.count(old2) == 1, "outline loader 锚点异常"
v = v.replace(old2, new2, 1)

save(V, v, ["R22 运营大纲：三板块", "互动区", "资料库", "loadOutline()", "loadLibraryDocs()"])

# ---------- CSS ----------
c = load(C)
CSS = '''/* ============ R22 运营大纲 / R23 互动区 / R24 资料库 ============ */
.outline-strategy { padding: 18px 20px; display: grid; gap: 14px; }
.outline-strategy section { display: grid; gap: 6px; }
.strategy-text { margin: 0; color: var(--ink); font-size: 11.5px; line-height: 1.9; white-space: pre-wrap; }
.strategy-meta { margin: 0; color: var(--muted); font-size: 9px; }
.phase-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.phase-list article { padding: 11px 13px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel-two); }
.phase-list b { display: block; font-size: 11px; }
.phase-list small { display: block; margin-top: 5px; color: var(--muted); font-size: 9px; line-height: 1.6; }
.phase-list ul { margin: 8px 0 0; padding-left: 16px; color: var(--ink); font-size: 10px; line-height: 1.85; }
.outline-chat { padding: 18px 20px; }
.chat-list { margin-top: 12px; display: grid; gap: 9px; max-height: 320px; overflow-y: auto; }
.chat-empty { margin: 0; padding: 18px 12px; border: 1px dashed var(--border); border-radius: 12px; color: var(--muted); font-size: 11px; text-align: center; }
.chat-msg { padding: 10px 13px; border-radius: 13px; background: var(--panel-two); }
.chat-msg.user { background: var(--accent-soft); }
.chat-msg b { font-size: 10px; }
.chat-msg p { margin: 5px 0 0; color: var(--ink); font-size: 11.5px; line-height: 1.8; }
.chat-msg small { display: block; margin-top: 6px; color: var(--positive); font-size: 9px; }
.chat-input { margin-top: 12px; display: flex; gap: 9px; align-items: center; }
.chat-input input { flex: 1; min-width: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 11px; color: var(--ink); background: var(--panel); font-size: 11.5px; }
.blocks-panel { padding: 18px 20px; }
.blocks-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.blocks-grid .studio-actions { grid-column: 1 / -1; }
.reply-switch-card { padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.reply-switch-card strong, .reply-switch-card small { display: block; }
.reply-switch-card strong { margin-top: 6px; font-size: 14px; }
.reply-switch-card small { margin-top: 6px; max-width: 620px; color: var(--muted); font-size: 10px; line-height: 1.65; }
.interaction-panel { padding: 18px 20px; }
.dm-entry { margin-top: 14px; padding: 12px 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; border: 1px dashed var(--border); border-radius: 12px; }
.dm-entry b { font-size: 11px; }
.dm-entry small { color: var(--muted); font-size: 10px; }
.dm-entry a { text-decoration: none; }
.docs-panel { padding: 18px 20px; }
.doc-list { margin-top: 14px; display: grid; gap: 8px; }
.doc-row { padding: 11px 13px; display: grid; grid-template-columns: 54px minmax(0, 1fr) auto; align-items: center; gap: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel-two); }
.doc-ext { height: 34px; display: grid; place-items: center; border-radius: 9px; color: var(--button-ink); background: var(--accent); font-size: 9px; font-weight: 700; }
.doc-copy { min-width: 0; }
.doc-copy b { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; }
.doc-copy small { display: block; margin-top: 4px; color: var(--muted); font-size: 9px; }
.doc-preview { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.doc-actions { display: flex; gap: 10px; }
.doc-actions button { padding: 0; border: 0; color: var(--ink); background: transparent; cursor: pointer; font-size: 10px; font-weight: 700; }
.doc-test { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 13px; }
.doc-test b { font-size: 11px; }
.doc-test small { display: block; margin-top: 5px; color: var(--muted); font-size: 10px; }
.match-result { margin-top: 10px; font-size: 11px; line-height: 1.8; }
.match-result p { margin: 6px 0 0; color: var(--muted); font-size: 10px; }

'''
c = c.replace("@media (prefers-reduced-motion: reduce) {", CSS + "@media (prefers-reduced-motion: reduce) {", 1)
save(C, c, [".outline-chat", ".reply-switch-card", ".doc-list"])
print("R22/R23/R24 前端落地完成")
