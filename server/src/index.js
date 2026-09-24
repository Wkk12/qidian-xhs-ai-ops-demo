/**
 * 绮点 AI 小红书运营平台 · 本地服务（P1 骨架）
 * 启动：node src/index.js   （默认 127.0.0.1:8787，只监听本机，不对外暴露）
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, now, log } from './db.js';
import { mcp, extractMetrics, circuitState } from './mcp.js';
import { registerAssets, UPLOAD_DIR } from './assets.js';
import { registerInteractionApi } from './interaction.js';
import { registerAnalyticsApi } from './analytics.js';
import { registerOutlineApi, strategyText, getStrategy } from './outline.js';
import { registerLibraryApi } from './library.js';
import { registerKnowledgeApi } from './knowledge.js';
import { registerKeysApi } from './keys.js';
import { reloadKeys as reloadDeepseekKeys, chat as deepseekChatOnce } from './deepseek.js';
import { isReplyEnabled, setReplyEnabled } from './comments.js';
import { generateWeek, runGeneration, getPositioning, getGoodPosts, getTrends, platformText, refreshPlatformRef } from './generate.js';
import { checkDuplicate } from './dedupe.js';
import { collectSnapshots, buildReport } from './report.js';
import { generateImage, expandPrompt, imagegenReady, TIERS, reloadKeys as reloadImageKeys, testImageChannel, testShot } from './imagegen.js';
import {
  getPersona, setPersona, getForbidden, setForbidden, pollOnce, startPoller,
  listComments, approveComment, manualReply, statsComments,
  takeover, resumeAuto, listTakeover, matchKnowledge,
} from './comments.js';
import { discover, analyzeAuthor, analyzeAll, listCompetitors, addCompetitor, removeCompetitor, enrich, enrichTimes } from './competitors.js';
import { listTasks, schedulePublish, cancelTask, runTask, precheck, bestPublishTime, startScheduler, tick, schedulerState, confirmTask, scheduleBatch, publishSettings, setPublishSettings } from './publish.js';
import { deepseekReady, deepseekInfo } from './deepseek.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
// 素材上传（「在线素材」= 上传图 + 生成图的统一存放位）
await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024 } });
// 素材文件静态服务：/files/xxx.png
await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/files/' });
await registerAssets(app);
await registerInteractionApi(app);
await registerAnalyticsApi(app);
await registerOutlineApi(app);
await registerLibraryApi(app);
await registerKnowledgeApi(app);
await registerKeysApi(app, {
    deepseekInfo,
    reloadDeepseek: reloadDeepseekKeys,
    chatOnce: (msgs, opt) => deepseekChatOnce(msgs, opt),
    imageStatus: imagegenReady,
    reloadImage: reloadImageKeys,
    testImageChannel,
  });

  // 生图渠道「试出一张」：真出图（约 60–90 秒），证明端到端可用
  app.post('/api/image/test-shot', async () => testShot());

// 前端页面托管（构建产物 web/dist）→ 访问 http://127.0.0.1:8787 直接出页面，无需单独起前端
const WEB_DIST = path.resolve(__dirname, '../../web/dist');
const HAS_DIST = fs.existsSync(path.join(WEB_DIST, 'index.html'));
if (HAS_DIST) {
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', decorateReply: false });
}

// ---------- 统一错误处理 ----------
app.setErrorHandler((err, req, reply) => {
  log('error', 'http', `${req.method} ${req.url}: ${err.message}`);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  reply.code(status).send({ ok: false, error: err.message, detail: err.data || null });
});

// ---------- 健康检查 ----------

/* ---------- 「内容与发布保护」开关（原来是三个「未接入」死框） ---------- */
function getSettingRow(key, dflt) {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!r) return dflt;
    try { return JSON.parse(r.value); } catch { return r.value; }
  } catch { return dflt; }
}
function putSettingRow(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(value), now());
  return value;
}
app.get('/api/guard/settings', async () => ({
  ok: true,
  dedupeRewrite: getSettingRow('dedupe_rewrite', true) !== false,   // 相似度超限自动重写
  autoSend: getSettingRow('auto_send', '1') !== '0',                // 无人值守发布
  protect: getSettingRow('publish_protect', '1') !== '0',           // 发布保护
}));
app.post('/api/guard/settings', async (req) => {
  const b = req.body || {};
  if (b.dedupeRewrite !== undefined) putSettingRow('dedupe_rewrite', !!b.dedupeRewrite);
  if (b.autoSend !== undefined) putSettingRow('auto_send', b.autoSend ? '1' : '0');
  if (b.protect !== undefined) putSettingRow('publish_protect', b.protect ? '1' : '0');
  return {
    ok: true,
    dedupeRewrite: getSettingRow('dedupe_rewrite', true) !== false,
    autoSend: getSettingRow('auto_send', '1') !== '0',
    protect: getSettingRow('publish_protect', '1') !== '0',
  };
});

app.get('/api/health', async () => ({
  ok: true,
  service: 'xhs-ops-server',
  version: '0.1.0',
  time: now(),
  db: 'sqlite(node:sqlite)',
}));

// ---------- MCP 状态（登录/服务）----------
// TTL 缓存（2026-09-21 加）：登录弹窗会持续轮询本接口，多开标签页会成倍打到 MCP。
// 实测：不退避的轮询让 MCP 每 5 秒被无效请求打磨 → 错误日志 2 天涨到 33.8MB。
// 这里做 8 秒内的结果合并：N 个客户端在 8 秒内轮询，MCP 只被真实调用 1 次。
//
// 🔴 自适应退避（2026-09-22 加）：实测发现持续轮询已把小号拉进小红书的
//    风控「安全限制 300013 / 访问频繁」→ 登录页被拦、二维码取不到。
//    因此：异常/未登录状态下把 TTL 拉长到 5 分钟，避免继续火上浇油；
//    只有「已登录」的正常态才用 8 秒短缓存。
const STATUS_TTL_MS = Number(process.env.XHS_MCP_STATUS_TTL || 8000);
const STATUS_TTL_BLOCKED_MS = Number(process.env.XHS_MCP_STATUS_TTL_BLOCKED || 5 * 60 * 1000);
let _statusCache = { at: 0, data: null, inflight: null, ttl: STATUS_TTL_MS };

function _ttlFor(d) {
  // 已登录且服务正常 → 短缓存（用户正等着扫码后的状态刷新）
  if (d && d.service && d.loggedIn) return STATUS_TTL_MS;
  // 服务异常 / 未登录 / 熔断 → 长缓存（可能是被封或登录态失效，别继续打）
  return STATUS_TTL_BLOCKED_MS;
}

async function computeMcpStatus() {
  const out = { service: false, loggedIn: false };
  try {
    const h = await mcp.health();
    out.service = h?.status === 'healthy' || h?.success === true;
    out.account = h?.data?.account;
  } catch (e) {
    out.serviceError = e.message;
    out.circuit = circuitState();
    return out;
  }
  try {
    const s = await mcp.loginStatus();
    out.loggedIn = s?.data?.is_logged_in === true;
    out.username = s?.data?.username;
    out.userId = s?.data?.user_id;
    if (out.loggedIn) {
      db.prepare(`INSERT INTO accounts (platform,nickname,user_id,is_logged_in,updated_at)
                  VALUES ('xiaohongshu',?,?,1,?)`).run(out.username || '', out.userId || '', now());
    }
  } catch (e) {
    out.loginError = e.message;
  }
  out.circuit = circuitState();
  return out;
}

app.get('/api/mcp/status', async () => {
  const age = Date.now() - _statusCache.at;
  if (_statusCache.data && age < _statusCache.ttl) {
    return { ..._statusCache.data, cached: true, cacheAgeMs: age, cacheTtlMs: _statusCache.ttl };
  }
  // 并发合并：同时到达的请求共用同一次真实调用
  if (!_statusCache.inflight) {
    _statusCache.inflight = computeMcpStatus()
      .then((d) => {
        const ttl = _ttlFor(d);
        _statusCache = { at: Date.now(), data: d, inflight: null, ttl };
        return d;
      })
      .catch((e) => {
        _statusCache.inflight = null;
        throw e;
      });
  }
  const fresh = await _statusCache.inflight;
  return { ...fresh, cached: false, cacheTtlMs: _statusCache.ttl };
});

/** 熔断器状态（供前端/排障查看，不触发任何 MCP 调用） */
app.get('/api/mcp/circuit', async () => ({ ok: true, circuit: circuitState() }));

/** 手动清状态缓存（排障用：扫码成功后想立刻刷新可调它） */
app.post('/api/mcp/status/refresh', async () => {
  _statusCache = { at: 0, data: null, inflight: null, ttl: STATUS_TTL_MS };
  _meCache = { at: 0, data: null, inflight: null }; // 账号资料缓存一起清（登录/换号后要立刻拿到新账号）
  return { ok: true, cleared: true };
});

app.get('/api/mcp/qrcode', async () => {
  const r = await mcp.loginQrcode();
  return { ok: true, data: r?.data || null };
});

/**
 * 账号资料缓存（stale-while-revalidate）：
 * 实测 mcp.me() 单次约 12 秒（MCP 上游慢）→ 首页三个指标卡要等 12 秒才出数字。
 * 策略：有缓存就先秒回缓存值，同时在后台静默刷新；过期（>5 分钟）才等待真实调用。
 */
let _meCache = { at: 0, data: null, inflight: null };
const ME_TTL_MS = 5 * 60 * 1000;
function refreshMe() {
  _meCache.inflight = mcp
    .me()
    .then((r) => {
      const b = r?.data?.data || r?.data || {};
      _meCache = { at: Date.now(), data: b, inflight: null };
      return b;
    })
    .catch((e) => {
      _meCache.inflight = null;
      throw e;
    });
  return _meCache.inflight;
}
async function mePayload() {
  const age = Date.now() - _meCache.at;
  if (_meCache.data) {
    if (age >= ME_TTL_MS && !_meCache.inflight) refreshMe().catch(() => {}); // 后台刷新，不阻塞
    return { payload: _meCache.data, cached: true, cacheAgeMs: age };
  }
  if (!_meCache.inflight) refreshMe();
  return { payload: await _meCache.inflight, cached: false, cacheAgeMs: 0 };
}
function shapeMe(b) {
  const ub = b.userBasicInfo || {};
  const inter = {};
  for (const i of (b.interactions || [])) inter[i.type] = Number(i.count || 0);
  return {
    ok: true,
    nickname: ub.nickname || '',
    redId: ub.redId || '',
    desc: ub.desc || '',
    avatar: ub.imageb || '',
    follows: inter.follows || 0,
    fans: inter.fans || 0,
    likes: inter.interaction || 0,
    noteCount: (b.feeds || []).length,
  };
}

app.get('/api/mcp/me', async (req) => {
  const force = String((req.query || {}).force || '') === '1';
  if (force) _meCache = { at: 0, data: null, inflight: null };
  const { payload, cached, cacheAgeMs } = await mePayload();
  return { ...shapeMe(payload), cached, cacheAgeMs };
});

// 我的笔记列表（用于数据洞察；互动数据来自列表卡片，成本低）
app.get('/api/mcp/my-notes', async () => {
  const r = await mcp.me();
  const b = r?.data?.data || r?.data || {};
  const feeds = b.feeds || [];
  return {
    ok: true,
    count: feeds.length,
    items: feeds.map((f) => {
      const nc = f.noteCard || {};
      const it = nc.interactInfo || {};
      return {
        id: f.id,
        xsecToken: f.xsecToken,
        title: nc.displayTitle || '',
        type: nc.type || 'normal',
        liked: Number(it.likedCount || 0),
        collected: Number(it.collectedCount || 0),
        comments: Number(it.commentCount || 0),
        cover: nc.cover?.urlDefault || nc.cover?.urlPre || null,
      };
    }),
  };
});

// 把小红书已有笔记导入文案库（真实历史内容 = 查重的比对源、周计划的参考）
app.post('/api/notes/import', async () => {
  const r = await mcp.me();
  const b = r?.data?.data || r?.data || {};
  const feeds = b.feeds || [];
  const ins = db.prepare(`INSERT INTO contents (source,title,body,tags,status,note_id,source_url,images,created_at,updated_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const findDup = db.prepare("SELECT id FROM contents WHERE note_id=? OR (title=? AND source='history')");
  let added = 0, skipped = 0;
  for (const f of feeds) {
    const nc = f.noteCard || {};
    const title = String(nc.displayTitle || '').trim();
    if (!title) { skipped++; continue; }
    if (findDup.get(f.id, title)) { skipped++; continue; }
    const cover = nc.cover?.urlDefault || nc.cover?.urlPre || '';
    ins.run('history', title, '', JSON.stringify([]), 'published', f.id,
            `https://www.xiaohongshu.com/explore/${f.id}`,
            JSON.stringify(cover ? [cover] : []), now(), now());
    added++;
  }
  log('info', 'contents', `导入历史笔记 ${added} 篇（跳过 ${skipped}）`);
  return { ok: true, added, skipped, total: feeds.length };
});

// ---------- 创作者中心（平台数据后台）：浏览量 / 涨粉 / 观看时长 ----------
// 这些指标平台只在创作者中心提供，MCP 里没有；登录态用同一个 cookie（.xiaohongshu.com 泛域）
const CREATOR_COOKIE = process.env.XHS_COOKIE_FILE
  || path.join(process.env.USERPROFILE || process.env.HOME || '', 'xiaohongshu-mcp-go', 'cookies.json');

function creatorHeaders() {
  let cookie = '';
  try {
    const raw = JSON.parse(fs.readFileSync(CREATOR_COOKIE, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.cookies || []);
    cookie = list.filter((c) => c && c.name).map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    throw new Error('读取登录态失败（cookies.json）: ' + e.message);
  }
  return {
    Cookie: cookie,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: 'https://creator.xiaohongshu.com/',
    Origin: 'https://creator.xiaohongshu.com',
    Accept: 'application/json, text/plain, */*',
  };
}

/**
 * 创作者中心取数（唯一通道）
 * 2026-09-24 加固：① 60 秒缓存（首页 + 数据洞察会同时打同一个接口）② 网络抖动重试 2 次
 * 实测首页加载时并发请求会出现 `fetch failed` → 趋势图直接显示错误，体验很差（且不是真·登录失效）
 */
const _galaxyCache = new Map();
const GALAXY_TTL_MS = 60 * 1000;
async function galaxy(pathname) {
  const hit = _galaxyCache.get(pathname);
  if (hit && Date.now() - hit.at < GALAXY_TTL_MS) return hit.data;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://creator.xiaohongshu.com' + pathname, {
        headers: creatorHeaders(),
        signal: AbortSignal.timeout(15000),
      });
      const text = await r.text();
      if (!r.ok) {
        const err = new Error(`创作者中心返回 ${r.status}`);
        err.status = r.status;
        if (r.status === 401 || r.status === 403) throw err; // 登录态问题，重试无意义
        lastErr = err;
      } else {
        const j = JSON.parse(text);
        _galaxyCache.set(pathname, { at: Date.now(), data: j });
        return j;
      }
    } catch (e) {
      lastErr = e;
      if (e.status === 401 || e.status === 403) throw e;
    }
    await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
  }
  throw lastErr || new Error('创作者中心请求失败');
}

const CREATOR_METRICS = [
  ['view_count', 'view_list', '浏览量'],
  ['home_view_count', 'home_view_list', '首页曝光'],
  ['like_count', 'like_list', '点赞'],
  ['collect_count', 'collect_list', '收藏'],
  ['comment_count', 'comment_list', '评论'],
  ['share_count', 'share_list', '分享'],
  ['rise_fans_count', 'rise_fans_list', '涨粉'],
];


/** 平台 date 可能是 'YYYY-MM-DD' / 10 位秒 / 13 位毫秒 → 统一成 'YYYY-MM-DD'
 *  （2026-09-24 修：AI 解读里曾出现裸时间戳「1788796800」） */
function dayOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const dt = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

function pickWindow(win) {
  if (!win) return null;
  const out = { summary: [], series: {} };
  for (const [totalKey, listKey, label] of CREATOR_METRICS) {
    const rate = win[totalKey.replace('_count', '_count_rate')];
    out.summary.push({ key: totalKey, label, total: win[totalKey], rate: rate });
    const series = (win[listKey] || []).map((p) => ({
      date: dayOf(p.date),
      count: p.count,
    }));
    out.series[totalKey] = series;
  }
  out.viewTimeAvg = win.view_time_avg;
  return out;
}

// 平台侧总览（近 7 天 / 近 30 天，含每日趋势）
app.get('/api/creator/overview', async () => {
  const j = await galaxy('/api/galaxy/creator/data/note_detail_new');
  const d = j?.data || {};
  return { ok: true, seven: pickWindow(d.seven), thirty: pickWindow(d.thirty) };
});

// 账号基础信息（粉丝/关注/获赞收藏）
app.get('/api/creator/profile', async () => {
  const j = await galaxy('/api/galaxy/creator/home/personal_info');
  return { ok: true, data: j?.data || null };
});

// ---------- 图片代理（小红书图片有防盗链，需带 Referer） ----------
app.get('/api/img', async (req, reply) => {
  const u = (req.query || {}).url;
  if (!u || !/^https?:\/\//.test(u)) {
    throw Object.assign(new Error('缺少合法的 url'), { status: 400 });
  }
  let r;
  try {
    r = await fetch(u, {
      headers: {
        Referer: 'https://www.xiaohongshu.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
  } catch (e) {
    r = null;
    log('warn', 'img', `封面请求异常：${String(e.message).slice(0, 60)}`);
  }
  if (!r || !r.ok) {
    // 小红书图片 URL 自带过期时间戳（形如 .../202609171712/...）→ 过期后上游 403/404。
    // 不给前端甩破图：回 1×1 透明 PNG + 短缓存，并记 warn 便于排查（重新抓取会刷新 URL）。
    log('warn', 'img', `封面取回失败 HTTP ${r ? r.status : 'ERR'}（多为 URL 已过期）：${String(u).slice(0, 70)}`);
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=600');
    return reply.send(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ));
  }
  const buf = Buffer.from(await r.arrayBuffer());
  reply.header('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(buf);
});

// ---------- AI 生图两档（R15） ----------
app.get('/api/image/status', async () => ({ ok: true, ...imagegenReady(), tiers: TIERS }));

// 只扩写提示词（不花生图钱，便于预览效果）
app.post('/api/image/expand', async (req) => {
  const b = req.body || {};
  const e = await expandPrompt(b.prompt || '', { style: b.style || '' });
  return { ok: true, ...e };
});

// 出图（会产生真实费用）
app.post('/api/image/generate', async (req) => {
  const b = req.body || {};
  return generateImage({
    prompt: b.prompt || '',
    tier: b.tier === 'fine' ? 'fine' : 'standard',
    ratio: b.ratio || '1:1',
    contentId: b.contentId || null,
  });
});

// ---------- 评论自动回复（R14） ----------
// 人设卡
app.get('/api/persona', async () => ({ ok: true, persona: getPersona() }));
app.post('/api/persona', async (req) => setPersona(req.body || {}));

// 禁用词表
app.get('/api/forbidden-words', async () => ({ ok: true, words: getForbidden() }));
app.post('/api/forbidden-words', async (req) => setForbidden((req.body || {}).words || []));

// 评论状态总览
app.get('/api/comments/stats', async () => ({ ok: true, stats: statsComments() }));

// 评论列表（可按状态筛）
app.get('/api/comments/list', async (req) => {
  const q = req.query || {};
  const limit = Math.min(Number(q.limit) || 100, 500);
  return { ok: true, items: listComments({ status: q.status || null, limit }) };
});

// 手动跑一轮（排障/演示用；线上由后台 5 分钟自动跑）
app.post('/api/comments/poll', async (req) => {
  const b = req.body || {};
  return pollOnce({ limit: Number(b.limit) || 20 });
});

// 规则匹配自测（不产生副作用，方便验证知识库命中）
app.post('/api/comments/match-test', async (req) => {
  const text = (req.body || {}).text || '';
  const hit = matchKnowledge(text);
  return { ok: true, text, matched: !!hit, score: hit ? hit.score : 0,
           source: hit ? (hit.source || 'manual') : null,
           docId: hit ? (hit.item.doc_id || null) : null,
           question: hit ? hit.item.question : null, answer: hit ? hit.item.answer : null };
});

// 人工待办
app.post('/api/comments/:id/approve', async (req) => approveComment(req.params.id));
app.post('/api/comments/:id/reply', async (req) => manualReply(req.params.id, (req.body || {}).text));

// 人工介入名单
app.get('/api/takeover', async () => ({ ok: true, items: listTakeover() }));
app.post('/api/takeover', async (req) => {
  const b = req.body || {};
  if (!b.userId) throw Object.assign(new Error('缺少 userId'), { status: 400 });
  return takeover(b.userId, b.nickname || '', b.reason || '手动加入');
});
app.delete('/api/takeover/:userId', async (req) => resumeAuto(req.params.userId));

// ---------- 手工填报（R13：咨询数/到店数） ----------
app.get('/api/manual-metrics', async (req) => {
  const days = Math.min(Number((req.query || {}).days) || 30, 365);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const items = db.prepare('SELECT * FROM manual_metrics WHERE date >= ? ORDER BY date DESC').all(from);
  const sum = db.prepare('SELECT COALESCE(SUM(inquiries),0) AS i, COALESCE(SUM(visits),0) AS v FROM manual_metrics WHERE date >= ?').get(from);
  return { ok: true, days, items, total: { inquiries: sum.i, visits: sum.v } };
});

app.post('/api/manual-metrics', async (req) => {
  const b = req.body || {};
  const date = String(b.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('日期格式必须是 YYYY-MM-DD'), { status: 400 });
  }
  const toInt = (v, name) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw Object.assign(new Error(`${name} 必须是非负整数`), { status: 400 });
    }
    return n;
  };
  const inquiries = toInt(b.inquiries, '咨询数');
  const visits = toInt(b.visits, '到店数');

  // 同日唯一 → 覆盖而非新增（幂等）
  db.prepare(`INSERT INTO manual_metrics (date, inquiries, visits, note, created_at, updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET
      inquiries=excluded.inquiries, visits=excluded.visits,
      note=excluded.note, updated_at=excluded.updated_at`)
    .run(date, inquiries, visits, b.note || '', now(), now());
  return { ok: true, date, inquiries, visits };
});

app.delete('/api/manual-metrics/:date', async (req) => {
  const date = req.params.date;
  const info = db.prepare('DELETE FROM manual_metrics WHERE date = ?').run(date);
  if (info.changes === 0) throw Object.assign(new Error('该日期没有记录'), { status: 404 });
  return { ok: true };
});

// ---------- 复盘报告与建议（R12） ----------
app.post('/api/report/snapshots', async () => collectSnapshots());
app.get('/api/report', async (req) => {
  const q = req.query || {};
  return buildReport({ days: Number(q.days) || 30, useAI: q.ai !== '0' });
});
app.post('/api/report', async (req) => {
  const b = req.body || {};
  return buildReport({ days: Number(b.days) || 30, useAI: b.useAI !== false });
});

// ---------- 对标账号监控（R11） ----------
app.get('/api/competitors', async () => ({ ok: true, items: analyzeAll() }));

app.post('/api/competitors/discover', async (req) => {
  const b = req.body || {};
  return discover({
    threshold: Number(b.threshold) || 3,
    min: Number(b.min) || 5,
    max: Number(b.max) || 8,
  });
});

app.post('/api/competitors', async (req) => {
  const b = req.body || {};
  return addCompetitor({ userId: b.userId, nickname: b.nickname, note: b.note });
});

app.delete('/api/competitors/:id', async (req) => removeCompetitor(req.params.id));

app.post('/api/competitors/:id/analyze', async (req) => {
  const c = db.prepare('SELECT * FROM competitors WHERE id = ?').get(Number(req.params.id));
  if (!c) throw Object.assign(new Error('不存在'), { status: 404 });
  return analyzeAuthor(c.user_id);
});

// 深度分析：拉笔记详情补发布时间（慢，约 13.5s/条）
app.post('/api/competitors/:id/deep-analyze', async (req) => {
  const c = db.prepare('SELECT * FROM competitors WHERE id = ?').get(Number(req.params.id));
  if (!c) throw Object.assign(new Error('不存在'), { status: 404 });
  const b = req.body || {};
  const r = await enrichTimes(c.user_id, { limit: Number(b.limit) || 6, gapMs: Number(b.gapMs) || 4000 });
  return { ...r, analysis: analyzeAuthor(c.user_id) };
});

// 用昵称搜索补充该账号样本（不新增作者）
app.post('/api/competitors/enrich', async (req) => {
  const nick = (req.body || {}).nickname;
  if (!nick) throw Object.assign(new Error('缺少 nickname'), { status: 400 });
  return enrich(nick);
});

// ---------- 发布（M1：状态机 + 定时 + 预检 + 建议时间） ----------
// tasks 列表：带内容快照（title/body/images/tags）供展开 + 手机预览；支持 ?from&to（YYYY-MM-DD）
app.get('/api/publish/tasks', async (req) => {
  const q = req.query || {};
  return { ok: true, items: listTasks({ from: q.from || null, to: q.to || null, limit: Number(q.limit) || 200 }) };
});

app.get('/api/publish/best-time', async () => bestPublishTime());

app.post('/api/publish/precheck', async (req) => {
  const contentId = Number((req.body || {}).contentId);
  if (!contentId) throw Object.assign(new Error('缺少 contentId'), { status: 400 });
  return precheck(contentId);
});

// 排期（不产生真实副作用）
app.post('/api/publish/schedule', async (req) => {
  const b = req.body || {};
  if (!b.contentId || !b.scheduledAt) throw Object.assign(new Error('缺少 contentId 或 scheduledAt'), { status: 400 });
  return schedulePublish(Number(b.contentId), b.scheduledAt);
});

app.post('/api/publish/tasks/:id/cancel', async (req) => cancelTask(Number(req.params.id)));

// 人工确认发布（R20）：自动发送关闭时，到点任务转「待确认」，由此确认后发送
app.post('/api/publish/tasks/:id/confirm', async (req) => confirmTask(Number(req.params.id)));

// ⚠️ 真实发布（会发到账号上）—— 必须显式调用
app.post('/api/publish/tasks/:id/run', async (req) => {
  const id = Number(req.params.id);
  log('warn', 'publish', `收到真实发布请求 #${id}`);
  return runTask(id, { skipPrecheck: (req.body || {}).skipPrecheck === true });
});

// 立即发布（未排期时：建任务 + 马上跑）
app.post('/api/publish/now', async (req) => {
  const contentId = Number((req.body || {}).contentId);
  if (!contentId) throw Object.assign(new Error('缺少 contentId'), { status: 400 });
  const s = schedulePublish(contentId, now());
  const r = await runTask(s.taskId);
  return { ...r, taskId: s.taskId };
});

// 手动触发一次调度（排障用）
app.post('/api/publish/tick', async () => { await tick(); return { ok: true, tasks: listTasks() }; });

// 自动发送 / 发布保护（R20 真开关：存本机 settings 表，刷新/重启后仍生效）
app.get('/api/publish/settings', async () => ({ ok: true, ...publishSettings() }));

app.post('/api/publish/settings', async (req) => {
  const b = req.body || {};
  const asBool = (v) => v === true || v === 1 || v === '1' || v === 'true';
  const patch = {};
  if (b.autoSend !== undefined) patch.autoSend = asBool(b.autoSend);
  if (b.protect !== undefined) patch.protect = asBool(b.protect);
  return { ok: true, ...setPublishSettings(patch) };
});

// 兼容旧前端：enabled ⇔ 自动发送（R20 起旧「暂停调度」语义由「自动发送」承接）
app.get('/api/publish/scheduler', async () => ({ ok: true, ...schedulerState() }));

app.post('/api/publish/scheduler', async (req) => {
  const b = req.body || {};
  const asBool = (v) => v === true || v === 1 || v === '1' || v === 'true';
  if (b.autoSend !== undefined) setPublishSettings({ autoSend: asBool(b.autoSend) });
  else if (b.enabled !== undefined) setPublishSettings({ autoSend: asBool(b.enabled) });
  return { ok: true, ...schedulerState() };
});

// ---------- 查重门禁（60%，本地计算零成本） ----------
app.post('/api/duplicate/check', async (req) => {
  const b = req.body || {};
  const r = checkDuplicate({ title: b.title || '', body: b.body || '' }, {
    threshold: Number(b.threshold) || 0.6,
    excludeId: b.excludeId || null,
  });
  return {
    ok: true,
    score: Math.round(r.score * 100),
    threshold: r.threshold * 100,
    pass: r.pass,
    parts: {
      title: Number((r.parts.title * 100).toFixed(0)),
      structure: Number((r.parts.structure * 100).toFixed(0)),
      viewpoint: Number((r.parts.viewpoint * 100).toFixed(0)),
      expression: Number((r.parts.expression * 100).toFixed(0)),
    },
    mostSimilar: r.top ? { id: r.top.id, title: r.top.title, score: Math.round(r.top.score * 100) } : null,
    compared: r.compared,
  };
});

// 批量扫描（把草稿全过一遍门禁，回写 dup_score）
app.post('/api/duplicate/scan', async () => {
  const rows = db.prepare("SELECT id, title, body FROM contents WHERE status IN ('draft','approved') ORDER BY id DESC").all();
  let pass = 0, fail = 0;
  const upd = db.prepare('UPDATE contents SET dup_score=?, dup_with=?, updated_at=? WHERE id=?');
  for (const r of rows) {
    const d = checkDuplicate({ title: r.title, body: r.body }, { threshold: 0.6, excludeId: r.id });
    upd.run(d.score, d.top ? d.top.id : null, now(), r.id);
    if (d.pass) pass++; else fail++;
  }
  log('info', 'dedupe', `扫描 ${rows.length} 条：通过 ${pass}，超标 ${fail}`);
  return { ok: true, total: rows.length, pass, fail };
});

// ---------- AI 能力（DeepSeek） ----------
app.get('/api/ai/status', async () => ({ ok: true, deepseek: deepseekInfo() }));

// 生成内容（R19 统一入口）。mode=auto|seven|single（auto：无生成内容→7 天，有→1 篇）；
// 缺省 mode 时兼容旧参数 days/startDay。withImages=true → 生成后逐篇自动配图；
// schedule={startDate,time} → 生成后按天直接排期（时间已过会拒绝）。dryRun=true 只预览不落库。
app.post('/api/generate', async (req) => {
  const b = req.body || {};
  if (!deepseekReady()) {
    throw Object.assign(new Error('未配置 DeepSeek API Key（server/.env 的 DEEPSEEK_API_KEY）'), { status: 400 });
  }
  const gen = await runGeneration({
    userIntent: b.userIntent || '',
    postsPerDay: Math.min(Math.max(Number(b.postsPerDay) || 1, 1), 9),
    mode: ['auto', 'seven', 'single'].includes(b.mode) ? b.mode : '',
    days: Number(b.days) || 0,
    startDay: Number(b.startDay) || 0,
    dryRun: !!b.dryRun,
    withImages: !!b.withImages,
    imageTier: b.imageTier === 'fine' ? 'fine' : 'standard',
    imageRatio: b.imageRatio || '1:1',
    imageLimit: Number(b.imageLimit) || 0,
  });
  // 没显式给排期 → 用运营策略里的发布时间表（post_time）给一个建议
  if (!b.dryRun && !b.schedule) {
    try {
      const st = getStrategy();
      const hhmm = (st && st.postTime) || '';
      if (hhmm) {
        const d = new Date(); d.setDate(d.getDate() + 1);
        const p = (n) => String(n).padStart(2, '0');
        gen.suggestedSchedule = { startDate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: hhmm, fromStrategy: true };
      }
    } catch { /* ignore */ }
  }
  if (!b.dryRun && b.schedule && Array.isArray(gen.items) && gen.items.length) {
    gen.scheduled = scheduleBatch(gen.items, { startDate: b.schedule.startDate, time: b.schedule.time });
    gen.scheduledOk = gen.scheduled.filter((x) => x.ok).length;
  }
  return gen;
});

// 生成前的参考系预览（让用户看到这次用了哪些参考）
app.get('/api/generate/context', async () => {
  await refreshPlatformRef(); // §0：把「平时数据」也取出来，生成前就能看到用了什么
  return {
  ok: true,
  strategy: { ...getStrategy(), text: strategyText() },
  platform: { text: platformText() },
  positioning: getPositioning(),
  goodPosts: getGoodPosts(8).map((g) => ({
    title: g.title, liked: g.liked, collected: g.collected, rate: Number((g.rate * 100).toFixed(0)),
  })),
  trends: getTrends(10),
  };
});

// ---------- 行业热榜抓取（每天 2 次自动 + 手动触发） ----------
const TREND_KEYWORDS = ['化妆教程', '新手化妆', '底妆', '眼妆', '通勤妆'];
const TREND_PER_KEYWORD = 20;
const TREND_GAP_MS = 3500; // 关键词之间间隔，防风控

function trendKeywords() {
  const row = db.prepare("SELECT value FROM settings WHERE key='trend_keywords'").get();
  if (!row || !row.value) return TREND_KEYWORDS;
  try {
    const arr = JSON.parse(row.value);
    return Array.isArray(arr) && arr.length ? arr : TREND_KEYWORDS;
  } catch { return TREND_KEYWORDS; }
}

async function runScrape(keywords) {
  const list = keywords && keywords.length ? keywords : trendKeywords();
  const results = [];
  // upsert：已存在的笔记刷新互动数与 token（token 是拉详情的必需品）
  const ins = db.prepare(`INSERT INTO trends
    (keyword,note_id,title,author,author_id,liked,collected,commented,cover,url,note_time,xsec_token,scraped_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(note_id) DO UPDATE SET
      liked=excluded.liked, collected=excluded.collected, commented=excluded.commented,
      xsec_token=excluded.xsec_token, scraped_at=excluded.scraped_at`);
  for (const kw of list) {
    try {
      const r = await mcp.search(kw);
      const items = r?.data?.feeds || [];
      let saved = 0;
      for (const it of items.slice(0, TREND_PER_KEYWORD)) {
        const nc = it.noteCard || it;
        const ii = nc.interactInfo || {};
        const info = ins.run(
          kw, it.id || nc.noteId || '',
          nc.displayTitle || nc.title || '',
          (nc.user && nc.user.nickname) || '',
          (nc.user && nc.user.userId) || '',
          Number(ii.likedCount) || 0,
          Number(ii.collectedCount) || 0,
          Number(ii.commentCount) || 0,
          (nc.cover && (nc.cover.urlDefault || nc.cover.urlPre)) || '',
          `https://www.xiaohongshu.com/explore/${it.id || nc.noteId || ''}`,
          nc.time ? String(nc.time) : '',
          it.xsecToken || (it.xsec_token) || '',
          now(),
        );
        if (info.changes > 0) saved++;
      }
      results.push({ keyword: kw, fetched: items.length, saved });
    } catch (e) {
      results.push({ keyword: kw, fetched: 0, saved: 0, error: String(e.message || e).slice(0, 100) });
    }
    await new Promise((res) => setTimeout(res, TREND_GAP_MS));
  }
  const total = results.reduce((a, b) => a + (b.saved || 0), 0);
  log('info', 'trends', `热榜抓取完成：新增 ${total} 条（${list.length} 个关键词）`);
  return { ok: true, at: now(), total, results };
}

// 手动触发
app.post('/api/trends/scrape', async (req) => runScrape((req.body || {}).keywords));

// 热榜列表（按热度）
app.get('/api/trends', async (req) => {
  const limit = Math.min(Number((req.query || {}).limit) || 50, 200);
  const rows = db.prepare(`SELECT * FROM trends ORDER BY (liked + collected * 1.5 + commented * 2) DESC, id DESC LIMIT ?`).all(limit);
  const stats = db.prepare('SELECT COUNT(*) AS n, MAX(scraped_at) AS last, COUNT(DISTINCT keyword) AS kws FROM trends').get();
  return { ok: true, count: rows.length, total: stats.n, lastScrapedAt: stats.last, keywordCount: stats.kws, items: rows };
});

// 关键词配置
app.get('/api/trends/keywords', async () => ({ ok: true, keywords: trendKeywords() }));
app.post('/api/trends/keywords', async (req) => {
  const kws = (req.body || {}).keywords || [];
  db.prepare("INSERT INTO settings (key,value,updated_at) VALUES ('trend_keywords',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .run(JSON.stringify(kws), now());
  return { ok: true, keywords: kws };
});

// 每天 09:30 / 20:30 自动抓取（错开平台高峰，降低风控概率）
const SCRAPE_SLOTS = [[9, 30], [20, 30]];
let lastScrapeSlot = '';
setInterval(() => {
  const d = new Date();
  const slot = `${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
  const hit = SCRAPE_SLOTS.some(([h, m]) => d.getHours() === h && d.getMinutes() === m);
  if (hit && lastScrapeSlot !== slot) {
    lastScrapeSlot = slot;
    log('info', 'trends', '定时抓取触发');
    runScrape().catch((e) => log('error', 'trends', '定时抓取失败: ' + e.message));
  }
}, 60 * 1000);

// ---------- 运营计划表（账号定位 + 内容支柱 = 内容生成的总纲） ----------
const DEFAULT_PILLARS = [
  { name: '化妆技巧（方法展示）', ratio: 35, note: '涨粉主力、收藏最高' },
  { name: '学员改造案例', ratio: 25, note: '信任峰值、转化最强' },
  { name: '产品/工具测评', ratio: 15, note: '延伸场景' },
  { name: '行业认知/避坑', ratio: 15, note: '树立专业度' },
  { name: '课程/活动信息', ratio: 10, note: '直接转化' },
];

app.get('/api/positioning', async () => {
  const row = db.prepare('SELECT * FROM positioning ORDER BY id DESC LIMIT 1').get();
  if (!row) {
    return { ok: true, data: null, pillars: DEFAULT_PILLARS, isDefault: true };
  }
  let pillars = [];
  try { pillars = JSON.parse(row.pillars || '[]'); } catch { pillars = []; }
  return { ok: true, data: row, pillars: pillars.length ? pillars : DEFAULT_PILLARS, isDefault: !pillars.length };
});

app.post('/api/positioning', async (req) => {
  const b = req.body || {};
  const pillars = JSON.stringify(b.pillars || DEFAULT_PILLARS);
  const exist = db.prepare('SELECT id FROM positioning ORDER BY id DESC LIMIT 1').get();
  if (exist) {
    db.prepare(`UPDATE positioning SET persona=?, audience=?, pillars=?, tone=?, selling=?, goal=?, updated_at=? WHERE id=?`)
      .run(b.persona || '', b.audience || '', pillars, b.tone || '', b.selling || '', b.goal || '', now(), exist.id);
  } else {
    db.prepare(`INSERT INTO positioning (persona,audience,pillars,tone,selling,goal,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(b.persona || '', b.audience || '', pillars, b.tone || '', b.selling || '', b.goal || '', now());
  }
  log('info', 'positioning', '账号定位已保存');
  return { ok: true };
});

// 账号配置：每天发几条（决定 7 天窗口的产出总量）
app.get('/api/plan-config', async () => {
  const row = db.prepare("SELECT value FROM settings WHERE key='posts_per_day'").get();
  return { ok: true, postsPerDay: row ? Number(row.value) || 1 : 1 };
});

app.post('/api/plan-config', async (req) => {
  const n = Number((req.body || {}).postsPerDay) || 1;
  db.prepare("INSERT INTO settings (key,value,updated_at) VALUES ('posts_per_day',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .run(String(n), now());
  return { ok: true, postsPerDay: n };
});

// ---------- 内容调研：搜索 / 详情（只读）----------
app.get('/api/mcp/search', async (req) => {
  const { keyword } = req.query || {};
  if (!keyword) throw Object.assign(new Error('缺少 keyword'), { status: 400 });
  const r = await mcp.search(keyword);
  const feeds = r?.data?.feeds || [];
  return {
    ok: true, count: feeds.length,
    items: feeds.map((f) => {
      const nc = f.noteCard || {};
      const it = nc.interactInfo || {};
      return {
        id: f.id, xsecToken: f.xsecToken,
        title: nc.displayTitle, type: nc.type,
        author: nc.user?.nickname, authorId: nc.user?.userId,
        liked: Number(it.likedCount || 0),
        cover: nc.cover?.urlDefault || nc.cover?.urlPre || null,
      };
    }),
  };
});

app.post('/api/mcp/detail', async (req) => {
  const { feedId, xsecToken, loadAllComments } = req.body || {};
  if (!feedId) throw Object.assign(new Error('缺少 feedId'), { status: 400 });
  const r = await mcp.feedDetail(feedId, xsecToken, !!loadAllComments);
  const note = r?.data?.data?.note || {};
  return {
    ok: true,
    note: {
      id: note.noteId, title: note.title, desc: note.desc, type: note.type,
      time: note.time, author: note.user?.nickname,
      images: (note.imageList || []).map((i) => i.urlDefault || i.urlPre),
    },
    metrics: extractMetrics(r),
    comments: r?.data?.data?.comments || r?.data?.comments || [],
  };
});

// ---------- 文案库 ----------
app.get('/api/contents', async (req) => {
  const { status, limit = 100 } = req.query || {};
  // R19：带出「是否已有发布任务」→ 前端才知道这条草稿会不会被 7 天清理（与后端 purge 判据一致）
  const base = `
    SELECT c.*,
      (SELECT COUNT(*) FROM publish_tasks t
        WHERE t.content_id = c.id
          AND t.status IN ('pending','awaiting_confirm','precheck','publishing','done','failed')) AS task_count
    FROM contents c`;
  const rows = status
    ? db.prepare(`${base} WHERE c.status=? ORDER BY c.id DESC LIMIT ?`).all(status, Number(limit))
    : db.prepare(`${base} ORDER BY c.id DESC LIMIT ?`).all(Number(limit));
  return {
    ok: true,
    count: rows.length,
    items: rows.map((r) => ({ ...r, scheduled: Number(r.task_count || 0) > 0 })),
  };
});

app.post('/api/contents', async (req) => {
  const c = req.body || {};
  const r = db.prepare(`INSERT INTO contents (source,title,body,tags,cover_text,images,status,created_at,updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(c.source || 'manual', c.title || '', c.body || '', JSON.stringify(c.tags || []),
         c.coverText || '', JSON.stringify(c.images || []), c.status || 'draft', now(), now());
  return { ok: true, id: Number(r.lastInsertRowid) };
});

app.patch('/api/contents/:id', async (req) => {
  const id = Number(req.params.id);
  const c = req.body || {};
  const sets = [], vals = [];
  for (const k of ['title', 'body', 'cover_text', 'status']) {
    if (c[k] !== undefined) { sets.push(`${k}=?`); vals.push(c[k]); }
  }
  for (const k of ['tags', 'images']) {
    if (c[k] !== undefined) { sets.push(`${k}=?`); vals.push(JSON.stringify(c[k])); }
  }
  // 查重结果回写（编辑器里点"立即查重"后保存）
  for (const k of ['dup_score', 'dup_with', 'day_index']) {
    if (c[k] !== undefined) { sets.push(`${k}=?`); vals.push(c[k]); }
  }
  // 收藏（R19）：收藏后不参与 7 天自动清理（白名单显式支持，勿并入上面的循环）
  if (c.favorite !== undefined) { sets.push('favorite=?'); vals.push(c.favorite ? 1 : 0); }
  if (!sets.length) return { ok: true, noop: true };
  sets.push('updated_at=?'); vals.push(now(), id);
  db.prepare(`UPDATE contents SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return { ok: true, id };
});

// ---------- 周计划 / 大纲 ----------
app.get('/api/plans', async () =>
  ({ ok: true, items: db.prepare('SELECT * FROM plans ORDER BY id DESC LIMIT 20').all() }));

app.post('/api/plans', async (req) => {
  const p = req.body || {};
  const r = db.prepare('INSERT INTO plans (week_start,theme,nodes,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(p.weekStart || '', p.theme || '', JSON.stringify(p.nodes || []), p.status || 'drafting', now(), now());
  return { ok: true, id: Number(r.lastInsertRowid) };
});

// ---------- 指标（M4）----------
app.get('/api/metrics', async (req) => {
  const { noteId, limit = 200 } = req.query || {};
  const rows = noteId
    ? db.prepare('SELECT * FROM metrics WHERE note_id=? ORDER BY date DESC LIMIT ?').all(noteId, Number(limit))
    : db.prepare('SELECT * FROM metrics ORDER BY id DESC LIMIT ?').all(Number(limit));
  return { ok: true, count: rows.length, items: rows };
});

// 把某篇笔记的互动数据抓下来存快照
app.post('/api/metrics/collect', async (req) => {
  const { feedId, xsecToken } = req.body || {};
  const r = await mcp.feedDetail(feedId, xsecToken, false);
  const m = extractMetrics(r);
  db.prepare(`INSERT INTO metrics (note_id,date,likes,collects,comments,shares,raw,created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(m.note_id, new Date().toISOString().slice(0, 10), m.likes, m.collects, m.comments, m.shares,
         JSON.stringify(m), now());
  return { ok: true, metrics: m };
});

// ---------- 知识库（M5/M6）----------
app.get('/api/knowledge', async () =>
  ({ ok: true, items: db.prepare('SELECT * FROM knowledge ORDER BY id DESC').all() }));

app.post('/api/knowledge', async (req) => {
  const k = req.body || {};
  // keywords 既可能是数组也可能是字符串；node:sqlite 不接受数组绑定 → 统一转 JSON 字符串
  let kws = k.keywords;
  if (Array.isArray(kws)) kws = JSON.stringify(kws);
  else if (kws === undefined || kws === null) kws = '[]';
  else kws = String(kws);
  if (!kws.trim()) kws = '[]';
  if (!String(k.question || '').trim() && !String(k.answer || '').trim()) {
    throw Object.assign(new Error('问题和答案不能同时为空'), { status: 400 });
  }
  const r = db.prepare('INSERT INTO knowledge (category,question,answer,keywords,enabled,created_at) VALUES (?,?,?,?,1,?)')
    .run(k.category || '', k.question || '', k.answer || '', kws, now());
  return { ok: true, id: Number(r.lastInsertRowid) };
});

// ---------- 评论与回复记录（M6）----------
app.get('/api/comments', async (req) => {
  const { status, limit = 100 } = req.query || {};
  const rows = status
    ? db.prepare('SELECT * FROM comments WHERE reply_status=? ORDER BY id DESC LIMIT ?').all(status, Number(limit))
    : db.prepare('SELECT * FROM comments ORDER BY id DESC LIMIT ?').all(Number(limit));
  return { ok: true, count: rows.length, items: rows };
});

// ---------- 设置（密钥只回掩码）----------
// ---------- R23 互动区：评论自动回复总开关 ----------
app.get('/api/reply/settings', async () => ({ ok: true, enabled: isReplyEnabled() }));
app.post('/api/reply/settings', async (req) => setReplyEnabled(!!(req.body || {}).enabled));

app.get('/api/settings', async () => {
  const rows = db.prepare('SELECT key,masked,updated_at FROM settings').all();
  return { ok: true, items: rows };
});

app.post('/api/settings', async (req) => {
  const { key, value } = req.body || {};
  if (!key) throw Object.assign(new Error('缺少 key'), { status: 400 });
  const v = String(value || '');
  const masked = v.length > 8 ? `${v.slice(0, 4)}****${v.slice(-4)}` : '****';
  db.prepare(`INSERT INTO settings (key,value,masked,updated_at) VALUES (?,?,?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, masked=excluded.masked, updated_at=excluded.updated_at`)
    .run(key, v, masked, now());
  return { ok: true, key, masked };
});

// ---------- 启动 ----------
try {
  startScheduler();
startPoller();
await app.listen({ port: PORT, host: HOST });
  log('info', 'server', `启动成功 http://${HOST}:${PORT}`);
  console.log(`[绮点运营平台] 本地服务已启动 -> http://${HOST}:${PORT}`);
  console.log('  健康检查:  GET  /api/health');
  console.log('  MCP 状态:  GET  /api/mcp/status');
  console.log('  搜索笔记:  GET  /api/mcp/search?keyword=美妆');
} catch (e) {
  console.error('启动失败:', e);
  process.exit(1);
}
