# -*- coding: utf-8 -*-
"""C1：系统设置页重做（对应你的第三批要求）
 - 登录卡：显示当前账号 + **切换账号** + 二维码**直接嵌在卡里**（不用点开弹窗）
 - 密钥卡：DeepSeek / 生图渠道 都能**手动输入 Key**（客户机没有 Hermes）+ **保存并检查** + 试出一张
 - 生图卡：渠道可切换（apikiki / qweapi），档位显示**真实像素**（渠道生不了 2K/4K 就不再给这个选项）
 - 内容与发布保护：三个真开关（不再「未接入」）
 - 人设卡：写明是**评论回复人设**、默认继承运营大纲账号人设
 - 禁用词表：默认给专业词表 + 恢复默认
 - 知识库两部分：① 上传文档 → AI 自动提炼知识条目 ② 对话框让 AI 帮你补全 + 条目列表（带来源） + 命中自测
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
    print("  ✔", p.split("\\")[-1])

def sub1(t, old, new, tag):
    crlf = "\r\n" in t
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert t.count(o) == 1, f"[{tag}] 锚点 count={t.count(o)}"
    return t.replace(o, n, 1)

# ---------------- api.js ----------------
a = load(A)
if "keysStatus" not in a:
    a = sub1(a, "  // 设置（密钥只回掩码）",
                """  // 密钥/渠道（客户机没有 Hermes → 界面手动填 + 当场检查）
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

  // 设置（密钥只回掩码）""", "api.keys")
    save(A, a, ["keysStatus", "guardSettings", "analyzeDoc"])

# ---------------- 模板：整块替换 settings 视图 ----------------
v = load(V)
SETI = v.index("    <template v-else-if=\"props.activeView === 'settings'\">")
END = v.rindex("</template>")
old_block = v[SETI:END]
assert "内容与发布保护" in old_block and "人设卡" in old_block, "设置页模板块定位失败"

NEW = r'''    <template v-else-if="props.activeView === 'settings'">
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

'''
v = v[:SETI] + NEW.replace("\n", "\r\n" if "\r\n" in old_block else "\n") + "    </template>\n" + v[END:]

# ---------------- 脚本 ----------------
SCRIPT = r'''/* ================= 系统设置：账号/密钥/保护开关/知识库（客户机没有 Hermes，全部界面可操作） ================= */

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

'''
if "================= 系统设置：账号/密钥" not in v:
    v = v.replace("/* ================= R22 运营大纲", SCRIPT.replace("\n", "\r\n" if "\r\n" in v else "\n") + "/* ================= R22 运营大纲", 1)
else:
    print("  (脚本块已存在，跳过重复插入)")

# loader：进设置页时加载新数据
if "loadAccStatus(); loadKeys()" not in v:
    old = "  if (v === 'settings') { loadRealStatus(); loadComments() }"
    new = "  if (v === 'settings') { loadRealStatus(); loadComments(); loadAccStatus(); loadKeys(); loadGuard(); loadLibraryDocs(); loadKbEntries(); loadKbChat() }"
    v = sub1(v, old, new, "settings.loader")
else:
    print("  (settings loader 已是新版，跳过)")

save(V, v, ["切换账号（扫码）", "保存并检查", "guardSettings", "runAnalyze", "TALK TO AI", "kbEntries"])

# ---------------- CSS ----------------
c = load(C)
CSS = '''/* ============ 系统设置：账号/密钥/开关/知识库 ============ */
.account-card .acc-line { margin: 10px 0 0; display: grid; gap: 4px; }
.account-card .acc-line b { font-size: 14px; }
.account-card .acc-line small { color: var(--muted); font-size: 10px; }
.acc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; margin-top: 12px; }
.conn-state { padding: 4px 9px; border-radius: 999px; font-size: 9px; font-weight: 700; }
.conn-state.ok { color: var(--positive); background: var(--positive-soft); }
.conn-state.bad { color: #b4544a; background: rgba(180, 84, 74, .1); }
.qr-inline { margin-top: 14px; display: grid; gap: 8px; justify-items: center; }
.qr-inline img { width: 168px; height: 168px; object-fit: contain; border: 1px solid var(--border); border-radius: 12px; background: #fff; }
.qr-inline .qr-empty { width: 168px; height: 168px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 12px; color: var(--muted); font-size: 10px; text-align: center; padding: 8px; }
.qr-inline small { color: var(--muted); font-size: 9px; text-align: center; }
.key-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 10px; margin-top: 10px; }
.setting-panel .studio-field { margin-top: 10px; }
.setting-panel .studio-field input, .setting-panel .studio-field select { width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: 10px; color: var(--ink); background: var(--panel); font-size: 11.5px; font-family: inherit; }
.key-result { font-size: 10px; }
.key-result.ok { color: var(--positive); }
.key-result.bad { color: #b4544a; }
.tier-table { margin-top: 12px; padding: 11px 13px; display: grid; gap: 6px; border: 1px solid var(--border); border-radius: 11px; background: var(--panel-two); }
.tier-table b { font-size: 11px; }
.tier-table span { font-size: 10.5px; }
.tier-table small { color: var(--muted); font-size: 9px; }
.tier-note { color: #b4544a; line-height: 1.6; }
.shot-result { margin-top: 12px; display: grid; gap: 6px; }
.shot-result img { width: 100%; max-width: 220px; border-radius: 11px; border: 1px solid var(--border); }
.shot-result small { color: var(--muted); font-size: 9px; }
.forbidden-box { width: 100%; margin-top: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--ink); background: var(--panel); font-size: 11px; line-height: 1.7; font-family: inherit; }
.kb-row { padding: 11px 0; display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid var(--border); }
.kb-row b { font-size: 12px; }
.kb-row button { padding: 0; border: 0; background: transparent; cursor: pointer; font-size: 10px; font-weight: 700; }
.kb-src { margin-left: 8px; padding: 2px 7px; border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-size: 8px; font-weight: 700; }
.kb-ans { margin-top: 5px; color: var(--muted); font-size: 11px; line-height: 1.7; }
.kb-kw { margin-top: 4px; color: var(--muted); font-size: 9px; }

'''
c = c.replace("@media (prefers-reduced-motion: reduce) {", CSS + "@media (prefers-reduced-motion: reduce) {", 1)
save(C, c, [".qr-inline", ".tier-table", ".kb-row"])
print("C1 完成")
