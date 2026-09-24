# -*- coding: utf-8 -*-
"""只补 index.js 的日期归一化（analytics.js 上一轮已落盘，本脚本幂等）"""
import io

P = r"C:\Users\12543\xhs-ops-platform\server\src\index.js"
d = io.open(P, "r", encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in d else "\n"
DAYF = nl + '''/** 平台 date 可能是 'YYYY-MM-DD' / 10 位秒 / 13 位毫秒 → 统一成 'YYYY-MM-DD'
 *  （2026-09-24 修：AI 解读里曾出现裸时间戳「1788796800」） */
function dayOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^\\d{10,13}$/.test(s)) {
    const n = Number(s);
    const dt = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}
''' + nl

if "function dayOf(" not in d:
    anchor = "function pickWindow(win) {"
    assert d.count(anchor) == 1, "pickWindow 锚点异常"
    d = d.replace(anchor, DAYF + anchor, 1)
    print("  + 已插入 dayOf")

old = "      date: new Date(p.date).toISOString().slice(0, 10),"
if old in d:
    assert d.count(old) == 1, "series 锚点异常"
    d = d.replace(old, "      date: dayOf(p.date),", 1)
    print("  + series 已改 dayOf")
assert "function dayOf(" in d and "date: dayOf(p.date)" in d, "落盘校验失败"
io.open(P, "w", encoding="utf-8", newline="").write(d)
print("✔ index.js 日期归一化完成")
