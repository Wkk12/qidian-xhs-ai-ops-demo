/** 全局错误提示：扫码、手动检测与设置页共用 account.js，避免重复登录会话。 */
const S_BANNER = [
  'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483000',
  'display:none', 'align-items:center', 'gap:10px', 'flex-wrap:wrap',
  'padding:10px 16px', 'background:#fdf3f1', 'border-bottom:1px solid #f0c9c2',
  'color:#8c3b31', 'box-shadow:0 2px 10px rgba(40,34,28,.08)',
  'font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
].join(';')
const S_BTN = 'border:1px solid currentColor;background:transparent;color:inherit;border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer'
let banner = null
let msgEl = null

/** 横幅按钮在请求期间展示进度并阻止重复点击。 */
function mkBtn(text, onClick, label) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text
  button.setAttribute('style', S_BTN)
  if (label) button.setAttribute('aria-label', label)
  button.addEventListener('click', async () => {
    button.disabled = true
    button.textContent = '处理中…'
    try { await onClick() }
    catch { if (msgEl) msgEl.textContent = '操作失败，请稍后重试。' }
    finally { button.disabled = false; button.textContent = text }
  })
  return button
}

/** 延迟加载账号模块，避免 api → 守卫 → 账号 → api 初始化循环。 */
async function openQr() {
  clearAuthNotice()
  const account = await import('./account.js')
  await account.openLogin()
}

/** 手动检测走同一成功回调，刷新数据时不重载页面或丢失草稿。 */
async function recheck() {
  const account = await import('./account.js')
  const state = await account.checkLoginNow()
  if (!state.loggedIn || state.unknown) {
    ensureBanner()
    msgEl.textContent = account.scanMsg.value
    banner.style.display = 'flex'
  }
}

/** 创建全站登录提示条。 */
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
  banner.appendChild(mkBtn('×', clearAuthNotice, '关闭提示'))
  document.body.appendChild(banner)
  return banner
}

/** 后端确认登录后，所有入口统一清除过期提示。 */
export function clearAuthNotice() {
  if (banner) banner.style.display = 'none'
}

/** 只对明确的登录失效展示扫码引导。 */
export function notifyAuthExpired(_path, message) {
  const b = ensureBanner()
  if (!b) return
  msgEl.textContent = `小红书登录需要确认，请扫码或点击「我已登录，重新检测」。${message ? ` ${message}` : ''}`
  b.style.display = 'flex'
}

/** 服务异常保留具体原因，便于用户重试。 */
export function notifyServiceDegraded(message) {
  const b = ensureBanner()
  if (!b) return
  msgEl.textContent = `本机服务异常：${message || '请稍后重试'}`
  b.style.display = 'flex'
}

/** 本机文件路径配置错误不等于用户授权过期。 */
export function looksLikeAuthError(message) {
  const text = String(message || '')
  if (/ENOENT|EACCES|no such file/i.test(text)) return false
  return /登录|未授权|unauthorized|not\s*logged|session\s*(expired|invalid)|cookie/i.test(text)
}
