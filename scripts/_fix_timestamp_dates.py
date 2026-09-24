# -*- coding: utf-8 -*-
"""修「AI 解读里出现裸时间戳 1788796800」：
   根因 = 平台返回的 date 有的已经是 'YYYY-MM-DD'，有的是 10 位秒级时间戳，
   analytics.js 直接 String(p.date).slice(0,10) 就把时间戳原样喂给了 AI。
   两处一起修：analytics.js 的 viewSeries 归一化 + index.js pickWindow 同款兜底。"""
import io

def load(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()

def save(p, d, must):
    for m in must:
        assert m in d, f"{p} 校验失败：缺 {m!r}"
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(d)
    print("  ✔", p.split("\\")[-1], "已写")

def sub1(t, old, new, tag):
    crlf = "\r\n" in t
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert t.count(o) == 1, f"[{tag}] 锚点 count={t.count(o)}"
    return t.replace(o, n, 1)

DAYF = '''
/** 平台 date 可能是 'YYYY-MM-DD' / 10 位秒 / 13 位毫秒 → 统一成 'YYYY-MM-DD'
 *  （2026-09-24 修：之前直接把 10 位时间戳当日期喂给 AI，解读里出现过「1788796800」） */
function dayOf(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  if (/^\\d{10,13}$/.test(s)) {
    const n = Number(s)
    const d = new Date(n < 1e12 ? n * 1000 : n)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  return s.slice(0, 10)
}

'''

# ---------- analytics.js ----------
import re
A = r"C:\Users\12543\xhs-ops-platform\server\src\analytics.js"
a = load(A)
assert "function dayOf(" not in a
m = re.search(r"^[^\n]*registerAnalyticsApi\(app\)\s*\{", a, re.M)
assert m, "找不到 registerAnalyticsApi 定义"
nl = "\r\n" if "\r\n" in a else "\n"
a = a[:m.start()] + DAYF.replace("\n", nl) + a[m.start():]
a = sub1(a, "date: String(p.date || '').slice(0, 10)", "date: dayOf(p.date)", "analytics.viewSeries")
save(A, a, ["function dayOf(", "date: dayOf(p.date)"])

# ---------- index.js ----------
I = r"C:\Users\12543\xhs-ops-platform\server\src\index.js"
i = load(I)
if "function dayOf(" not in i:
    i = sub1(i, "function pickWindow(win) {", DAYF.replace("\n", "\r\n") + "function pickWindow(win) {", "index.dayOf")
i = sub1(i, "      date: new Date(p.date).toISOString().slice(0, 10),", "      date: dayOf(p.date),", "index.series")
save(I, i, ["function dayOf(", "date: dayOf(p.date)"])
print("完成")
