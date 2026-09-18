# 宪法 · 绮点 AI 小红书运营平台

> **本文件是项目的最高约束**。AI 与人均不得违反。
> 改动须在 `05-changelog.md` 留痕。
> 建立：2026-09-18 ｜ 最后更新：2026-09-18

---

## 一、技术栈（锁死，更换须先改本文件）

| 层 | 选型 | 理由（为什么是它） |
|---|---|---|
| 运行时 | **Node 22** | 客户机零额外安装；内置 `node:sqlite` |
| 后端框架 | **Fastify** | 轻量、零依赖树、启动快 |
| 数据库 | **`node:sqlite`（Node 内置）** | 免安装、免编译、单文件 |
| 前端 | **Vue 3.5 + Element Plus + Vite 7** | 🔴 **Wkk 已定稿的页面，结构不可改** |
| 前端托管 | **Fastify `fastifyStatic` 直出 `web/dist`** | 单服务，避免 dev server 掉线 |
| 平台通道 | **xiaohongshu-mcp-go**（localhost:18060） | 唯一可行的发布/通知通道 |
| 平台数据 | **创作者中心 galaxy API**（复用 `.xiaohongshu.com` 泛域 cookie） | MCP 无浏览量/涨粉数据 |
| 文本生成 | **DeepSeek**（`deepseek-chat`） | 内容生成/复盘/评论回复 |
| 生图 | **apikiki `gemini-3-pro-image-preview`（nano banana pro）** | 4K 能力；⚠️ 小字中文必错，见红线 8 |
| 本地超分 | **Real-ESRGAN（ncnn-vulkan，`tools/realesrgan`）** | 保结构保文字，GPU 13 秒 |
| 抠图 | **BiRefNet（`birefnet-portrait`）** | 🔴 见红线 7 |
| 交付环境 | **Mac Intel（x86_64）** | 客户机；需交叉编译 `darwin-amd64` |

---

## 二、🔴 红线（绝对禁止，违反即返工）

1. **不得引入技术栈表以外的任何新依赖。** 要加，先改本文件并说明理由。
2. **不得修改前端页面结构与视觉。** 具体：
   - 禁止改动 `web/src/` 下任何组件的 HTML 骨架与 CSS 类名
   - 只允许改**数据来源**（把假数据换成真数据）
   - 例外：需要新增交互控件时，先在 `05-changelog.md` 记录并取得用户同意
3. **不得在客户机安装 Hermes、任何 agent、或任何运行时框架。** 交付物必须是纯本地自包含。
4. **密钥只放 `server/.env`。** 禁止出现在：代码、前端、接口返回、日志、git 仓库。
   🔴 **交付前必须删除/替换**（清单见 `02-plan.md` 交付章节）。
5. **不得在没有可测验收标准的情况下提交功能。** 每个 `[x]` 任务必须在 `06-verification.md` 有真实输出。
6. **不得擅自扩大范围。** 需求外的功能一律先问。历史上已发生：擅自加了 16 个接口。
7. **抠图只用 `birefnet-portrait`（BiRefNet）。** 禁用 u2net / isnet / 其他模型。
8. **生图不得直接使用用户原始提示词**，须经 DeepSeek 扩写；且**不得用于渲染重要小号中文**（模型必错，文字用 Pillow 排）。
9. **不得顶掉生产模型。** 微信监控依赖 `qwen/qwen3-vl-4b`；加载/卸载本地模型前先确认谁在依赖。
10. **不得删除用户数据。** `server/data/` 与 `cookies.json` 只增不删；清理须用户明确同意。

---

## 三、编码约定

- 编码 UTF-8；换行 LF
- 后端：ESM（`import`），错误统一走 Fastify `setErrorHandler`
- 日志：`log(level, tag, msg)` 写 `logs` 表，禁止 `console.log` 散落
- 接口：一律 `/api/*`，返回 `{ ok: boolean, ... }`
- 时间：本机本地时间，格式 `YYYY-MM-DDTHH:mm:ss`
- 文件命名：中文可读（面向设计师用户），脚本用英文
- Windows 环境：脚本避免 cmdline 自匹配；后台进程用独立 `Start-Process`（避免被 Hermes 进程树连带杀）

---

## 四、交付边界

**交付物**（给客户）：
- 源码（不含 `server/data/`、`.env`、`cookies.json`）
- 一键启动脚本（Mac：`.command`）
- 客户版文档：需求说明书 / 系统机制说明书 / 部署环境要求
- **不含**：内部规格（`.sdd/`）、测试数据、我的 API Key

**客户环境**：
- Mac Intel（x86_64），macOS
- 客户自行扫码登录小红书
- 客户自备 DeepSeek / 生图 API Key

**内部/对外分离**：
- `.sdd/` = 内部开发规格（含技术内幕，**不交付**）
- `docs/` = 对外交付物（不含 agent / Hermes / MCP / DeepSeek 等技术内幕）

---

## 五、本宪法怎么用

- **每轮开发前**：先读本文件，确认不越界
- **每次要加东西**：先对照红线 1、6；越界就停下来问
- **每次交付前**：对照红线 4、交付边界逐条自查
