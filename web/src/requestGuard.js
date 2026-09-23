/**
 * 全局登录态守卫（2026-09-23 新增 · 执行者2号）
 *
 * 真问题（不是假想）：小红书登录态失效时，绝大多数接口只会把错误抛给调用方，
 * 页面局部显示一句红字或者干脆白屏；只有「内容趋势」一个接口自己做了
 * 「扫码登录」引导。用户看到的现象是「全站一大片功能好像都坏了」，实际只是登录过期。
 *
 * 做法：不动 App.vue（避免和并行改动撞车），本模块完全自包含：
 *   1) api.js 在任意接口收到 401/403（或错误信息明确提到登录）时调用下面两个 notify
 *   2) 本模块自建一个固定横幅 DOM，不依赖 Vue，任何模块下都能用
 *   3) 「重新扫码登录」直接复用后端 /api/mcp/qrcode 真实二维码 + 每 3 秒轮询真实登录态
 *   4) 只有后端 /api/mcp/status 真的返回 loggedIn=true 才重载页面，绝不假装已登录
 *
 * 后端接口（已存在，无需新增）：
 *   GET  /api/mcp/qrcode         → { ok, data: { img: 'data:image/...', timeout: ms } }
 *   GET  /api/mcp/status         → { ok, loggedIn, service, account }
 *   POST /api/mcp/status/refresh → 强制刷新一次登录态
 */

const S_BANNER = [
  'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483000',
  'display:none', 'align-items:center', 'gap:10px', 'flex-wrap:wrap',
  'padding:10px 16px', 'background:#fdf3f1', 'border-bottom:1px solid #f0c9c2',
  'color:#8c3b31', 'box-shadow:0 2px 10px rgba(40,34,28,.08)',
  'font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
].join(';')

const S_MODAL = [
  'position:fixed', 'inset:0', 'z-index:2147483001', 'display:none',
  'align-items:center', 'justify-content:center', 'padding:24px',
  'background:rgba(40,34,28,.42)',
  'font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
].join(';')

const S_CARD = [
  'width:min(380px,92vw)', 'background:#fff', 'border-radius:16px',
  'padding:22px 24px', 'text-align:center', 'box-shadow:0 18px 50px rgba(40,34,28,.18)',
].join(';')

const S_BTN = [
  'border:1px solid currentColor', 'background:transparent', 'color:inherit',
  'border-radius:999px', 'padding:5px 12px', 'font-size:12px', 'cursor:pointer',
].join(';')

let banner = null
let msgEl = null
let modal = null
let qrImg = null
let qrHint = null
let pollTimer = null
let tickTimer = null

function mkBtn(text, onClick, label) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = text
  b.setAttribute('style', S_BTN)
  if (label) b.setAttribute('aria-label', label)
  b.addEventListener('click', onClick)
  return b
}

function ensureBanner() {
  if (banner) return banner
  if (typeof document === 'undefined' || !document.body) return null
  banner = document.createElement('div')
  banner.id = 'xhs-auth-banner'
  banner.setAttribute('role', 'alert')
  banner.setAttribute('style', S_BANNER)
  msgEl = document.createElement('span')
  msgEl.setAttribute('style', 'flex:1;min-width:220px')
  banner.appendChild(msgEl)
  banner.appendChild(mkBtn('重新扫码登录', openQr))
  banner.appendChild(mkBtn('我已登录，重新检测', recheck))
  banner.appendChild(mkBtn('×', hideAll, '关闭提示'))
  document.body.appendChild(banner)
  return banner
}

function ensureModal() {
  if (modal) return modal
  if (typeof document === 'undefined' || !document.body) return null
  modal = document.createElement('div')
  modal.setAttribute('style', S_MODAL)
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal() })

  const card = document.createElement('div')
  card.setAttribute('style', S_CARD)
  const title = document.createElement('b')
  title.textContent = '重新扫码登录小红书'
  title.setAttribute('style', 'display:block;font-size:15px;margin-bottom:8px')

  qrImg = document.createElement('img')
  qrImg.setAttribute('alt', '小红书登录二维码')
  qrImg.setAttribute('style', 'width:200px;height:200px;object-fit:contain;margin:6px auto;display:block;border-radius:12px')

  qrHint = document.createElement('p')
  qrHint.setAttribute('style', 'margin:8px 0 14px;color:#8b8175;font-size:12px;min-height:18px')

  const actions = document.createElement('div')
  actions.setAttribute('style', 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap')
  actions.appendChild(mkBtn('刷新二维码', fetchQr))
  actions.appendChild(mkBtn('我已扫码，重试', recheck))
  actions.appendChild(mkBtn('关闭', closeModal))

  card.appendChild(title)
  card.appendChild(qrImg)
  card.appendChild(qrHint)
  card.appendChild(actions)
  modal.appendChild(card)
  document.body.appendChild(modal)
  return modal
}

function stopTimers() {
  window.clearInterval(pollTimer)
  window.clearInterval(tickTimer)
  pollTimer = null
  tickTimer = null
}

function openQr() {
  if (!ensureModal()) return
  qrImg.removeAttribute('src')
  qrHint.textContent = '正在获取二维码…'
  modal.style.display = 'flex'
  fetchQr()
}

function closeModal() {
  stopTimers()
  if (modal) modal.style.display = 'none'
}

function hideAll() {
  closeModal()
  if (banner) banner.style.display = 'none'
}

async function fetchQr() {
  try {
    const res = await fetch('/api/mcp/qrcode')
    const json = await res.json()
    const d = (json && json.data) || {}
    const img = String(d.img || (typeof d === 'string' ? d : '') || '')
    if (!img.startsWith('data:image')) throw new Error('二维码返回异常')
    qrImg.src = img
    // 后端会回 timeout（毫秒）：用它算倒计时；没有就按 4 分钟
    const raw = Number(d.timeout)
    const secs = raw > 1000 ? Math.round(raw / 1000) : (raw > 0 ? raw : 240)
    startCountdown(secs)
    startPolling()
  } catch (e) {
    qrHint.textContent = '获取二维码失败：' + (e.message || '未知错误')
  }
}

function startCountdown(secs) {
  let left = secs
  const paint = () => {
    qrHint.textContent = left > 0
      ? `请用小红书 App 扫码 · 二维码 ${left} 秒后过期`
      : '二维码已过期，点「刷新二维码」重新获取'
  }
  paint()
  window.clearInterval(tickTimer)
  tickTimer = window.setInterval(() => {
    left -= 1
    paint()
    if (left <= 0) {
      window.clearInterval(tickTimer)
      window.clearInterval(pollTimer)
    }
  }, 1000)
}

async function isLoggedIn(refresh = false) {
  try {
    if (refresh) await fetch('/api/mcp/status/refresh', { method: 'POST' }).catch(() => {})
    const res = await fetch('/api/mcp/status')
    const json = await res.json()
    return !!(json && json.loggedIn)
  } catch {
    return false   // 服务没起来时不算「已登录」
  }
}

function startPolling() {
  window.clearInterval(pollTimer)
  pollTimer = window.setInterval(async () => {
    if (await isLoggedIn(false)) onLoggedIn()
  }, 3000)
}

async function recheck() {
  if (await isLoggedIn(true)) {
    onLoggedIn()
    return
  }
  const b = ensureBanner()
  if (!b) return
  msgEl.textContent = '仍未检测到登录 —— 请点「重新扫码登录」，用小红书 App 扫码后会自动恢复。'
  b.style.display = 'flex'
}

function onLoggedIn() {
  stopTimers()
  if (modal) modal.style.display = 'none'
  if (banner) banner.style.display = 'none'
  // 登录态恢复后整页重新取数，所有模块一起回到真实数据
  window.location.reload()
}

/** 接口返回 401/403：登录态失效 */
export function notifyAuthExpired(path, message) {
  const b = ensureBanner()
  if (!b) return
  msgEl.textContent = `小红书登录已过期（${path || '接口'}）—— 发布、评论、抓数据都会失败，请重新扫码登录。`
    + (message ? `　${message}` : '')
  b.style.display = 'flex'
}

/** 本机服务/平台链路异常（例如 MCP 熔断）：提示但不谎报是登录问题 */
export function notifyServiceDegraded(message) {
  const b = ensureBanner()
  if (!b) return
  msgEl.textContent = `本机服务异常（可能被平台限流）：${message || '请稍后重试'}`
  b.style.display = 'flex'
}

/** 错误信息里是否明确指向登录问题（MCP 抛 panic 时也能兜住） */
export function looksLikeAuthError(message) {
  return /登录|未授权|unauthorized|not\s*logged|session\s*(expired|invalid)|cookie/i.test(String(message || ''))
}
