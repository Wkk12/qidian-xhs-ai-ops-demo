# -*- coding: utf-8 -*-
"""二轮后端补丁：
  1) library.js —— 关键词抽取重写（原来抽的是整句碎片，matchKnowledge 永远命中不了）
  2) index.js   —— match-test 暴露来源(doc) + /api/generate/context 暴露 策略/平台数据（§0 可追溯）
"""
import io, re

ROOT = r"C:\Users\12543\xhs-ops-platform\server\src"

def load(n):
    with io.open(f"{ROOT}\\{n}", "r", encoding="utf-8", newline="") as f:
        return f.read()

def save(n, d, must):
    for m in must:
        assert m in d, f"{n} 落盘校验失败：缺 {m!r}"
    with io.open(f"{ROOT}\\{n}", "w", encoding="utf-8", newline="") as f:
        f.write(d)
    print(f"  ✔ {n} 已写")

def sub1(t, old, new, tag):
    crlf = "\r\n" in t
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert t.count(o) == 1, f"[{tag}] 锚点 count={t.count(o)}"
    return t.replace(o, n, 1)

# ---------- 1) library.js 关键词 ----------
L = load("library.js")
start = L.index("/** 从一段文字里抽关键词")
end = L.index("/** 把全文切成")
new_fn = '''/**
 * 从一段文字里抽关键词
 * matchKnowledge 的判据是 `提问文本.includes(关键词)` → 关键词必须是**短而具体的实词**。
 * 第一版抽的是 2-8 字连续片段（整句碎片），实测永远命中不了（score 恒 0）—— 这里改成：
 *   统计 2/3/4 字片段出现次数 → 取重复出现(≥2)且互不包含的短词 → 不够再补长词。
 */
function keywordsOf(text, docName) {
  const t = String(text || '').replace(/\\s+/g, '');
  const cand = new Map();
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= t.length; i++) {
      const w = t.slice(i, i + n);
      if (!/[\\u4e00-\\u9fa5A-Za-z]/.test(w[0]) || STOP.has(w)) continue;
      cand.set(w, (cand.get(w) || 0) + 1);
    }
  }
  const picked = [];
  const strong = [...cand.entries()].filter(([, c]) => c >= 2 && c <= 40)
    .sort((a, b) => (b[1] * b[0].length) - (a[1] * a[0].length));
  const weak = [...cand.entries()].filter(([, c]) => c === 1 && a0len(a[0] = a[0]) )
  for (const [w] of strong) {
    if (picked.length >= 10) break;
    if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
    picked.push(w);
  }
  if (picked.length < 6) {
    for (const [w] of [...cand.entries()].filter(([w, c]) => c === 1 && w.length >= 3)) {
      if (picked.length >= 8) break;
      if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
      picked.push(w);
    }
  }
  const out = [...new Set([...picked, docName ? String(docName).replace(/\\.[a-z]+$/i, '') : ''].filter(Boolean))];
  return out.slice(0, 12);
}

'''
L = L[:start] + new_fn + L[end:]
L = L.replace("  const weak = [...cand.entries()].filter(([, c]) => c === 1 && a0len(a[0] = a[0]) )\n", "")
assert "a0len" not in L, "占位垃圾没清掉"
save("library.js", L, ["c >= 2 && c <= 40", "picked.some((p) => p.includes(w)"])

# ---------- 2) index.js ----------
I = load("index.js")

I = sub1(I, "import { generateWeek, runGeneration, getPositioning, getGoodPosts, getTrends } from './generate.js';",
            "import { generateWeek, runGeneration, getPositioning, getGoodPosts, getTrends, platformText, refreshPlatformRef } from './generate.js';",
            "index.importGenerate")
I = sub1(I, "import { registerOutlineApi } from './outline.js';",
            "import { registerOutlineApi, strategyText, getStrategy } from './outline.js';",
            "index.importOutline")

old = """app.post('/api/comments/match-test', async (req) => {
  const text = (req.body || {}).text || '';
  const hit = matchKnowledge(text);
  return { ok: true, text, matched: !!hit, score: hit ? hit.score : 0,
           question: hit ? hit.item.question : null, answer: hit ? hit.item.answer : null };
});"""
new = """app.post('/api/comments/match-test', async (req) => {
  const text = (req.body || {}).text || '';
  const hit = matchKnowledge(text);
  return { ok: true, text, matched: !!hit, score: hit ? hit.score : 0,
           source: hit ? (hit.source || 'manual') : null,
           docId: hit ? (hit.item.doc_id || null) : null,
           question: hit ? hit.item.question : null, answer: hit ? hit.item.answer : null };
});"""
I = sub1(I, old, new, "index.matchTest")

old = """app.get('/api/generate/context', async () => ({
  ok: true,
  positioning: getPositioning(),"""
new = """app.get('/api/generate/context', async () => {
  await refreshPlatformRef(); // §0：把「平时数据」也取出来，生成前就能看到用了什么
  return {
  ok: true,
  strategy: { ...getStrategy(), text: strategyText() },
  platform: { text: platformText() },
  positioning: getPositioning(),"""
I = sub1(I, old, new, "index.genContextHead")

old = """  trends: getTrends(10),
}));"""
new = """  trends: getTrends(10),
  };
});"""
I = sub1(I, old, new, "index.genContextTail")
save("index.js", I, ["strategy: { ...getStrategy(), text: strategyText() }", "docId: hit ? (hit.item.doc_id", "platformText, refreshPlatformRef"])

print("二轮补丁完成")
