/**
 * 小红书账号：扫码登录 / 扫码切换账号 / 退出登录 —— **全站唯一实现**
 *
 * 为什么单独抽出来：客户机没有 Hermes，登录入口必须长在页面里，而且有**两个入口**：
 *   ① 设置页「小红书账号」卡片（内嵌二维码）
 *   ② 页面左下角账号按钮点开的弹框
 * 两处必须是同一套逻辑、同一个登录态 —— 否则会出现「弹框显示已登录、卡片显示未登录」这种假功能。
 * 所以：状态、二维码、倒计时、轮询、切号、退出全部在这里，两个组件只负责渲染。
 */
import { computed, ref } from 'vue'
import { api } from './api.js'

export const loginOpen = ref(false)
export const loginState = ref({ service: true, loggedIn: false, username: '', unknown: true })
export const qrImage = ref('')
export const qrLoading = ref(false)
export const qrError = ref('')
export const qrSecondsLeft = ref(0)
export const justLoggedIn = ref(false)
export const scanBusy = ref(false)      // 切换账号 / 退出登录 进行中
export const scanMsg = ref('')          // 切号后的提示（"已退出原账号，扫下面的码登录新账号"）

let qrCountdown = null
let loginPoll = null
let pollFails = 0
let successHandler = null

/** 登录成功后要刷新哪些数据 —— 由 App.vue 注册（避免这里反向依赖页面） */
export function setLoginSuccessHandler(fn) { successHandler = fn }

export const qrStatusText = computed(() => {
  if (qrLoading.value) return '正在获取二维码…'
  if (qrError.value) return qrError.value
  if (qrSecondsLeft.value > 0) return '等待扫码…'
  return '二维码已过期，请点「换一张二维码」'
})

export async function refreshLoginStatus({ retry = true } = {}) {
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
}

function startQrCountdown(seconds) {
  clearInterval(qrCountdown)
  qrSecondsLeft.value = Math.max(30, Math.round(Number(seconds) || 240))
  qrCountdown = setInterval(() => {
    qrSecondsLeft.value = Math.max(0, qrSecondsLeft.value - 1)
    if (qrSecondsLeft.value === 0) clearInterval(qrCountdown)
  }, 1000)
}

function applyQr(d) {
  const img = String((d && d.img) || (typeof d === 'string' ? d : '') || '')
  if (!img.startsWith('data:image')) throw new Error('二维码返回异常')
  qrImage.value = img
  justLoggedIn.value = false
  qrError.value = ''
  const ttl = Number(d && d.timeout)
  startQrCountdown(ttl > 1000 ? ttl / 1000 : (ttl > 0 ? ttl : 240))
}

/** 只换一张码（不切号，用当前浏览器会话重新出码） */
export async function fetchLoginQrcode() {
  qrLoading.value = true
  qrError.value = ''
  clearInterval(qrCountdown)
  try {
    const r = await api.mcpQrcode()
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
  } catch (e) {
    qrImage.value = ''
    qrError.value = loginState.value.service
      ? '获取二维码失败：' + (e.message || '未知错误')
      : '本机服务未启动，无法获取二维码'
  } finally {
    qrLoading.value = false
  }
}

function stopPoll() { clearTimeout(loginPoll); clearInterval(qrCountdown) }

/**
 * 开始扫码流程。
 * @param {{switchAccount?:boolean, openModal?:boolean}} opt
 *   switchAccount=true → 先清掉本机授权（退出原账号）再出码，扫码后即为**换号**
 *   openModal=true     → 打开左下角那个弹框（设置页内嵌二维码时传 false）
 */
export async function startScan({ switchAccount: doSwitch = false, openModal = false } = {}) {
  if (openModal) loginOpen.value = true
  justLoggedIn.value = false
  scanMsg.value = ''
  qrLoading.value = true
  qrImage.value = ''
  scanBusy.value = doSwitch
  try {
    const tasks = [refreshLoginStatus()]
    if (doSwitch) tasks.push(api.mcpSwitchAccount().then((r) => { applyQr((r && r.data) || {}); scanMsg.value = '已退出原账号：扫下面的码可登录新的小红书账号' }))
    else tasks.push(fetchLoginQrcode())
    await Promise.allSettled(tasks)
  } finally {
    scanBusy.value = false
    qrLoading.value = false
  }
  startPoll()
}

function startPoll() {
  stopPoll()
  pollFails = 0
  const poll = async () => {
    if (document.hidden) { loginPoll = setTimeout(poll, 3000); return }
    const s = await refreshLoginStatus()
    if (s.loggedIn) {
      clearInterval(qrCountdown)
      qrSecondsLeft.value = 0
      qrImage.value = ''
      justLoggedIn.value = true
      scanMsg.value = ''
      try { if (successHandler) await successHandler(s) } catch { /* 刷新失败不影响登录 */ }
      return
    }
    if (s.service) pollFails = 0
    else pollFails += 1
    if (pollFails >= 10) {
      qrError.value = '本机服务连接异常，已暂停自动刷新；修好后点「换一张二维码」重新获取'
      return
    }
    loginPoll = setTimeout(poll, s.service ? 4000 : Math.min(60000, 4000 * Math.pow(2, Math.min(pollFails, 4))))
  }
  loginPoll = setTimeout(poll, 4000)
}

/** 左下角账号按钮 → 打开弹框并出码 */
export async function openLogin() {
  await startScan({ openModal: true })
}

export function closeLogin() {
  loginOpen.value = false
  stopPoll()
}

/** 换号：清本机授权 + 出新码（设置页与弹框共用，两条入口同一实现） */
export async function switchAccount() {
  if (loginState.value.loggedIn) {
    const who = loginState.value.username || '当前账号'
    const ok = typeof window === 'undefined' ? true
      : window.confirm(`切换账号会先退出「${who}」（清除本机授权），然后出现新二维码；扫完新账号才能继续发内容。\n\n确定要换号吗？`)
    if (!ok) return
  }
  await startScan({ switchAccount: true, openModal: false })
}

/** 退出登录：清本机授权（之后发内容/读评论都会失败，需要重新扫码） */
export async function logoutAccount() {
  scanBusy.value = true
  try {
    await api.mcpLogout()
    await refreshLoginStatus()
    qrImage.value = ''
    scanMsg.value = '已退出登录（授权已清除）。要恢复使用请重新扫码登录。'
  } catch (e) {
    scanMsg.value = '退出失败：' + (e.message || '未知错误')
  } finally {
    scanBusy.value = false
  }
}

function onVisibilityChange() {
  if (!document.hidden && (loginOpen.value || qrImage.value) && !loginState.value.loggedIn) {
    clearTimeout(loginPoll)
    loginPoll = setTimeout(() => { refreshLoginStatus() }, 300)
  }
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
refreshLoginStatus() // 首帧就把登录态显示成真值
