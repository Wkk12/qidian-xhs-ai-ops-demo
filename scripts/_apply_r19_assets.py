# -*- coding: utf-8 -*-
"""R19：把「素材灵感」页里的 AI 生图区块撤掉（入口统一到内容工坊右侧）"""
import io

P = r"C:\Users\12543\xhs-ops-platform\web\src\components\ModuleViews.vue"
with io.open(P, "r", encoding="utf-8", newline="") as f:
    lines = f.read().split("\n")

start = next(i for i, ln in enumerate(lines) if "===== AI 生图两档（R15）=====" in ln)
assert "module-toolbar panel" in lines[start + 1], lines[start + 1]
# 区块结束：下一个 </template> （素材页模板结束）
end = next(i for i in range(start, len(lines)) if lines[i].strip() == "</template>")
tail = "\n".join(lines[start:end])
assert "本次出图结果" in tail and "本次会话历史" in tail, "生图区块内容不完整"
# 往前退一行空行
s = start - 1 if lines[start - 1].strip() == "" else start

placeholder = [
    "      <!-- R19：AI 生图入口已统一到「内容工坊」右侧单独生图面板（本页只保留素材库：上传 / 管理 / 删除） -->",
    "",
]
out = "\n".join(lines[:s]) + "\n" + "\n".join(placeholder) + "\n".join(lines[end:])
assert "本次出图结果" not in out, "生图区块没删干净"
assert "AI IMAGE GEN" in out, "内容工坊生图面板不见了？"
with io.open(P, "w", encoding="utf-8", newline="") as f:
    f.write(out)
print("OK 删除素材页生图区块，行数:", end - s)
