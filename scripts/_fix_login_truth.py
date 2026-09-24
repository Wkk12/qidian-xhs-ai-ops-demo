# -*- coding: utf-8 -*-
"""登录流程收口（实测发现的关键真相）：
   MCP 在**已登录**状态下 `login/qrcode` 只回 {is_logged_in:true}，**不出二维码** →
   所以「切换账号」必须先清授权再出码（后端 /api/mcp/switch-account 就是这么做的）。
   这里让 UI 把这件事说清楚，而不是丢一个"二维码返回异常"。
"""
import io

A = r"C:\Users\12543\xhs-ops-platform\web\src\account.js"
V = r"C:\Users\12543\xhs-ops-platform\web\src\components\ModuleViews.vue"

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

# ---------- account.js ----------
a = load(A)

a = sub1(a, """export const loginState = ref({ service: true, loggedIn: false, username: '' })""",
            """export const loginState = ref({ service: true, loggedIn: false, username: '', unknown: true })""", "acc.state")

a = sub1(a, """export async function refreshLoginStatus() {
  try {
    const s = await api.mcpStatus()
    loginState.value = { service: !!s.service, loggedIn: !!s.loggedIn, username: s.username || '' }
  } catch {
    loginState.value = { service: false, loggedIn: false, username: '' }
  }
  return loginState.value
}""",
"""export async function refreshLoginStatus({ retry = true } = {}) {
  try {
    const s = await api.mcpStatus()
    if (s && s.service) {
      loginState.value = { service: true, loggedIn: !!s.loggedIn, username: s.username || '', unknown: false }
      return loginState.value
    }
    // 服务在但没给答复：重试一次，别把「读不到」显示成「未登录」
    if (retry) { await new Promise((r) => setTimeout(r, 1200)); return refreshLoginStatus({ retry: false }) }
    loginState.value = { service: true, loggedIn: false, username: '', unknown: true }
  } catch {
    if (retry) { await new Promise((r) => setTimeout(r, 1200)); return refreshLoginStatus({ retry: false }) }
    loginState.value = { service: false, loggedIn: false, username: '', unknown: false }
  }
  return loginState.value
}""", "acc.status")

a = sub1(a, """    const r = await api.mcpQrcode()
    applyQr((r && r.data) || {})
  } catch (e) {""",
"""    const r = await api.mcpQrcode()
    const d = (r && r.data) || {}
    // 实测：已登录时 MCP 不出码，只回 is_logged_in —— 这不是错误，要如实告诉用户怎么换号
    if (!d.img && (d.is_logged_in || d.isLoggedIn)) {
      qrImage.value = ''
      await refreshLoginStatus({ retry: false })
      const who = loginState.value.username ? `（${loginState.value.username}）` : ''
      qrError.value = `当前已登录${who}，平台不会在登录状态下再出二维码。要换号请点「切换账号（扫码）」——它会先退出当前账号，再出新码。`
      return
    }
    applyQr(d)
  } catch (e) {""", "acc.qr")

a = sub1(a, """/** 换号：清本机授权 + 出新码（设置页与弹框共用） */
export async function switchAccount() {
  await startScan({ switchAccount: true, openModal: false })
}""",
"""/** 换号：清本机授权 + 出新码（设置页与弹框共用，两条入口同一实现） */
export async function switchAccount() {
  if (loginState.value.loggedIn) {
    const who = loginState.value.username || '当前账号'
    const ok = typeof window === 'undefined' ? true
      : window.confirm(`切换账号会先退出「${who}」（清除本机授权），然后出现新二维码；扫完新账号才能继续发内容。\\n\\n确定要换号吗？`)
    if (!ok) return
  }
  await startScan({ switchAccount: true, openModal: false })
}""", "acc.switch")

save(A, a, ["unknown: true", "is_logged_in", "确定要换号吗"])

# ---------- ModuleViews：二维码区的空态文案用真实原因 ----------
v = load(V)
v = sub1(v, """              <div v-else class="qr-empty">{{ qrLoading ? '获取二维码…' : (loginState.loggedIn ? '已登录（点左侧换号）' : '点左侧「扫码登录」出码') }}</div>""",
"""              <div v-else class="qr-empty">{{ qrLoading ? '获取二维码…' : (qrError || (loginState.loggedIn ? '已登录 · 换号请点左侧「切换账号」' : '点左侧「扫码登录」出码')) }}</div>""", "mv.qrempty")
v = sub1(v, """            <span :class="['conn-state', loginState.loggedIn ? 'ok' : 'bad']">{{ loginState.service ? (loginState.loggedIn ? '已登录' : '未登录') : '服务未启动' }}</span>""",
"""            <span :class="['conn-state', loginState.loggedIn ? 'ok' : 'bad']">{{ !loginState.service ? '服务未启动' : (loginState.unknown ? '检测中…' : (loginState.loggedIn ? '已登录' : '未登录')) }}</span>""", "mv.state")
v = sub1(v, """              <b>{{ loginState.loggedIn ? (loginState.username || '已登录账号') : '还没有登录' }}</b>""",
"""              <b>{{ loginState.unknown ? '正在读取登录态…' : (loginState.loggedIn ? (loginState.username || '已登录账号') : '还没有登录') }}</b>""", "mv.name")
v = sub1(v, """              <small>{{ loginState.loggedIn ? '授权保存在本机，失效或换号时重新扫码即可' : '扫码后系统才能发内容、读评论' }}</small>""",
"""              <small>{{ loginState.loggedIn ? '授权存在本机；换号点「切换账号（扫码）」（会先退出当前账号）' : '扫码后系统才能发内容、读评论' }}</small>""", "mv.hint")
save(V, v, ["qrError ||", "检测中…"])

print("登录流程收口完成")
