/**
 * 密钥与渠道设置（客户机没有 Hermes → 必须在界面里手动填 Key 并当场检查能不能用）
 *  - GET  /api/keys/status  当前密钥状态（只回掩码，不回明文）
 *  - POST /api/keys         写入 server/.env（就地改行，不破坏注释）→ 立刻 reload，免重启
 *  - POST /api/keys/test    当场验证：DeepSeek 真发一次最小请求；生图渠道校验 Key+模型可达
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, now, log } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../.env');

function readEnvFile() {
  try { return fs.readFileSync(ENV_PATH, 'utf8'); } catch { return ''; }
}

/** 就地 upsert：保留注释与其他键，只改目标键 */
export function writeEnv(pairs = {}) {
  let text = readEnvFile();
  if (!text) text = '# 绮点 AI 小红书运营平台 · 本机环境变量（只存本机，禁止提交仓库）\n';
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined || v === null) continue;
    const line = `${k}=${String(v).trim()}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, line);
    else text = text.replace(/\s*$/, '\n') + line + '\n';
  }
  fs.writeFileSync(ENV_PATH, text, 'utf8');
  log('info', 'keys', `已写入 .env：${Object.keys(pairs).join(', ')}`);
  return true;
}

/** 预览用：哪些键已配置（只给掩码） */
function mask(v) {
  const s = String(v || '');
  if (!s) return null;
  return s.length <= 10 ? s.slice(0, 3) + '***' : s.slice(0, 6) + '…' + s.slice(-4);
}

export async function registerKeysApi(app, deps) {
  const { deepseekInfo, reloadDeepseek, chatOnce, imageStatus, reloadImage, testImageChannel } = deps;

  app.get('/api/keys/status', async () => {
    const env = {};
    for (const line of readEnvFile().split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return {
      ok: true,
      deepseek: { ...deepseekInfo(), base: env.DEEPSEEK_BASE || '(默认 https://api.deepseek.com)' },
      image: imageStatus(),
      envKeys: Object.fromEntries(Object.keys(env).map((k) => [k, mask(env[k])])),
    };
  });

  app.post('/api/keys', async (req) => {
    const b = req.body || {};
    const pairs = {};
    if (b.deepseekKey) pairs.DEEPSEEK_API_KEY = b.deepseekKey;
    if (b.deepseekBase) pairs.DEEPSEEK_BASE = b.deepseekBase;
    if (b.deepseekModel) pairs.DEEPSEEK_MODEL = b.deepseekModel;
    if (b.imageKey) pairs.APIKIKI_API_KEY = b.imageKey;
    if (b.imageBase) pairs.APIKIKI_BASE_URL = b.imageBase;
    if (b.imageProvider) pairs.IMAGE_PROVIDER = b.imageProvider;
    if (b.imageModel) pairs.IMAGE_MODEL = b.imageModel;
    if (!Object.keys(pairs).length) throw Object.assign(new Error('没有要写入的字段'), { status: 400 });
    writeEnv(pairs);
    reloadDeepseek();
    reloadImage();
    return { ok: true, saved: Object.keys(pairs), deepseek: deepseekInfo(), image: imageStatus() };
  });

  // 当场检查能不能用
  app.post('/api/keys/test', async (req) => {
    const target = String((req.body || {}).target || 'all');
    const out = {};
    if (target === 'deepseek' || target === 'all') {
      const t0 = Date.now();
      try {
        const r = await chatOnce([{ role: 'user', content: '只回复两个字：可用' }], { maxTokens: 16, temperature: 0 });
        out.deepseek = { ok: true, ms: Date.now() - t0, sample: String(r.content || '').slice(0, 20) };
      } catch (e) {
        out.deepseek = { ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) };
      }
    }
    if (target === 'image' || target === 'all') {
      const t0 = Date.now();
      try {
        const r = await testImageChannel();
        out.image = { ok: !!r.ok, ms: Date.now() - t0, provider: r.provider, model: r.model, note: r.note || '' };
      } catch (e) {
        out.image = { ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 220) };
      }
    }
    return { ok: true, ...out };
  });
}
