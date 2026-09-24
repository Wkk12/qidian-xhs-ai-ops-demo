# -*- coding: utf-8 -*-
"""B4：生图「检查」修准（apikiki 不支持 GET 单模型）——改成多路径探测 + 增加「试出一张」真验证"""
import io

ROOT = r"C:\Users\12543\xhs-ops-platform\server\src"

def load(n):
    with io.open(f"{ROOT}\\{n}", "r", encoding="utf-8", newline="") as f:
        return f.read()

def save(n, d, must):
    for m in must:
        assert m in d, f"{n} 校验失败：缺 {m!r}"
    with io.open(f"{ROOT}\\{n}", "w", encoding="utf-8", newline="") as f:
        f.write(d)
    print("  ✔", n)

def sub1(t, old, new, tag):
    crlf = "\r\n" in t
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert t.count(o) == 1, f"[{tag}] 锚点 count={t.count(o)}"
    return t.replace(o, n, 1)

# ---- imagegen.js：换掉 testImageChannel 的探测方式 + 加 testShot ----
I = load("imagegen.js")
old_start = I.index("/** 渠道可用性检查")
old_end = I.index("/* ---------------- 提示词扩写")
NEW = '''/**
 * 渠道可用性检查（不产生生图费用）
 * 2026-09-24 实测修正：apikiki 的 `/v1beta/models/<model>` **不支持 GET**（会回 Invalid URL），
 * 所以这里改成多路径探测：先试模型列表端点，再退回单模型端点，全部不通时如实报错并提示用「试出一张」验证。
 */
export async function testImageChannel() {
  const p = PROVIDERS[IMAGE_PROVIDER] || PROVIDERS.apikiki;
  if (!IMAGE_KEY) throw new Error('未填生图渠道 Key');
  if (!IMAGE_BASE) throw new Error('未填生图渠道 Base URL（qweapi 这类中转必须自己填）');
  const H = { Authorization: 'Bear' + 'er ' + IMAGE_KEY };
  const urls = p.endpoint === 'openai-images'
    ? [`${IMAGE_BASE}/models`, `${IMAGE_BASE}/v1/models`]
    : [`${IMAGE_BASE}/v1beta/models`, `${IMAGE_BASE}/v1/models`, `${IMAGE_BASE}/v1beta/models/${MODEL}`];
  const tried = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      tried.push(`${u} → HTTP ${r.status}`);
      if (!r.ok) continue;
      let hasModel = null;
      try {
        const j = JSON.parse(text);
        const list = j.data || j.models || [];
        if (Array.isArray(list) && list.length) {
          hasModel = list.some((m) => String(m.id || m.name || '').includes(MODEL));
        }
      } catch { hasModel = null; }
      return {
        ok: true, provider: IMAGE_PROVIDER, model: MODEL, base: IMAGE_BASE,
        checkedVia: u, modelInList: hasModel,
        note: hasModel === false
          ? `Key 可用，但模型列表里没有 ${MODEL}（可能没开通渠道）`
          : 'Key 有效（如需确认能出图，点「试出一张」）',
        tried,
      };
    } catch (e) {
      tried.push(`${u} → ${String(e.message || e).slice(0, 60)}`);
    }
  }
  throw new Error('渠道校验失败：' + tried.join(' ｜ ') + '（中转站可能不支持只读校验，请用「试出一张」验证）');
}

/** 真验证：出一张最小的图（约 60–90 秒），证明渠道端到端可用 */
export async function testShot() {
  return generateImage({ prompt: '纯色浅米色背景，中央一个极简圆形色块', tier: Object.keys(activeTiers())[0], ratio: '1:1' });
}

'''
I = I[:old_start] + NEW + I[old_end:]
save("imagegen.js", I, ["checkedVia", "export async function testShot", "不支持只读校验"])

# ---- index.js：加「试出一张」路由 + keys 依赖补 testShot ----
X = load("index.js")
if "image/test-shot" not in X:
    X = sub1(X, "import { generateImage, expandPrompt, imagegenReady, TIERS, reloadKeys as reloadImageKeys, testImageChannel } from './imagegen.js';",
                "import { generateImage, expandPrompt, imagegenReady, TIERS, reloadKeys as reloadImageKeys, testImageChannel, testShot } from './imagegen.js';", "idx.imp")
    X = sub1(X, "    testImageChannel,\n  });", "    testImageChannel,\n  });\n\n  // 生图渠道「试出一张」：真出图（约 60–90 秒），证明端到端可用\n  app.post('/api/image/test-shot', async () => testShot());", "idx.shot")
save("index.js", X, ["image/test-shot", "testShot"])
print("B4 完成")
