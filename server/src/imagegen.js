/**
 * AI 生图两档（R15）
 *
 * 规格要点（01-spec R15 + 宪法红线 8）：
 *   - 档位1（标准档）：单张 ≤30 秒
 *   - 档位2（精细档）：提示词经 DeepSeek 扩写后生成，输出 4K
 *   - **不得用用户原始提示词直出**（红线 8）→ 两档都先经 DeepSeek 扩写
 *   - 产物进素材库并可挂到内容上
 *   - 渠道不可用（404/无渠道）→ 明确报错，不静默降级
 *
 * 调用方式：apikiki 中转的 Google 原生端点（见 ai-image-gen-ops 技能）
 *   - 必须用 v1beta 原生端点，OpenAI 兼容端点会静默忽略尺寸
 *   - trust_env=False 绕开本机代理，否则挂死
 *   - 图在 candidates[].content.parts[].inlineData.data
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, now, log } from './db.js';
import { chat } from './deepseek.js';
import { UPLOAD_DIR } from './assets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '.env');

function loadEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 无 .env */ }
  return { ...out, ...process.env };
}

const ENV = loadEnv();
const APIKIKI_KEY = ENV.APIKIKI_API_KEY || '';
const APIKIKI_BASE = (ENV.APIKIKI_BASE_URL || 'https://www.apikiki.com').replace(/\/$/, '');
const MODEL = 'gemini-3-pro-image-preview';

export const TIERS = {
  standard: { key: 'standard', name: '标准档', imageSize: '2K', note: '出图快，用于日常配图' },
  fine: { key: 'fine', name: '精细档', imageSize: '4K', note: '细节更好，用于正式封面/主图' },
};

export function imagegenReady() {
  return { ready: !!APIKIKI_KEY, provider: 'apikiki', model: MODEL, keyMasked: APIKIKI_KEY ? APIKIKI_KEY.slice(0, 6) + '…' + APIKIKI_KEY.slice(-4) : null };
}

/* ---------------- 提示词扩写（红线 8：不得直出原始提示词） ---------------- */

/**
 * 把用户的一句话/原始提示词扩写成适合生图的完整提示词。
 * @param {string} userPrompt 用户原始输入
 * @param {{style?:string, avoidText?:boolean}} opt
 */
export async function expandPrompt(userPrompt, { style = '', avoidText = true } = {}) {
  const raw = String(userPrompt || '').trim();
  if (!raw) throw Object.assign(new Error('提示词不能为空'), { status: 400 });

  const sys = `你是小红书配图提示词工程师。把用户的简短需求扩写成一段可用于生图模型的完整中文提示词。
要求：
1. 补齐画面主体、场景、构图、光线、色调、风格、质感
2. 保持用户原意，不改变主题
3. ${avoidText ? '画面中不要出现任何文字、字母、数字或 logo（重要：生图模型写中文小字必错）' : ''}
4. 只输出扩写后的提示词本身，不要解释、不要引号
5. 长度 80–180 字`;

  const usr = `用户需求：${raw}${style ? `\n期望风格：${style}` : ''}`;
  const r = await chat([
    { role: 'system', content: sys },
    { role: 'user', content: usr },
  ], { maxTokens: 500, temperature: 0.7, timeout: 60000 });

  const expanded = String(r.content || '').trim().replace(/^["'「]|["'」]$/g, '');
  if (!expanded) throw new Error('DeepSeek 扩写返回空');
  return { raw, expanded };
}

/* ---------------- 出图 ---------------- */

function extractImage(j) {
  for (const c of j.candidates || []) {
    for (const p of (c.content || {}).parts || []) {
      const d = (p.inlineData || {}).data || (p.inline_data || {}).data;
      if (d) return d;
    }
  }
  const d = (j.data || [])[0];
  if (d && d.b64_json) return d.b64_json;
  return null;
}

/**
 * 生成一张图并入库素材库。
 * @param {{prompt:string, tier?:'standard'|'fine', ratio?:string, contentId?:number, skipExpand?:boolean}} opt
 */
export async function generateImage({ prompt, tier = 'standard', ratio = '1:1', contentId = null, skipExpand = false }) {
  if (!APIKIKI_KEY) {
    throw Object.assign(new Error('未配置生图渠道（缺少 APIKIKI_API_KEY）'), { status: 400 });
  }
  const t = TIERS[tier];
  if (!t) throw Object.assign(new Error(`未知档位 ${tier}`), { status: 400 });

  const t0 = Date.now();

  // 红线 8：必须扩写（skipExpand 仅供内部调试）
  let finalPrompt = String(prompt || '').trim();
  let expandMs = 0;
  if (!skipExpand) {
    const e0 = Date.now();
    const e = await expandPrompt(finalPrompt);
    finalPrompt = e.expanded;
    expandMs = Date.now() - e0;
  }
  if (!finalPrompt) throw Object.assign(new Error('提示词为空'), { status: 400 });

  const body = {
    contents: [{ parts: [{ text: finalPrompt }] }],
    generationConfig: { imageConfig: { imageSize: t.imageSize, aspectRatio: ratio } },
  };

  const url = `${APIKIKI_BASE}/v1beta/models/${MODEL}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  let resp, text;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${APIKIKI_KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    text = await resp.text();
  } catch (e) {
    clearTimeout(timer);
    throw Object.assign(new Error(`生图请求失败（${Math.round((Date.now() - t0) / 1000)}s）：${e.message}`), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  // 渠道不可用要明确报错，不静默降级
  if (!resp.ok) {
    const hint = resp.status === 404 ? '（模型/渠道不存在）' : '';
    throw Object.assign(new Error(`生图渠道错误 HTTP ${resp.status}${hint}：${String(text).slice(0, 200)}`), { status: 502 });
  }

  let j;
  try { j = JSON.parse(text); } catch {
    throw Object.assign(new Error('生图返回非 JSON：' + String(text).slice(0, 160)), { status: 502 });
  }
  const b64 = extractImage(j);
  if (!b64) {
    throw Object.assign(new Error('生图返回里没有图片（可能是内容被拒或模型未出图）：' + JSON.stringify(j).slice(0, 200)), { status: 502 });
  }

  const buf = Buffer.from(b64, 'base64');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const fname = `gen_${tier}_${stamp}_${Math.random().toString(36).slice(2, 6)}.png`;
  const fpath = path.join(UPLOAD_DIR, fname);
  fs.writeFileSync(fpath, buf);

  const info = db.prepare(`INSERT INTO assets
    (kind, name, file_path, web_path, size, tags, prompt, content_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('generated', fname, fpath, `/uploads/${fname}`, buf.length,
         JSON.stringify(['AI生成', t.name]), finalPrompt, contentId, now());

  const elapsed = (Date.now() - t0) / 1000;
  log('info', 'imagegen', `${t.name} 出图完成 ${fname}（${elapsed.toFixed(0)}s，扩写占 ${(expandMs / 1000).toFixed(1)}s）`);

  return {
    ok: true,
    assetId: Number(info.lastInsertRowid),
    file: fpath,
    url: `/uploads/${fname}`,
    tier: t.key,
    tierName: t.name,
    imageSize: t.imageSize,
    ratio,
    promptRaw: String(prompt || '').trim(),
    promptExpanded: finalPrompt,
    spentMsTotal: Math.round(Date.now() - t0),
    spentMsExpand: expandMs,
    callMs: Math.round(Date.now() - t0 - expandMs),
  };
}
