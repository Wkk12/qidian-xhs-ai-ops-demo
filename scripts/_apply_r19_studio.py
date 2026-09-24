# -*- coding: utf-8 -*-
"""R19：把内容工坊模板整体替换成「统一生成入口 + 右侧独立生图 + 待发送内容池 + 热榜下移」"""
import io, sys

P = r"C:\Users\12543\xhs-ops-platform\web\src\components\ModuleViews.vue"
with io.open(P, "r", encoding="utf-8", newline="") as f:
    src = f.read()
lines = src.split("\n")

# 定位（0-based 索引）
start = None
for i, ln in enumerate(lines):
    if "props.activeView === 'studio'" in ln:
        start = i
        break
assert start is not None, "找不到 studio 模板起点"
end = None
for j in range(start + 1, len(lines)):
    if "===== 文案编辑器 =====" in lines[j]:
        end = j
        break
assert end is not None, "找不到文案编辑器起点"

assert "生成方案" in "\n".join(lines[start + 1:start + 3]), f"起点附近不是生成方案面板：{lines[start+1]!r}"
assert "week-content-grid" in "\n".join(lines[end - 25:end]), "结束前没找到 week-content-grid"

NEW = r'''    <template v-if="props.activeView === 'studio'">
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
            <span class="studio-img-note">产物自动进素材库</span>
          </div>
          <label class="studio-field"><span>要什么图（一句话）</span>
            <input v-model="imgForm.prompt" placeholder="例：美容院海报配图，一位女性在护理" />
          </label>
          <div class="studio-img-opts">
            <label>档位
              <select v-model="imgForm.tier">
                <option value="standard">标准档（2K）</option>
                <option value="fine">精细档（4K）</option>
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
              <svg viewBox="0 0 180 130" aria-hidden="true"><circle cx="104" cy="48" r="34" /><path d="M61 126c10-35 37-53 76-48 20 3 34 19 42 48M88 45c12-15 37-13 45 8M98 58c9 5 18 4 26-2" /></svg>
              <small>{{ item.source === 'generated' ? 'AI 生成' : '历史笔记' }}</small>
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

'''

out = "\n".join(lines[:start]) + "\n" + NEW + "\n".join(lines[end:])
assert "PENDING POOL" in out and "一周内容批量创作" not in out, "替换结果异常"
with io.open(P, "w", encoding="utf-8", newline="") as f:
    f.write(out)
print("OK 替换行数:", end - start, "->", NEW.count("\n"))
