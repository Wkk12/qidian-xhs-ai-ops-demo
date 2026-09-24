/**
 * 内容生成引擎（M2.5）
 *
 * 四参考系加权（见 09_机制规格书 §2.1）：
 *   ① 用户输入     0.45  ← 最高
 *   ② 运营计划表   0.25
 *   ③ 历史好文     0.20  （按收藏率 Top 30%）
 *   ④ 行业热榜     0.10
 *
 * 七天叙事结构（D1 痛点 → D7 转化），每天承接前一天结论。
 *
 * R19 增补（内容工坊）：统一生成入口 runGeneration（auto=无内容 7 天/有内容 1 篇）、
 *   生成后逐篇自动配图（autoIllustrate，复用 imagegen 链路）、7 天未排期草稿自动清理（purgeExpiredDrafts）。
 */
import { chat, parseJson } from './deepseek.js';
import { db, now, log } from './db.js';
import { checkDuplicate, similarity } from './dedupe.js';
import { generateImage } from './imagegen.js';

const ROLES = [
  { day: 1, role: '痛点共鸣', goal: '让目标用户觉得"说的就是我"' },
  { day: 2, role: '工具/认知', goal: '给出低成本的第一步' },
  { day: 3, role: '方法展示', goal: '展示专业度（最容易出收藏）' },
  { day: 4, role: '场景延伸', goal: '延展到穿搭/场合/人群' },
  { day: 5, role: '案例证明', goal: '用真实改造成果建立信任' },
  { day: 6, role: '价值升维', goal: '讲清课程/服务背后的逻辑' },
  { day: 7, role: '行动转化', goal: '明确下一步行动（预约/咨询）' },
];

/* ---------------- 参考系读取 ---------------- */

export function getPositioning() {
  const row = db.prepare('SELECT * FROM positioning ORDER BY id DESC LIMIT 1').get();
  let pillars = [];
  try { pillars = JSON.parse(row?.pillars || '[]'); } catch { pillars = []; }
  return {
    persona: row?.persona || '',
    audience: row?.audience || '',
    tone: row?.tone || '',
    selling: row?.selling || '',
    goal: row?.goal || '',
    pillars,
  };
}

/** 历史好文：按收藏率（收藏÷点赞）排序，取 Top 30% */
export function getGoodPosts(limit = 8) {
  // 互动数据在 metrics 表（按 note_id 关联），取每篇最新一条
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT c.id, c.title, c.body, c.source, c.status, c.note_id,
             COALESCE(m.likes,0) AS liked,
             COALESCE(m.collects,0) AS collected,
             COALESCE(m.comments,0) AS commented
      FROM contents c
      LEFT JOIN (
        SELECT note_id, likes, collects, comments,
               ROW_NUMBER() OVER (PARTITION BY note_id ORDER BY date DESC) AS rn
        FROM metrics
      ) m ON m.note_id = c.note_id AND m.rn = 1
      WHERE (c.title IS NOT NULL AND c.title <> '')
      ORDER BY c.id DESC LIMIT 300
    `).all();
  } catch (e) {
    // metrics 表结构不同或还没数据 → 退回只按内容
    rows = db.prepare(`SELECT id, title, body, source, status, note_id, 0 AS liked, 0 AS collected, 0 AS commented
                       FROM contents WHERE (title IS NOT NULL AND title <> '') ORDER BY id DESC LIMIT 300`).all();
  }

  const scored = rows.map((r) => {
    const likes = Number(r.liked) || 0;
    const cols = Number(r.collected) || 0;
    // 收藏率：收藏/点赞（点赞为 0 时用收藏数本身作弱信号）
    const rate = likes > 0 ? cols / likes : (cols > 0 ? 0.5 : 0);
    return { ...r, rate };
  }).sort((a, b) => b.rate - a.rate || b.collected - a.collected);

  const top = Math.max(1, Math.ceil(scored.length * 0.3));
  return scored.slice(0, Math.min(limit, top));
}

/** 行业热榜：按热度公式 赞×1 + 藏×1.5 + 评×2 排序 */
export function getTrends(limit = 12) {
  return db.prepare(`
    SELECT keyword, title, author, liked, collected, commented
    FROM trends
    ORDER BY (liked + collected * 1.5 + commented * 2.0) DESC, id DESC
    LIMIT ?
  `).all(limit);
}

/* ---------------- 提示词构建 ---------------- */

export function buildPrompt({ userIntent, postsPerDay, days, startDay, includeRoles }) {
  const pos = getPositioning();
  const good = getGoodPosts(8);
  const trends = getTrends(12);

  const pillarText = pos.pillars.length
    ? pos.pillars.map((p) => `  · ${p.name}：${p.ratio}%${p.note ? `（${p.note}）` : ''}`).join('\n')
    : '  （未设置，请按美业通用结构：方法展示 40% / 案例 25% / 工具 15% / 认知 15% / 转化 5%）';

  const goodText = good.length
    ? good.map((g, i) => `  ${i + 1}. 《${g.title}》${g.liked ? `（赞${g.liked}/藏${g.collected}，收藏率${(g.rate * 100).toFixed(0)}%）` : '（历史笔记，无互动数据）'}`).join('\n')
    : '  （暂无历史内容）';

  const trendText = trends.length
    ? trends.slice(0, 10).map((t, i) => `  ${i + 1}. 《${t.title}》👍${t.liked}  [${t.keyword}]`).join('\n')
    : '  （暂无热榜数据，建议先抓取）';

  const dayPlan = ROLES.slice(startDay - 1, startDay - 1 + days)
    .map((r) => `  D${r.day}（${r.role}）：${r.goal}`)
    .join('\n');

  const total = days * postsPerDay;

  return `你是资深小红书美业（化妆培训）运营专家，擅长写"能涨粉、能收藏、能转化"的笔记。

【参考系①·用户本轮指定】权重最高（0.45），必须优先满足
${userIntent ? userIntent : '（用户本轮没有特别指定，请按下面的运营计划表走）'}

【参考系②·运营计划表】权重 0.25（账号长期定位，默认方向）
  人设：${pos.persona || '（未设置）'}
  目标人群：${pos.audience || '（未设置）'}
  语气风格：${pos.tone || '（未设置）'}
  核心卖点：${pos.selling || '（未设置）'}
  转化目标：${pos.goal || '（未设置）'}
  内容支柱占比：
${pillarText}

【参考系③·自己历史好文】权重 0.20（学习这些的选题角度与标题风格，**不得照抄**）
${goodText}

【参考系④·当前行业热点】权重 0.10（可参考题材方向，**不得照抄标题**）
${trendText}

【任务】
生成 ${days} 天 × 每天 ${postsPerDay} 条 = **共 ${total} 条**小红书笔记。
叙事结构（每天都必须承接前一天的结论，并给下一天留钩子）：
${dayPlan}

【硬性要求】
1. 每条标题 ≤ 20 字，要有钩子（疑问式/数字式/结果前置式），口语化，不写广告腔
2. 正文 150–400 字，分段短句，每段不超过 3 行，可用 emoji 但不堆砌
3. 至少 3 个话题标签
4. 每条标注它属于哪个「内容支柱」，并说明为什么这么写（1 句话）
5. 用户指定优先：与用户指定冲突时，以用户为准，并在 reason 里说明
6. **原创**：不得与历史好文标题高度相似

【输出格式】严格 JSON（不要多余文字）：
{
  "theme": "本周主线（一句话）",
  "items": [
    {
      "day": 1,
      "title": "标题",
      "body": "正文",
      "tags": ["标签1","标签2","标签3"],
      "pillar": "所属内容支柱",
      "reason": "为什么这么写"
    }
  ]
}`;
}

/* ---------------- 查重门禁（60%，最多重写 3 次） ---------------- */

const DUP_THRESHOLD = 0.6;
const MAX_REWRITE = 3;

/** 对单条内容做查重；不过则让模型换角度重写 */
async function enforceDedupe(item, context, keyword = '') {
  let cur = { title: item.title, body: item.body };
  let last = null;
  for (let attempt = 0; attempt <= MAX_REWRITE; attempt++) {
    const dup = checkDuplicate({ title: cur.title, body: cur.body }, { threshold: DUP_THRESHOLD });
    last = dup;
    if (dup.pass) return { ...item, title: cur.title, body: cur.body, dupScore: dup.score, dupWith: null, rewrites: attempt, dupPass: true };
    if (attempt === MAX_REWRITE) break;
    // 换角度重写
    const hint = dup.top ? `最像的是《${dup.top.title}》，相似维度：标题${(dup.top.parts.title * 100).toFixed(0)}%/结构${(dup.top.parts.structure * 100).toFixed(0)}%/观点${(dup.top.parts.viewpoint * 100).toFixed(0)}%/表达${(dup.top.parts.expression * 100).toFixed(0)}%` : '';
    const r = await chat([
      { role: 'system', content: '你是小红书文案改写专家，只输出严格 JSON。' },
      {
        role: 'user',
        content: `下面这条小红书笔记与账号历史内容相似度 ${(dup.score * 100).toFixed(0)}%（阈值 60%），必须换一个完全不同的角度和表达重写。\n${hint}\n\n【原文】\n标题：${cur.title}\n正文：${cur.body}\n\n【要求】\n1. 保留主题价值，但换切入角度（如从"痛点"改"对比"、从"教程"改"问答"）\n2. 标题必须与原文和历史内容都不同\n3. 结构、句式、开头方式都要变\n4. 正文 150–400 字\n\n输出 JSON：{"title":"...","body":"..."}`,
      },
    ], { json: true, temperature: 0.95, maxTokens: 1500, timeout: 120000 });
    const fixed = parseJson(r.content);
    if (!fixed || !fixed.title) break;
    cur = { title: String(fixed.title), body: String(fixed.body || '') };
  }
  return {
    ...item, title: cur.title, body: cur.body,
    dupScore: last ? last.score : 0,
    dupWith: last && last.top ? last.top.id : null,
    rewrites: MAX_REWRITE,
    dupPass: false,
  };
}

/* ---------------- 生成主流程 ---------------- */

export async function generateWeek({ userIntent = '', postsPerDay = 1, days = 7, startDay = 1, dryRun = false } = {}) {
  const prompt = buildPrompt({ userIntent, postsPerDay, days, startDay });
  const t0 = Date.now();
  const r = await chat(
    [
      { role: 'system', content: '你是小红书美业运营专家，输出必须是严格合法的 JSON。' },
      { role: 'user', content: prompt },
    ],
    { json: true, temperature: 0.85, maxTokens: 8000, timeout: 300000 },
  );
  const data = parseJson(r.content);
  if (!data || !Array.isArray(data.items)) {
    throw new Error('模型输出无法解析为 JSON：' + String(r.content).slice(0, 200));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (dryRun) {
    const checked = data.items.map((it) => {
      const d = checkDuplicate({ title: it.title, body: it.body }, { threshold: DUP_THRESHOLD });
      return { ...it, dupScore: Number((d.score * 100).toFixed(0)), dupPass: d.pass, dupWith: d.top ? d.top.title : null };
    });
    return { ok: true, dryRun: true, theme: data.theme, items: checked, usage: r.usage, elapsed };
  }

  // 逐条过查重门禁（≥60% 自动重写，最多 3 次），再做落库
  const ins = db.prepare(`INSERT INTO contents
    (source,title,body,tags,status,plan_id,day_index,dup_score,dup_with,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const finalItems = [];
  let saved = 0, blocked = 0;
  for (const it of data.items) {
    let item = it;
    try {
      item = await enforceDedupe(it, {}, '');
    } catch (e) {
      log('error', 'generate', '查重失败（跳过门禁）: ' + e.message);
    }
    item.dupPass === false ? blocked++ : null;
    let newId = null;
    try {
      const insRes = ins.run(
        'generated',
        String(item.title || '').slice(0, 120),
        String(item.body || ''),
        JSON.stringify(item.tags || []),
        'draft',
        null,
        Number(item.day) || null,
        item.dupScore ?? null,
        item.dupWith ?? null,
        now(), now(),
      );
      newId = Number(insRes.lastInsertRowid);
      saved++;
    } catch (e) {
      log('error', 'generate', '存库失败: ' + e.message);
    }
    finalItems.push({
      id: newId,
      day: item.day, title: item.title, pillar: item.pillar, reason: item.reason,
      tags: item.tags, dupScore: Number(((item.dupScore || 0) * 100).toFixed(0)),
      dupPass: item.dupPass !== false, rewrites: item.rewrites || 0,
    });
  }
  log('info', 'generate', `生成 ${saved}/${data.items.length} 条（查重未过 ${blocked} 条）`);
  log('info', 'generate', `生成 ${saved}/${data.items.length} 条（${elapsed}s，${r.usage?.total_tokens || 0} tokens）`);
  return {
    ok: true, theme: data.theme, saved, blocked, total: data.items.length,
    items: finalItems, usage: r.usage, elapsed,
  };
}

/* ---------------- 内容工坊编排（R19）：模式判定 / 自动配图 / 7 天清理 ---------------- */

/** 已生成内容条数（auto 模式：0 条 → 7 天，否则 1 篇） */
export function countGenerated() {
  try { return Number(db.prepare("SELECT COUNT(*) AS n FROM contents WHERE source='generated'").get()?.n || 0); }
  catch { return 0; }
}

/** 单篇模式的叙事起点：承接最近一条生成内容的 day_index 往后排（1..7 循环） */
function nextDayIndex() {
  try {
    const r = db.prepare("SELECT day_index FROM contents WHERE source='generated' AND day_index IS NOT NULL ORDER BY id DESC LIMIT 1").get();
    return (Number(r?.day_index || 0) % 7) + 1;
  } catch { return 1; }
}

/** auto → seven/single（显式 mode 原样返回） */
export function resolveGenerateMode(mode) {
  const m = ['seven', 'single'].includes(mode) ? mode : 'auto';
  if (m !== 'auto') return m;
  return countGenerated() === 0 ? 'seven' : 'single';
}

/**
 * 生成后逐篇自动配图（提示词 = 该内容标题 + 正文摘要，交 imagegen 扩写链路）。
 * 单条失败不影响其它项：逐项返回 {ok, url|error}。
 */
export async function autoIllustrate(items, { tier = 'standard', ratio = '1:1', limit = 0 } = {}) {
  const out = [];
  let attempted = 0;
  for (const it of items || []) {
    if (!it || !it.id) { out.push({ id: it?.id ?? null, ok: false, error: '缺少内容ID，跳过' }); continue; }
    if (limit > 0 && attempted >= limit) { out.push({ id: it.id, ok: false, skipped: true, error: `超出 imageLimit(${limit})，跳过` }); continue; }
    attempted++;
    try {
      const row = db.prepare('SELECT title, body FROM contents WHERE id=?').get(it.id);
      const prompt = `${row?.title || it.title || ''}｜${String(row?.body || '').slice(0, 150)}`;
      const r = await generateImage({ prompt, tier, ratio, contentId: it.id });
      const imgRow = db.prepare('SELECT images FROM contents WHERE id=?').get(it.id);
      let arr = [];
      try { arr = JSON.parse(imgRow?.images || '[]'); } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      arr.push({ path: r.file, url: r.url, type: 'generated', source: 'imagegen', assetId: r.assetId });
      db.prepare('UPDATE contents SET images=?, updated_at=? WHERE id=?').run(JSON.stringify(arr), now(), it.id);
      out.push({ id: it.id, ok: true, url: r.url, file: r.file, assetId: r.assetId, tier: r.tier });
    } catch (e) {
      log('error', 'generate', `自动配图失败 #${it.id}: ${e.message}`);
      out.push({ id: it.id, ok: false, error: String(e.message).slice(0, 200) });
    }
  }
  return out;
}

/**
 * 统一生成入口（R19）：
 *  - mode=auto：无生成内容 → 7 天；已有 → 1 篇。mode=seven/single 显式指定（此时忽略 days）。
 *  - mode 缺省：沿用旧行为（days/startDay 生效，兼容旧前端）。
 *  - withImages=true：生成后逐篇自动配图（imageTier/imageRatio/imageLimit 可选）。
 */
export async function runGeneration({
  userIntent = '', postsPerDay = 1, mode = '', days = 0, startDay = 0,
  dryRun = false, withImages = false, imageTier = 'standard', imageRatio = '1:1', imageLimit = 0,
} = {}) {
  const usesMode = ['auto', 'seven', 'single'].includes(mode);
  let effMode, nDays, sd;
  if (usesMode) {
    effMode = resolveGenerateMode(mode);
    nDays = effMode === 'seven' ? 7 : 1;
    sd = Number(startDay) > 0 ? Math.min(Math.max(Number(startDay), 1), 7) : (effMode === 'seven' ? 1 : nextDayIndex());
  } else {
    effMode = 'custom';
    nDays = Math.min(Math.max(Number(days) || 7, 1), 14);
    sd = Math.min(Math.max(Number(startDay) || 1, 1), 7);
  }
  const gen = await generateWeek({ userIntent, postsPerDay, days: nDays, startDay: sd, dryRun });
  gen.mode = effMode;
  gen.days = nDays;
  gen.startDay = sd;
  if (!dryRun && withImages && Array.isArray(gen.items) && gen.items.length) {
    gen.images = await autoIllustrate(gen.items, {
      tier: imageTier === 'fine' ? 'fine' : 'standard',
      ratio: imageRatio || '1:1',
      limit: Number(imageLimit) || 0,
    });
    gen.imagesOk = gen.images.filter((x) => x.ok).length;
    gen.imagesFailed = gen.images.filter((x) => !x.ok).length;
  }
  return gen;
}

/**
 * 7 天自动清理（R19）：source='generated' 且 draft 且未排期 且未收藏 且生成超 7 天 → 删除。
 * 排期判定：无 pending/awaiting_confirm/precheck/publishing/done/failed 任务（canceled 不算占用）。
 * 由发布调度器每轮扫描顺带执行（挂进现有调度）；dryRun=true 只返回将删列表。
 */
export function purgeExpiredDrafts({ days = 7, dryRun = false } = {}) {
  const cutoff = Date.now() - days * 86400000;
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT c.id, c.title, c.created_at FROM contents c
      WHERE c.source='generated' AND c.status='draft' AND COALESCE(c.favorite,0)=0
        AND NOT EXISTS (
          SELECT 1 FROM publish_tasks t
          WHERE t.content_id = c.id
            AND t.status IN ('pending','awaiting_confirm','precheck','publishing','done','failed')
        )
    `).all();
  } catch (e) {
    log('error', 'generate', '7 天清理扫描失败: ' + e.message);
    return { ok: false, error: e.message, scanned: 0, expired: [], deleted: 0, dryRun };
  }
  const expired = rows.filter((r) => {
    const t = r.created_at ? new Date(String(r.created_at).replace(' ', 'T')) : null;
    return !!t && !Number.isNaN(t.getTime()) && t.getTime() < cutoff;
  });
  let deleted = 0;
  if (!dryRun) {
    for (const r of expired) {
      try { db.prepare('DELETE FROM contents WHERE id=?').run(r.id); deleted++; }
      catch (e) { log('error', 'generate', `7 天清理删除失败 #${r.id}: ${e.message}`); }
    }
  }
  if (expired.length) {
    log('info', 'generate', `7 天自动清理：${dryRun ? '待删' : '已删'} ${dryRun ? expired.length : deleted} 条（候选 ${rows.length}）`);
  }
  return {
    ok: true, days, dryRun,
    scanned: rows.length,
    expired: expired.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at })),
    deleted: dryRun ? 0 : deleted,
  };
}
