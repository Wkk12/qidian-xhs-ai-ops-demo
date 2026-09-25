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
import { clearAuthNotice } from './requestGuard.js'

export const loginOpen = ref(false)
export const loginState = ref({ service: true, loggedIn: false, username: '', unknown: true })
export const qrImage = ref('')
export const qrLoading = ref(false)
export const qrError = ref('')
export const qrSecondsLeft = ref(0)
export const justLoggedIn = ref(false)
export const scanBusy = ref(false)      // 切换账号 / 退出登录 进行中
export const scanMsg = ref('')          // 切号后的提示（"已退出原账号，扫下面的码登录新账号"）
export const statusChecking = ref(false) // 自动和手动检测共用请求，避免重复查询

let qrCountdown = null
let loginPoll = null
let pollFails = 0
let successHandler = null
let pollVersion = 0 // 停止后，不允许旧请求重新启动轮询
let authVersion = 0 // 切号后，不允许旧账号的请求覆盖新状态
let statusFlight = null
let qrExpiresAt = 0

/** 登录成功后要刷新哪些数据 —— 由 App.vue 注册（避免这里反向依赖页面） */
export function setLoginSuccessHandler(fn) { successHandler = fn }

export const qrStatusText = computed(() => {
  if (loginState.value.loggedIn) return '登录成功 · 授权正常'
  if (qrLoading.value) return '正在获取二维码…'
  if (qrError.value) return qrError.value
  if (qrSecondsLeft.value > 0) return '等待扫码…'
  return '二维码已过期，请点「换一张二维码」'
})

/** 所有入口共用检测与成功收尾；失败不能伪装成「明确未登录」。 */
export async function refreshLoginStatus({ pending = false } = {}) {
  if (statusFlight) {
    if (!pending || statusFlight.pending) return statusFlight.promise
    await statusFlight.promise
    return refreshLoginStatus({ pending })
  }
  const version = authVersion
  statusChecking.value = true
  const promise = (async () => {
    try {
      const s = await api.mcpStatus({ pending })
      if (version !== authVersion) return loginState.value
      const unknown = !s.service || !!s.loginError || !!s.serviceError
      const wasLoggedIn = loginState.value.loggedIn
      loginState.value = { service: !!s.service, loggedIn: unknown ? wasLoggedIn : s.loggedIn === true, username: s.username || '', unknown }
      if (unknown) {
        scanMsg.value = s.loginPhase === 'error' ? '扫码确认后保存登录凭据失败，请重新扫码；若持续失败请检查本机服务。' : '暂时无法确认登录状态，请稍后点「检测登录」重试。'
      } else if (s.loggedIn) {
        stopPoll()
        clearInterval(qrCountdown)
        qrSecondsLeft.value = 0
        qrImage.value = ''
        qrError.value = ''
        justLoggedIn.value = true
        scanMsg.value = '登录成功，账号状态已更新。'
        clearAuthNotice()
        if (!wasLoggedIn && successHandler) Promise.resolve().then(() => successHandler(s)).catch(() => {})
      } else if (pending) {
        scanMsg.value = s.loginPhase === 'expired' ? '扫码会话已过期，请换一张二维码重新扫码。' : '尚未检测到登录成功，请在手机上确认授权；有效二维码期间会继续自动检测。'
      }
    } catch {
      if (version === authVersion) {
        loginState.value = { ...loginState.value, unknown: true }
        scanMsg.value = '登录检测超时或连接失败，请点击「检测登录」重试。'
      }
    } finally {
      statusChecking.value = false
      statusFlight = null
    }
    return loginState.value
  })()
  statusFlight = { promise, pending }
  return promise
}

/** 用户主动查询时使用扫码短缓存，并显示本次结果。 */
export async function checkLoginNow() {
  scanMsg.value = '正在检测登录，请稍候…'
  const s = await refreshLoginStatus({ pending: true })
  return s
}

function startQrCountdown(seconds) {
  clearInterval(qrCountdown)
  qrSecondsLeft.value = Math.max(1, Math.round(Number(seconds) || 240))
  qrExpiresAt = Date.now() + qrSecondsLeft.value * 1000
  qrCountdown = setInterval(() => {
    qrSecondsLeft.value = Math.max(0, Math.ceil((qrExpiresAt - Date.now()) / 1000))
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
  startPoll()
}

/** 只换一张码（不切号，用当前浏览器会话重新出码） */
export async function fetchLoginQrcode() {
  if (qrLoading.value) return
  stopPoll()
  qrLoading.value = true
  qrError.value = ''
  clearInterval(qrCountdown)
  try {
    const r = await api.mcpQrcode()
    const d = (r && r.data) || {}
    // 实测：已登录时 MCP 不出码，只回 is_logged_in —— 这不是错误，要如实告诉用户怎么换号
    if (!d.img && (d.is_logged_in || d.isLoggedIn)) {
      qrImage.value = ''
      await refreshLoginStatus({ pending: true })
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

function stopPoll() { pollVersion += 1; clearTimeout(loginPoll) }

/**
 * 开始扫码流程。
 * @param {{switchAccount?:boolean, openModal?:boolean}} opt
 *   switchAccount=true → 先清掉本机授权（退出原账号）再出码，扫码后即为**换号**
 *   openModal=true     → 打开左下角那个弹框（设置页内嵌二维码时传 false）
 */
export async function startScan({ switchAccount: doSwitch = false, openModal = false } = {}) {
  if (openModal) loginOpen.value = true
  if (scanBusy.value || qrLoading.value) return
  if (!doSwitch && qrImage.value && qrExpiresAt > Date.now()) {
    startQrCountdown((qrExpiresAt - Date.now()) / 1000)
    startPoll()
    return
  }
  stopPoll()
  clearInterval(qrCountdown)
  authVersion += 1
  if (statusFlight) await statusFlight.promise
  justLoggedIn.value = false
  scanMsg.value = ''
  qrImage.value = ''
  scanBusy.value = true
  try {
    if (doSwitch) {
      qrLoading.value = true
      const r = await api.mcpSwitchAccount()
      if (!r.cleared || r.qrError) throw new Error(r.qrError || r.clearError || '退出原账号失败')
      loginState.value = { service: true, loggedIn: false, username: '', unknown: false }
      applyQr(r.data)
      scanMsg.value = '已退出原账号，请扫码并在手机上确认登录。'
    } else {
      await fetchLoginQrcode()
    }
  } catch (e) {
    qrError.value = '获取二维码失败：' + (e.message || '请重试')
    scanMsg.value = qrError.value
  } finally {
    scanBusy.value = false
    qrLoading.value = false
  }
}

function startPoll() {
  stopPoll()
  const version = pollVersion
  pollFails = 0
  const poll = async () => {
    if (version !== pollVersion) return
    if (Date.now() >= qrExpiresAt) { qrError.value = '二维码已过期，请刷新二维码，或点击「检测登录」确认结果。'; return }
    if (document.hidden) { loginPoll = setTimeout(poll, 3000); return }
    // 扫码等待期间绕过后端的未登录长缓存，成功后立即更新两个入口的登录态。
    const s = await refreshLoginStatus({ pending: true })
    if (version !== pollVersion || (s.loggedIn && !s.unknown)) return
    if (s.service && !s.unknown) pollFails = 0
    else pollFails += 1
    if (pollFails >= 10) {
      qrError.value = '本机服务连接异常，已暂停自动刷新；修好后点「换一张二维码」重新获取'
      return
    }
    loginPoll = setTimeout(poll, pollFails === 0 ? 2000 : Math.min(60000, 4000 * Math.pow(2, Math.min(pollFails, 4))))
  }
  loginPoll = setTimeout(poll, 1000)
}

/** 左下角账号按钮 → 打开弹框并出码 */
export async function openLogin() {
  await startScan({ openModal: true })
}

export function closeLogin() {
  loginOpen.value = false
  stopPoll()
  clearInterval(qrCountdown)
}

/** 换号：清本机授权 + 出新码（设置页与弹框共用，两条入口同一实现） */
export async function switchAccount() {
  if (loginState.value.loggedIn) {
    const who = loginState.value.username || '当前账号'
    const ok = typeof window === 'undefined' ? true
      : window.confirm(`切换账号会先退出「${who}」（清除本机授权），然后出现新二维码；扫完新账号才能继续发内容。\n\n确定要换号吗？`)
    if (!ok) return
  }
  await startScan({ switchAccount: loginState.value.loggedIn, openModal: false })
}

/** 退出登录：清本机授权（之后发内容/读评论都会失败，需要重新扫码） */
export async function logoutAccount() {
  stopPoll()
  clearInterval(qrCountdown)
  authVersion += 1
  scanBusy.value = true
  try {
    const r = await api.mcpLogout()
    if (!r.cleared) throw new Error(r.error || '清除授权失败')
    if (statusFlight) await statusFlight.promise
    await refreshLoginStatus({ pending: true })
    qrImage.value = ''
    scanMsg.value = '已退出登录（授权已清除）。要恢复使用请重新扫码登录。'
  } catch (e) {
    scanMsg.value = '退出失败：' + (e.message || '未知错误')
  } finally {
    scanBusy.value = false
  }
}

function onVisibilityChange() {
  if (!document.hidden && qrImage.value && !loginState.value.loggedIn) {
    if (Date.now() < qrExpiresAt) startPoll()
    else checkLoginNow()
  }
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
refreshLoginStatus() // 首帧就把登录态显示成真值
