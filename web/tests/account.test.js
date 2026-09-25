import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// 隔离真实平台调用，以可控时间复现扫码、切换页面和慢请求。
const source = await readFile(new URL('../src/account.js', import.meta.url), 'utf8')
async function setup() {
  let now = 0
  let id = 0
  let status = { service: true, loggedIn: false }
  let statusImpl = async () => status
  let qrCalls = 0
  let switchCalls = 0
  let successCalls = 0
  const timers = new Map()
  const listeners = {}
  const calls = []
  const document = { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn } }
  const schedule = (fn, ms, interval = false) => {
    timers.set(++id, { fn, at: now + ms, interval: interval ? ms : 0 })
    return id
  }
  const context = vm.createContext({
    document, window: { confirm: () => true },
    Date: class extends Date { static now() { return now } },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: (key) => timers.delete(key),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: (key) => timers.delete(key),
  })
  const api = {
    mcpStatus: async (opts) => { calls.push(opts); return statusImpl() },
    mcpQrcode: async () => { qrCalls++; return { data: { img: 'data:image/png;base64,test', timeout: 240 } } },
    mcpSwitchAccount: async () => { switchCalls++; return { cleared: true, data: { img: 'data:image/png;base64,test' } } },
    mcpLogout: async () => ({ cleared: true }),
  }
  const imports = {
    vue: { ref: (value) => ({ value }), computed: (fn) => ({ get value() { return fn() } }) },
    './api.js': { api },
    './requestGuard.js': { clearAuthNotice() {} },
  }
  const mod = new vm.SourceTextModule(source, { context })
  await mod.link((name) => {
    const values = imports[name]
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await mod.evaluate()
  const account = mod.namespace
  await account.refreshLoginStatus()
  account.setLoginSuccessHandler(() => { successCalls++ })
  calls.length = 0
  return {
    account, api, calls, document,
    get qrCalls() { return qrCalls }, get switchCalls() { return switchCalls },
    get successCalls() { return successCalls },
    setStatus(value) { status = value },
    setStatusImpl(fn) { statusImpl = fn },
    visible() { document.hidden = false; listeners.visibilitychange() },
    async advance(ms) {
      const end = now + ms
      while (true) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [key, timer] = next
        now = timer.at
        if (timer.interval) timer.at += timer.interval
        else timers.delete(key)
        await timer.fn()
      }
      now = end
    },
  }
}

test('出码后倒计时与自动查询同时运行，确认登录后只刷新数据一次', async () => {
  const t = await setup()
  await t.account.startScan()
  await t.advance(3000)
  assert.equal(t.account.qrSecondsLeft.value, 237)
  assert.equal(t.calls.length, 2)
  assert.ok(t.calls.every((c) => c.pending))
  t.setStatus({ service: true, loggedIn: true })
  await t.advance(2000)
  assert.equal(t.account.loginState.value.loggedIn, true)
  assert.equal(t.account.qrImage.value, '')
  assert.equal(t.successCalls, 1)
  const count = t.calls.length
  await t.advance(15000)
  assert.equal(t.calls.length, count)
})

test('切到后台再返回后继续多次轮询', async () => {
  const t = await setup()
  await t.account.startScan()
  t.document.hidden = true
  await t.advance(1000)
  t.visible()
  await t.advance(5000)
  assert.equal(t.calls.length, 3)
})

test('关闭再打开复用有效二维码，倒计时继续', async () => {
  const t = await setup()
  await t.account.openLogin()
  t.account.closeLogin()
  await t.advance(5000)
  await t.account.openLogin()
  await t.advance(1000)
  assert.equal(t.qrCalls, 1)
  assert.equal(t.account.qrSecondsLeft.value, 234)
})

test('停止后刷新二维码会重新启动检测', async () => {
  const t = await setup()
  await t.account.startScan()
  t.account.closeLogin()
  await t.account.fetchLoginQrcode()
  await t.advance(3000)
  assert.equal(t.calls.length, 2)
})

test('手动检测走新状态与成功回调，没有昵称也为已登录', async () => {
  const t = await setup()
  t.setStatus({ service: true, loggedIn: true })
  await t.account.checkLoginNow()
  assert.equal(t.account.loginState.value.loggedIn, true)
  assert.equal(t.calls[0].pending, true)
  assert.equal(t.successCalls, 1)
  assert.match(t.account.scanMsg.value, /登录成功/)
})

test('服务检测错误标记待确认，不能显示成确定未登录', async () => {
  const t = await setup()
  t.setStatus({ service: true, loggedIn: false, loginError: 'timeout' })
  await t.account.checkLoginNow()
  assert.equal(t.account.loginState.value.unknown, true)
  assert.equal(t.account.statusChecking.value, false)
  assert.match(t.account.scanMsg.value, /无法确认/)
})

test('有效期结束后自动停止，仍可手动确认迟到的成功结果', async () => {
  const t = await setup()
  await t.account.startScan()
  await t.advance(245000)
  const count = t.calls.length
  await t.advance(60000)
  assert.equal(t.calls.length, count)
  t.setStatus({ service: true, loggedIn: true })
  await t.account.checkLoginNow()
  assert.equal(t.account.loginState.value.loggedIn, true)
})

test('未登录点扫码不清凭据；并发检测复用同一请求', async () => {
  const t = await setup()
  await t.account.switchAccount()
  assert.equal(t.switchCalls, 0)
  let resolve
  t.setStatusImpl(() => new Promise((done) => { resolve = done }))
  const one = t.account.checkLoginNow()
  const two = t.account.checkLoginNow()
  assert.equal(t.calls.length, 1)
  resolve({ service: true, loggedIn: true })
  await Promise.all([one, two])
  assert.equal(t.successCalls, 1)
})

test('关闭时正在进行的检测返回后不再重启轮询', async () => {
  const t = await setup()
  await t.account.startScan()
  let resolve
  let markStarted
  const started = new Promise((done) => { markStarted = done })
  t.setStatusImpl(() => new Promise((done) => { resolve = done; markStarted() }))
  const poll = t.advance(1000)
  await started
  t.account.closeLogin()
  resolve({ service: true, loggedIn: false })
  await poll
  await t.advance(10000)
  assert.equal(t.calls.length, 1)
})

test('手动检测不能复用正在返回的普通长缓存结果', async () => {
  const t = await setup()
  let resolve
  t.setStatusImpl(() => new Promise((done) => { resolve = done }))
  const old = t.account.refreshLoginStatus()
  const manual = t.account.checkLoginNow()
  t.setStatusImpl(async () => ({ service: true, loggedIn: true }))
  resolve({ service: true, loggedIn: false })
  await Promise.all([old, manual])
  assert.equal(t.calls.length, 2)
  assert.equal(t.calls[1].pending, true)
  assert.equal(t.account.loginState.value.loggedIn, true)
})
