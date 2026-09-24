/**
 * DeepSeek 封装（内容生成 / 复盘建议 / 评论回复 / 提示词丰富）
 *
 * 安全约定：
 *  - Key 只从本机 server/.env 读（或系统环境变量），**绝不出现在前端、日志、接口返回里**
 *  - 🔴 交付客户前必须替换/删除 Key（见 00_机制台账 的交付前检查清单）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const out = {};
  const p = path.join(__dirname, '..', '.env');
  try {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 没 .env 就靠系统环境变量 */ }
  return out;
}

const ENV = { ...loadEnvFile(), ...process.env };
let KEY = ENV.DEEPSEEK_API_KEY || '';
let BASE = (ENV.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
let MODEL = ENV.DEEPSEEK_MODEL || 'deepseek-chat';
/* ---- 界面手动填 Key 后热更新（免得客户为了换 Key 重启服务） ---- */
function readEnvFileNow() {
  const out = {};
  try {
    const t = require('node:fs').readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of t.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 无 .env */ }
  return out;
}

export function reloadKeys() {
  const e = { ...ENV, ...readEnvFileNow(), ...process.env };
  KEY = e.DEEPSEEK_API_KEY || '';
  BASE = (e.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
  MODEL = e.DEEPSEEK_MODEL || 'deepseek-chat';
  return deepseekInfo();
}


export function deepseekReady() {
  return !!KEY;
}

export function deepseekInfo() {
  return { ready: !!KEY, base: BASE, model: MODEL, keyMasked: KEY ? `${KEY.slice(0, 6)}…${KEY.slice(-4)}` : '' };
}

/**
 * 基础对话
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number,maxTokens?:number,json?:boolean,timeout?:number,model?:string}} opts
 */
export async function chat(messages, opts = {}) {
  if (!KEY) throw new Error('未配置 DEEPSEEK_API_KEY（请在 server/.env 填写）');
  const body = {
    model: opts.model || MODEL,
    messages,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 3000,
    stream: false,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 180000);
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${String(text).slice(0, 200)}`);
    const j = JSON.parse(text);
    return {
      content: j.choices?.[0]?.message?.content || '',
      usage: j.usage || null,
      model: j.model || body.model,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型输出里抠 JSON（模型常包一层 ```json） */
export function parseJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* 继续 */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  }
  return null;
}
