# -*- coding: utf-8 -*-
"""batchB3：comments.js（禁用词专业词表 + 人设卡定性/继承） + generate.js（查重开关/emoji/跟随大纲选题）"""
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

# ---------- comments.js ----------
C = load("comments.js")
if "广告法" not in C:
    C = sub1(C, """export function getForbidden() {
  return getSetting('forbidden_words', [
    '包治', '保证有效', '100%', '全网最低', '最便宜', '绝对', '治愈', '根治',
    '免费送', '加微信', '私下转账', '同行不行', '别家都是骗',
  ]);
}""", """/**
 * 禁用词表（默认给一套专业词表，客户可改可加）
 * 口径：① 广告法绝对化用语 ② 医疗/医美违规表述 ③ 引流与私下交易 ④ 贬低同行
 * 回复里一命中就转人工，绝不自动发出。
 */
export const DEFAULT_FORBIDDEN = [
  // ① 广告法绝对化
  '最好', '最佳', '第一', '唯一', '绝对', '顶级', '国家级', '世界级', '史上最', '全网最低',
  '最便宜', '永久有效', '100%', '百分百', '无一例外', '保证', '包治', '无效退款',
  // ② 医疗 / 医美违规
  '治疗', '治愈', '根治', '药效', '特效', '无痛', '零风险', '立竿见影', '立马见效', '包瘦', '包过',
  // ③ 引流 / 私下交易
  '加微信', '私加', '私下转账', '扫码付款', '加v', '加V', '微信号', '免费送', '返现', '先到先得名额',
  // ④ 贬低同行 / 违规承诺
  '同行不行', '别家都是骗', '正规医院都不敢', '做完就变',
];

export function getForbidden() {
  return getSetting('forbidden_words', DEFAULT_FORBIDDEN);
}""", "cm.forbidden")
if "scope: 'comment-reply'" not in C:
    C = sub1(C, """export function getPersona() {
  return getSetting('persona_card', {
    name: '绮点',
    role: '美业/设计内容账号主理人',
    tone: '温柔、专业、像朋友',""", """/**
 * 人设卡 = **评论回复的人设**（只影响自动回复怎么说话），不是账号人设。
 * 账号人设（我是谁/给谁看/核心要求）在「运营大纲 · 三板块」里；
 * 这里没单独设置时，**默认继承运营大纲**，避免两处各说各话。
 */
export function getPersona() {
  const saved = getSetting('persona_card', null);
  if (saved && (saved.name || saved.role || saved.tone)) return { ...saved, scope: 'comment-reply' };
  let pos = {};
  try {
    const p = db.prepare('SELECT * FROM positioning ORDER BY id DESC LIMIT 1').get();
    if (p) pos = p;
  } catch { /* ignore */ }
  return {
    scope: 'comment-reply',
    inheritedFrom: 'positioning',
    name: pos.persona || '绮点',
    role: pos.persona ? `${pos.persona}（面向 ${pos.audience || '目标人群'}）` : '美业/设计内容账号主理人',
    tone: pos.tone || '温柔、专业、像朋友',""", "cm.persona")
    # 默认对象尾部加标记
    C = sub1(C, """    enabled: true,
  });
}""", """    enabled: true,
  };
}""", "cm.personaTail")
save("comments.js", C, ["DEFAULT_FORBIDDEN", "scope: 'comment-reply'", "inheritedFrom"])

# ---------- generate.js ----------
G = load("generate.js")
if "dedupeRewriteEnabled" not in G:
    G = sub1(G, "async function enforceDedupe(item, context, keyword = '') {",
                """function dedupeRewriteEnabled() {
  try {
    const r = db.prepare("SELECT value FROM settings WHERE key='dedupe_rewrite'").get();
    return !r || (r.value !== 'false' && r.value !== '0');
  } catch { return true; }
}

async function enforceDedupe(item, context, keyword = '') {
  // 「内容与发布保护 · 相似度超限自动重写」开关关掉时：只保留分数，不触发重写
  if (!dedupeRewriteEnabled()) {
    try {
      const d = checkDuplicate(item.title, item.body, []);
      return { ...item, dup_score: d.score, dup_with: d.mostSimilar ? d.mostSimilar.title : null, dupSkipped: true };
    } catch { return item; }
  }""", "gen.gate")
    G = sub1(G, "1. 每条标题 ≤ 20 字，要有钩子（疑问式/数字式/结果前置式），口语化，不写广告腔",
                """1. 每条标题 ≤ 20 字，要有钩子（疑问式/数字式/结果前置式），口语化，不写广告腔
1.5 **小红书原生感（硬要求）**：正文大量使用 emoji（每条 6–15 个，放在要点前或句末，如 👇✅😭🥹💄✨），短句分行（每段 1–3 行），可用 1–2 个颜文字；标题可带 1 个 emoji。禁止写成说明书或广告稿""", "gen.emoji")
    G = sub1(G, "【任务】\n生成 ${days} 天 × 每天 ${postsPerDay} 条 = **共 ${total} 条**小红书笔记。",
                """【任务】\n生成 ${days} 天 × 每天 ${postsPerDay} 条 = **共 ${total} 条**小红书笔记。
**选题来源优先级**：若上面【完整运营策略】给了「分阶段选题」，就**按它的顺序逐条写**（一天一条往前推），不要另起炉灶；策略没给选题时才用下面的七天叙事。""", "gen.topics")
save("generate.js", G, ["dedupeRewriteEnabled", "小红书原生感", "选题来源优先级"])
print("batchB3 完成")
