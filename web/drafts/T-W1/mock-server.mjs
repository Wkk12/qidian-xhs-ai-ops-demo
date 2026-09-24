// 【开发夹具·不属于产物】契约1 的极小 mock 后端：托 web/dist + 只实现 GET /api/interaction/feed
// 用途：在后端 T-A1 落 8787 之前，端到端验证前端「互动运营」区块的取数/渲染链路。
// 用法：node mock-server.mjs [distRoot] [port]
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'

const ROOT = process.argv[2] || 'C:/Users/12543/xhs-ops-platform/web/dist'
const PORT = Number(process.argv[3] || 18990)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

// 契约1 的样例形状（仅供渲染链路自测，非业务数据）
const FEED = {
  ok: true,
  replies: [
    { id: 101, user: '小圆脸June', comment: '请问这个妆适合圆脸吗？', reply: '超适合！重点是把腮红打在颧骨偏上位置～', mode: 'auto', at: '2026-09-23T10:24:00+08:00', note: '为什么别人底妆像天生好皮？' },
    { id: 102, user: 'Lily在备课', comment: '求口红色号', reply: '用的是 07 号豆沙色，日常通勤很稳。', mode: 'manual', at: '2026-09-22T21:05:00+08:00', note: '10分钟底妆，手残党照做就行' },
  ],
  incoming: [
    { user: '阿茶不加糖', text: '明天来店里可以试吗？', at: '2026-09-23T12:40:00+08:00', note: '设计师接单啦' },
    { user: 'momo大人', text: '这个发型好看，有教程吗', at: '2026-09-23T09:12:00+08:00', note: '需要设计吗' },
  ],
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/api/interaction/feed') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(FEED))
    return
  }
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: 'mock harness: 仅实现契约1' }))
    return
  }
  const p = url.pathname === '/' ? '/index.html' : url.pathname
  try {
    const buf = await readFile(join(ROOT, p))
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    try {
      const buf = await readFile(join(ROOT, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(buf)
    } catch { res.writeHead(404); res.end('not found') }
  }
}).listen(PORT, '127.0.0.1', () => console.log(`mock harness up: http://127.0.0.1:${PORT}  root=${ROOT}`))
