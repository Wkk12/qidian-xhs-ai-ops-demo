# 本地扫码登录修复

扫码入口、自动检测、手动检测共用 `web/src/account.js`。
上游服务修复以 `xpzouying/xiaohongshu-mcp` 提交 `6583124dfda92312b6bc19a042a6acfae63fe498` 为基线，补丁保存在 `patches/mcp-login-session.patch`。

修复内容：等待扫码时读取当前页面的非游客账号状态，避免依赖固定 CSS；查询优先返回同一个扫码会话；凭据保存成功后才报告登录成功；退出后旧扫码结果不得写回。

## 构建与启动

在上述上游提交的干净检出目录执行（需要 Go 1.24）：

```sh
git apply /Users/sweetkiki/Desktop/xhs/patches/mcp-login-session.patch
gofmt -w login_session.go login_session_test.go service.go xiaohongshu/login.go
go test . -run TestLoginSession -count=1
go build -o /Users/sweetkiki/Desktop/xhs/.runtime/xiaohongshu-mcp-darwin-arm64 .
```

确认旧连接服务已停止后，在本项目运行 `bash scripts/start-mcp-local.sh`。主服务仍使用 `cd server && node src/index.js`。
两者都使用本项目 `data/cookies.json`，该文件不入库；自定义路径时同时传入 `XHS_COOKIE_FILE`。

## 检测接口

`GET http://127.0.0.1:8787/api/mcp/status?pending=1`

新增 `loginPhase`：`waiting` 等待手机确认，`confirmed` 已保存并确认，`expired` 会话结束，`error` 保存失败；`loginSessionId` 用于核对是否为同一次扫码。`loggedIn` 仍是页面判断登录成功的字段。

真实账号验收：扫码并在手机确认后，接口必须返回 `loggedIn: true`，本机凭据中必须存在非空会话，页面必须显示已登录。自动化会话测试不能替代这一步。
