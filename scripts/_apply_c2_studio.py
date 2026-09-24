# -*- coding: utf-8 -*-
"""C2：运营大纲去重（保留上面三板块） + 内容工坊收口
 - 生成区块分区清晰（① 内容生成 ② 待发送内容池 ③ 单独生图）
 - 待发送内容卡显示**真实配图**（有图就显示图，不再全是占位线稿）
 - 文案编辑器重做：左=可编辑内容+配图+查重，右=**手机预览**（发出去长什么样）
 - 生图档位改成按渠道真实能力（qweapi 生不了 2K/4K 就不再给这个选项）
 - 生成默认跟随运营大纲 + 按策略发布时间自动排期
"""
import io

V = r"C:\Users\12543\xhs-ops-platform\web\src\components\ModuleViews.vue"
C = r"C:\Users\12543\xhs-ops-platform\web\src\styles\modules.css"

def load(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()

def save(p, d, must):
    for m in must:
        assert m in d, f"{p} 落盘校验失败：缺 {m!r}"
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(d)
    print("  ✔", p.split("\\")[-1])

def sub1(t, old, new, tag):
    crlf = "\r\n" in t
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert t.count(o) == 1, f"[{tag}] 锚点 count={t.count(o)}"
    return t.replace(o, n, 1)

v = load(V)
NL = "\r\n" if "\r\n" in v else "\n"

# ---------- ① 运营大纲去重：删掉老「运营计划表」里和三板块重复的 5 个输入 ----------
i_persona = v.index('>人设定位')
i_pillar = v.index('内容支柱占比')
lab_start = v.rindex('<label', 0, i_persona)
block = v[lab_start:i_pillar]
assert '目标人群' in block and '语气风格' in block and '核心卖点' in block and '转化目标' in block, "老计划表字段定位失败"
KEEP_NOTE = ('          <p style="margin:0;color:#8b8175;font-size:11px;line-height:1.7">'
             '人设 / 目标人群 / 语气 / 卖点 / 转化目标 统一在<b>上方「人物设定 · 目标人群 · 核心要求」</b>里设置'
             '（这里不再重复，避免两处打架）。本卡片只保留「内容支柱占比」与「每天发几条」。</p>' + NL + NL + '          ')
v = v[:lab_start] + KEEP_NOTE + v[i_pillar:]

# ---------- ② 待发送内容卡：显示真实配图 ----------
v = sub1(v, '''            <div class="draft-cover" :class="`draft-tone-${index % 4}`">
              <span>{{ item.date }}</span>
              <svg viewBox="0 0 180 130" aria-hidden="true"><circle cx="104" cy="48" r="34" /><path d="M61 126c10-35 37-53 76-48 20 3 34 19 42 48M88 45c12-15 37-13 45 8M98 58c9 5 18 4 26-2" /></svg>
              <small>{{ item.source === 'generated' ? 'AI 生成' : '历史笔记' }}</small>
            </div>''',
'''            <div class="draft-cover" :class="`draft-tone-${index % 4}`">
              <span>{{ item.date }}</span>
              <img v-if="item.cover" :src="imgProxy(item.cover)" alt="" class="draft-img" />
              <svg v-else viewBox="0 0 180 130" aria-hidden="true"><circle cx="104" cy="48" r="34" /><path d="M61 126c10-35 37-53 76-48 20 3 34 19 42 48M88 45c12-15 37-13 45 8M98 58c9 5 18 4 26-2" /></svg>
              <small>{{ item.source === 'generated' ? 'AI 生成' : '历史笔记' }}{{ item.cover ? ' · ' + item.imageCount + '图' : '' }}</small>
            </div>''', "pool.cover")

# ---------- ③ 单独生图面板：档位按渠道真实能力 ----------
v = sub1(v, '''            <label>档位
              <select v-model="imgForm.tier">
                <option value="standard">标准档（2K）</option>
                <option value="fine">精细档（4K）</option>
              </select>
            </label>''',
'''            <label>档位
              <select v-model="imgForm.tier">
                <option v-for="t in imgTiers" :key="'t' + t.key" :value="t.key">{{ t.name }} · 实出 {{ t.pixels }}</option>
              </select>
            </label>''', "studio.tier")
v = sub1(v, '''            <span class="studio-img-note">产物自动进素材库</span>''',
'''            <span class="studio-img-note">{{ imgStatus && imgStatus.providerName ? imgStatus.providerName : '产物自动进素材库' }}</span>''', "studio.prov")

# ---------- ④ 文案编辑器重做：左内容 / 右手机预览 ----------
s = v.index("      <!-- ===== 文案编辑器 ===== -->")
e = v.index("</template>", s)
NEW_ED = '''      <!-- ===== 文案编辑器（R19 重做）：左=可编辑内容+配图+查重，右=手机预览 ===== -->
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
'''
v = v[:s] + NEW_ED.replace("\n", NL) + v[e:]

# ---------- ⑤ 生成默认跟随大纲 + 策略时间 ----------
v = sub1(v, "const genScheduleOn = ref(false)", "const genScheduleOn = ref(true)   // 默认跟随运营大纲：生成完直接按策略时间排期", "gen.schedDefault")
v = sub1(v, "const genImages = ref(false)", "const genImages = ref(true)      // 默认一起生图（用户要求：不用手写提示词）", "gen.imgDefault")

save(V, v, ["人设 / 目标人群 / 语气", "draft-img", "imgTiers", "editor-card", "编辑这条内容"])

# ---------- 脚本补充 ----------
SCRIPT = r'''/* ---- R19 收口：封面图 / 生图档位（按渠道真实能力）/ 编辑器配图 / 策略时间 ---- */
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

'''
v2 = load(V)
v2 = v2.replace("/* ================= 系统设置：账号/密钥", SCRIPT.replace("\n", "\r\n" if "\r\n" in v2 else "\n") + "/* ================= 系统设置：账号/密钥", 1)
# poolRows 里补 images / cover
v2 = sub1(v2, "          dupScore: typeof it.dup_score === 'number' ? Math.round(it.dup_score * 100) : null,",
               "          dupScore: typeof it.dup_score === 'number' ? Math.round(it.dup_score * 100) : null,\n          images: (() => { try { const a = JSON.parse(it.images || '[]'); return Array.isArray(a) ? a.filter((x) => x && x.url) : [] } catch { return [] } })(),\n          cover: (() => { try { const a = JSON.parse(it.images || '[]'); return Array.isArray(a) && a[0] && a[0].url ? a[0].url : '' } catch { return '' } })(),", "pool.fields")
# studio loader 里带上策略时间
v2 = sub1(v2, "  if (v === 'studio') { loadContents(); loadTrends(); loadAiStatus(); syncGenConfig() }",
                "  if (v === 'studio') { loadContents(); loadTrends(); loadAiStatus(); syncGenConfig(); syncStrategyTime(); api.imageStatus().then(r => { imgStatus.value = r }).catch(() => {}) }", "studio.loader")
save(V, v2, ["imgTiers", "coverOf", "syncStrategyTime", "images: (() =>"])

# ---------- CSS ----------
c = load(C)
CSS = '''/* ============ R19 收口：池子封面 / 编辑器（左内容右手机） ============ */
.draft-img { width: 100%; height: 100%; object-fit: cover; }
.editor-card { width: min(1000px, 95vw); max-height: 90vh; overflow: auto; padding: 20px 22px; background: var(--panel); border-radius: 18px; }
.editor-close { padding: 0 8px; border: 0; color: var(--ink); background: transparent; cursor: pointer; font-size: 22px; line-height: 1; }
.editor-grid { margin-top: 14px; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(230px, .65fr); gap: 18px; align-items: start; }
.editor-left { display: grid; gap: 12px; }
.editor-left .studio-field textarea { line-height: 1.8; font-size: 12px; }
.editor-imgs { padding: 11px 13px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel-two); }
.editor-imgs b { font-size: 11px; }
.editor-img-row { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.editor-img-row img { width: 80px; height: 80px; object-fit: cover; border-radius: 10px; border: 1px solid var(--border); }
.dup-box { padding: 11px 13px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel-two); }
.dup-box b { font-size: 11.5px; }
.dup-box p { margin: 6px 0 0; color: var(--muted); font-size: 10px; line-height: 1.7; }
.editor-right { display: grid; gap: 8px; justify-items: center; position: sticky; top: 0; }
@media (max-width: 900px) { .editor-grid { grid-template-columns: 1fr; } .editor-right { justify-items: start; } }

'''
c = c.replace("@media (prefers-reduced-motion: reduce) {", CSS + "@media (prefers-reduced-motion: reduce) {", 1)
save(C, c, [".editor-card", ".editor-grid", ".draft-img"])
print("C2 完成")
