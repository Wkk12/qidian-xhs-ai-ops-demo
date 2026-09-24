# -*- coding: utf-8 -*-
"""修 C2 的过度删除：运营计划表卡片重建为合法结构（只留 内容支柱占比 + 每天几条）"""
import io

V = r"C:\Users\12543\xhs-ops-platform\web\src\components\ModuleViews.vue"
v = io.open(V, "r", encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in v else "\n"

START = '<div class="panel" style="padding:18px 20px;margin-bottom:18px">'
END = '<div class="outline-overview panel">'
s = v.index(START)
e = v.index(END, s)
old = v[s:e]
assert "内容支柱占比" in old, "定位失败：这不是计划表卡片"

NEW = '''<div class="panel" style="padding:18px 20px;margin-bottom:18px">
        <p style="margin:0 0 14px;color:#8b8175;font-size:11px;line-height:1.7">
          人设 / 目标人群 / 语气 / 卖点 / 转化目标 统一在<b>上方「人物设定 · 目标人群 · 核心要求」</b>里设置
          （这里不再重复，避免两处打架）。本卡片只保留「内容支柱占比」与「每天发几条」。
        </p>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
          <b style="font-size:13px">内容支柱占比</b>
          <span style="font-size:12px;color:#b4544a" v-if="pillarsDefault">（当前是默认模板，保存后成为你自己的计划）</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          <label v-for="(p, i) in pillars" :key="'pl' + i" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#faf7f3;border-radius:9px;font-size:12px">
            <span>{{ p.name }}</span>
            <input v-model.number="pillars[i].ratio" type="number" min="0" max="100" style="width:48px;padding:4px 6px;border:1px solid #e3dcd2;border-radius:6px;text-align:center;font-size:12px" />%
          </label>
        </div>
        <p style="margin:14px 0 0;font-size:12px;color:#8b8175">每天发 {{ postsPerDay }} 条 → 7 天窗口共需产出 <b>{{ weekTotal }}</b> 篇；之后每天生成 1 次（补第 7 天那批）。</p>
      </div>

      '''
v = v[:s] + NEW.replace("\n", NL) + v[e:]
io.open(V, "w", encoding="utf-8", newline="").write(v)
print("✔ 计划表卡片已重建")
