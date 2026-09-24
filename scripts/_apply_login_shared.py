# -*- coding: utf-8 -*-
"""登录/切号做成一套共享实现 + 设置页两个卡片压矮 + 二维码放右侧
 1) 后端：POST /api/mcp/switch-account（清授权 → 出新码）、POST /api/mcp/logout（清授权）
 2) api.js：mcpSwitchAccount / mcpLogout
 3) App.vue：删掉自己那份登录逻辑 → 用 account.js（左下角弹框加「切换账号 / 退出登录」）
 4) 设置页：账号卡 + 文案模型卡 变矮；二维码在「刷新状态」右侧
"""
import io

S = r"C:\Users\12543\xhs-ops-platform\server\src"
W = r"C:\Users\12543\xhs-ops-platform\web\src"

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

# ---------------- 1) 后端：切号 / 退出 ----------------
X = load(S + r"\index.js")
if "mcp/switch-account" not in X:
    X = sub1(X, """app.get('/api/mcp/qrcode', async () => {""",
"""/**
 * 切换账号：先清掉本机授权（退出原账号），再取一张新二维码 —— 扫码后即换号
 * 说明：MCP 没有"账号列表"这种概念，换号的唯一可靠方式就是清 cookies 重新扫码。
 */
app.post('/api/mcp/switch-account', async () => {
  const out = { ok: true, cleared: false };
  try {
    await mcp.clearCookies();
    out.cleared = true;
  } catch (e) {
    out.cleared = false;
    out.clearError = String(e.message || e).slice(0, 200);
  }
  _statusCache = { at: 0, data: null, inflight: null, ttl: STATUS_TTL_MS };   // 登录态立刻重查
  _meCache = { at: 0, data: null, inflight: null };                            // 账号资料立刻重查
  try {
    const r = await mcp.loginQrcode();
    out.data = r?.data || null;
  } catch (e) {
    out.qrError = String(e.message || e).slice(0, 200);
  }
  log('info', 'mcp', '切换账号：已清授权=' + out.cleared + '，新二维码=' + (out.data ? '已获取' : '失败'));
  return out;
});

/** 退出登录：只清授权，不出码 */
app.post('/api/mcp/logout', async () => {
  const out = { ok: true, cleared: false };
  try {
    await mcp.clearCookies();
    out.cleared = true;
  } catch (e) {
    out.cleared = false;
    out.error = String(e.message || e).slice(0, 200);
  }
  _statusCache = { at: 0, data: null, inflight: null, ttl: STATUS_TTL_MS };
  _meCache = { at: 0, data: null, inflight: null };
  return out;
});

app.get('/api/mcp/qrcode', async () => {""", "idx.switch")
    save(S + r"\index.js", X, ["mcp/switch-account", "mcp/logout", "clearCookies"])

# ---------------- 2) api.js ----------------
A = load(W + r"\api.js")
if "mcpSwitchAccount" not in A:
    A = sub1(A, "  keysStatus: () => req('/keys/status'),",
"""  mcpSwitchAccount: () => req('/mcp/switch-account', { method: 'POST' }),
  mcpLogout: () => req('/mcp/logout', { method: 'POST' }),

  keysStatus: () => req('/keys/status'),""", "api.switch")
    save(W + r"\api.js", A, ["mcpSwitchAccount", "mcpLogout"])

# ---------------- 3) App.vue：换成共享实现 ----------------
V = load(W + r"\App.vue")
if "from './account.js'" not in V:
    s = V.index("/* -------- 小红书扫码登录")
    e = V.index("onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange))")
    e = V.index("\n", e) + 1
    NEW = """/* -------- 小红书扫码登录 / 切换账号：逻辑全在 account.js（设置页与左下角弹框共用同一套） -------- */
import {
  loginOpen, loginState, qrImage, qrLoading, qrError, qrSecondsLeft, justLoggedIn,
  scanBusy, scanMsg, qrStatusText, refreshLoginStatus, fetchLoginQrcode, openLogin,
  closeLogin, switchAccount, logoutAccount, setLoginSuccessHandler,
} from './account.js'

// 扫码成功后要刷新首页数据（账号变了，粉丝/笔记/互动都要重取）
setLoginSuccessHandler(async () => {
  await Promise.allSettled([loadAccount(), loadPlanAndPosts(), loadTrendSeries(), loadInteractionFeed()])
})
"""
    V = V[:s] + NEW.replace("\n", "\r\n" if "\r\n" in V else "\n") + V[e:]
    # 弹框加「切换账号 / 退出登录」
    V = sub1(V, """            <button class="primary-button glass-button login-qr-btn" type="button" :disabled="qrLoading" @click="fetchLoginQrcode">
              <RefreshCw :size="15" />{{ qrLoading ? '获取中…' : '换一张二维码' }}
            </button>""",
"""            <div class="login-action-row">
              <button class="primary-button glass-button login-qr-btn" type="button" :disabled="qrLoading || scanBusy" @click="fetchLoginQrcode">
                <RefreshCw :size="15" />{{ qrLoading ? '获取中…' : '换一张二维码' }}
              </button>
              <button class="glass-button login-qr-btn" type="button" :disabled="scanBusy" @click="switchAccount">
                <Repeat :size="15" />{{ scanBusy ? '处理中…' : '切换账号（扫码）' }}
              </button>
              <button v-if="loginState.loggedIn" class="glass-button login-qr-btn" type="button" :disabled="scanBusy" @click="logoutAccount">退出登录</button>
            </div>
            <p v-if="scanMsg" class="login-ok">{{ scanMsg }}</p>""", "app.buttons")
    # Repeat 图标导入
    if "Repeat" not in V.split("</script>")[0].split("from '@lucide/vue'")[0][-2000:]:
        import re
        m = re.search(r"\} from '@lucide/vue'", V)
        assert m, "找不到 lucide 导入"
        V = V[:m.start()] + "  Repeat,\n" + V[m.start():]
    save(W + r"\App.vue", V, ["from './account.js'", "切换账号（扫码）", "setLoginSuccessHandler"])

print("第 1~3 步完成")
