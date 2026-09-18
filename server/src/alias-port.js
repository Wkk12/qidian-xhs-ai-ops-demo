/**
 * 旧地址兼容转发：127.0.0.1:5199 -> 127.0.0.1:8787
 * （开发期前端 dev 用的 5199，浏览器旧标签/Ctrl+R 刷新即可正常显示）
 */
import http from 'node:http';

const FROM = 5199;
const TO = 8787;

const server = http.createServer((req, res) => {
  const proxyReq = http.request(
    { host: '127.0.0.1', port: TO, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('主服务未启动，请先运行 启动.bat');
  });
  req.pipe(proxyReq);
});

server.listen(FROM, '127.0.0.1', () => {
  console.log(`[别名端口] http://127.0.0.1:${FROM} -> http://127.0.0.1:${TO}`);
});
server.on('error', (e) => {
  console.log('[别名端口] 启动失败（可能已占用，可忽略）:', e.code);
});
