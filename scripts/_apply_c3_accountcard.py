# -*- coding: utf-8 -*-
"""设置页账号卡改造：
 - 卡片压矮（一行信息 + 按钮）
 - **二维码放在「刷新状态」右侧**
 - 按钮改为调用 account.js 共享实现（与左下角弹框同一套：扫码登录 / 切换账号 / 退出登录）
 - 文案/回复模型卡与生图卡一起压矮（紧凑间距）
"""
import io

V = r"C:\Users\12543\xhs-ops-platform\web\src\components\ModuleViews.vue"
C = r"C:\Users\12543\xhs-ops-platform\web\src\styles\modules.css"

def load(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read()

def save(p, d, must):
    for m in must:
        assert m in d, f"{p} 落盘校验失败：缺 {m!r}"
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(d)
    print("  ✔", p.split("\\")[-1])

def sub1(t, old, new, tag):
    crlf = "\r\n" in t
    o = old.replace("\n", "\r\n") if crlf else old
    n = new.replace("\n", "\r\n") if crlf else new
    assert t.count(o) == 1, f"[{tag}] 锚点 count={t.count(o)}"
    return t.replace(o, n, 1)

v = load(V)
NL = "\r\n" if "\r\n" in v else "\n"

# ---------- 1) 模板：账号卡改成「左信息 + 右二维码（刷新状态右侧）」 ----------
A_START = '        <!-- 小红书登录 / 切换账号：二维码直接嵌在卡里 -->'
A_END = '        <!-- DeepSeek Key：手动输入 + 保存并检查 -->'
s, e = v.index(A_START), v.index(A_END)
NEW_CARD = '''        <!-- 小红书账号：信息一行 + 按钮；二维码在「刷新状态」右侧直接显示 -->
        <article class="setting-panel panel account-card">
          <div class="panel-head compact">
            <div><span class="section-label">XIAOHONGSHU</span><h3>小红书账号</h3></div>
            <span :class="['conn-state', loginState.loggedIn ? 'ok' : 'bad']">{{ loginState.service ? (loginState.loggedIn ? '已登录' : '未登录') : '服务未启动' }}</span>
          </div>
          <div class="acc-body">
            <div class="acc-info">
              <b>{{ loginState.loggedIn ? (loginState.username || '已登录账号') : '还没有登录' }}</b>
              <small>{{ loginState.loggedIn ? '授权保存在本机，失效或换号时重新扫码即可' : '扫码后系统才能发内容、读评论' }}</small>
              <div class="acc-actions">
                <button class="outline-button slim" type="button" :disabled="scanBusy" @click="switchAccount">{{ scanBusy ? '处理中…' : (loginState.loggedIn ? '切换账号（扫码）' : '扫码登录') }}</button>
                <button class="outline-button slim" type="button" @click="refreshLoginStatus">刷新状态</button>
                <button v-if="loginState.loggedIn" class="outline-button slim danger" type="button" :disabled="scanBusy" @click="logoutAccount">退出登录</button>
              </div>
              <p v-if="scanMsg" class="acc-msg">{{ scanMsg }}</p>
            </div>
            <div class="qr-side">
              <img v-if="qrImage" :src="qrImage" alt="小红书登录二维码" />
              <div v-else class="qr-empty">{{ qrLoading ? '获取二维码…' : (loginState.loggedIn ? '已登录\n换号请点左侧按钮' : '点左侧「扫码登录」出码') }}</div>
              <small v-if="qrImage">{{ qrSecondsLeft > 0 ? `二维码 ${qrSecondsLeft} 秒后失效` : '二维码已过期，点「换一张」' }}</small>
              <button v-if="qrImage" class="link-mini" type="button" :disabled="qrLoading" @click="fetchLoginQrcode">换一张</button>
            </div>
          </div>
        </article>

'''
v = v[:s] + NEW_CARD.replace("\n", NL) + v[e:]

# ---------- 2) 脚本：删掉本页自己那份登录逻辑，改用 account.js ----------
S1 = "const acc = ref({ loading: true, loggedIn: false, username: '' })"
S2 = "/* ---- 密钥：手动输入 + 保存并检查 ---- */"
s2, e2 = v.index(S1), v.index(S2)
v = v[:s2] + "/* 登录 / 切号 / 退出：全部走 account.js（与左下角弹框同一套实现，见文件顶部注释） */\n\n" + v[e2:]

# 顶部加 import
v = sub1(v, "import { api } from '../api.js'",
"""import { api } from '../api.js'
import {
  loginState, qrImage, qrLoading, qrSecondsLeft, scanBusy, scanMsg,
  refreshLoginStatus, fetchLoginQrcode, switchAccount, logoutAccount,
} from '../account.js'""", "mv.import")

# loader 换名
v = sub1(v, "  if (v === 'settings') { loadRealStatus(); loadComments(); loadAccStatus(); loadKeys();",
            "  if (v === 'settings') { loadRealStatus(); loadComments(); refreshLoginStatus(); loadKeys();", "mv.loader")

save(V, v, ["acc-body", "qr-side", "from '../account.js'", "refreshLoginStatus(); loadKeys()"])

# ---------- 3) CSS：卡片压矮 + 二维码右侧 ----------
c = load(C)
CSS = '''/* ============ 设置页卡片压矮 + 账号卡二维码右侧 ============ */
.settings-grid { align-items: start; }
.settings-grid .setting-panel { padding: 14px 16px; }
.setting-panel .panel-head.compact { margin-bottom: 6px; }
.setting-panel .panel-head.compact h3 { font-size: 13px; }
.acc-body { display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: 14px; align-items: start; }
.acc-info { display: grid; gap: 4px; align-content: start; }
.acc-info b { font-size: 13px; }
.acc-info small { color: var(--muted); font-size: 9.5px; line-height: 1.6; }
.acc-msg { margin: 6px 0 0; color: var(--accent); font-size: 9.5px; line-height: 1.6; }
.qr-side { display: grid; gap: 5px; justify-items: center; align-content: start; }
.qr-side img { width: 124px; height: 124px; object-fit: contain; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
.qr-side .qr-empty { width: 124px; height: 124px; display: grid; place-items: center; padding: 8px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); font-size: 9px; text-align: center; white-space: pre-line; line-height: 1.6; }
.qr-side small { color: var(--muted); font-size: 8.5px; text-align: center; }
.link-mini { padding: 0; border: 0; color: var(--accent); background: transparent; cursor: pointer; font-size: 9px; font-weight: 700; }
.outline-button.slim { padding: 6px 11px; font-size: 10px; }
.outline-button.danger { color: #b4544a; }
.setting-panel .studio-field { margin-top: 7px; }
.setting-panel .studio-field span { font-size: 9.5px; }
.setting-panel .studio-field input, .setting-panel .studio-field select { padding: 7px 10px; font-size: 11px; }
.setting-panel .acc-actions { margin-top: 9px; }
.setting-panel .tier-table { margin-top: 9px; padding: 9px 11px; gap: 4px; }
.setting-panel .environment-list { margin-top: 8px; }
@media (max-width: 620px) { .acc-body { grid-template-columns: 1fr; } }

'''
c = c.replace("@media (prefers-reduced-motion: reduce) {", CSS + "@media (prefers-reduced-motion: reduce) {", 1)
save(C, c, [".acc-body", ".qr-side img", ".outline-button.slim"])
print("C3 完成")
