# -*- coding: utf-8 -*-
"""R22 / R23 / R24 后端验收：策略初稿 → 两轮对话（记忆+真改策略）→ 资料库命中 → 回复开关"""
import json, urllib.request

BASE = "http://127.0.0.1:8787"

def req(path, method="GET", body=None, timeout=240):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    r = urllib.request.Request(BASE + path, data=data, method=method,
                              headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

out = {}

# 1) AI 生成完整策略初稿
g = req("/api/outline/strategy/generate", "POST", {"userIntent": "主打新手化妆体验课，语气亲切像学姐"})
s = g.get("strategy", {})
out["1_策略初稿"] = {
    "howTo字数": len(s.get("howTo", "")),
    "goals字数": len(s.get("goals", "")),
    "阶段数": len(s.get("phases", [])),
    "第一阶段选题": (s.get("phases") or [{}])[0].get("topics", [])[:3],
    "source": s.get("source"),
}

# 2) 对话第 1 轮
c1 = req("/api/outline/chat", "POST", {"message": "这周我想主打「学员改造案例」，把这个方向写进第一阶段选题"})
out["2_对话第1轮"] = {"reply": c1.get("reply", "")[:120], "applied": c1.get("applied")}

# 3) 对话第 2 轮：不重复说上下文，看它记不记得第 1 轮（记忆）
c2 = req("/api/outline/chat", "POST", {"message": "刚才那个方向，目标人群要不要再收窄一点？"})
out["3_对话第2轮"] = {
    "reply": c2.get("reply", "")[:160],
    "提到了上一轮方向": "学员改造" in (c2.get("reply", "") + json.dumps(c2.get("strategy", {}), ensure_ascii=False)),
    "applied": c2.get("applied"),
}
hist = req("/api/outline/chat?limit=10")
out["4_对话历史条数"] = len(hist.get("items", []))

# 5) 资料库命中（上传的 docx 已生成 4 条知识条目）
try:
    m = req("/api/comments/match-test", "POST", {"text": "评论自动回复怎么设置"})
    out["5_资料库命中"] = {
        "命中": bool(m.get("hit") if "hit" in m else m.get("ok")),
        "来源": (m.get("hit") or {}).get("source") if isinstance(m.get("hit"), dict) else m.get("source"),
        "raw": json.dumps(m, ensure_ascii=False)[:300],
    }
except Exception as e:
    out["5_资料库命中"] = {"error": str(e)[:200]}

# 6) 自动回复开关
a = req("/api/reply/settings", "POST", {"enabled": True})
b = req("/api/reply/settings")
c = req("/api/reply/settings", "POST", {"enabled": False})
out["6_回复开关"] = {"打开后": a.get("enabled"), "读回": b.get("enabled"), "关闭后": c.get("enabled")}

# 7) 策略是否真的进了生成参考系
ctx = req("/api/generate/context")
out["7_参考系"] = {"keys": list(ctx.keys()), "有strategy": "strategy" in ctx}

print(json.dumps(out, ensure_ascii=False, indent=1))
