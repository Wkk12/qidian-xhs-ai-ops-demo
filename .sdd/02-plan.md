# 技术方案 · 绮点 AI 小红书运营平台

> 回答「怎么做」，与 `01-spec.md` 的需求一一对应。
> 建立：2026-09-18 ｜ 最后更新：2026-09-18
>
> 来源：归并自 `_sources/02 开发计划`、`06 系统机制说明书`、`07 部署环境要求`

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     客户机（Mac Intel）                       │
│                                                             │
│   浏览器 ──► 127.0.0.1:8787  (Node + Fastify)                │
│                    │                                        │
│                    ├─ fastifyStatic ──► web/dist（前端页面）   │
│                    ├─ /api/* ─────────► SQLite (node:sqlite)  │
│                    ├─ /api/mcp/* ─────► MCP  :18060（平台通道）│
│                    ├─ /api/creator/* ─► 创作者中心 galaxy API  │
│                    ├─ /api/generate ──► DeepSeek（内容生成）   │
│                    └─ 发布调度器（每 60 秒）                    │
│                                                             │
│   兼容层：5199 ──► 8787（旧地址转发，避免旧标签打不开）          │
└─────────────────────────────────────────────────────────────┘
```

**关键决策**：**单服务托管**（后端直出前端）。原因：客户机上跑 dev server 会掉线，交付面越简单越好。

---

## 二、模块划分

| 模块 | 职责 | 对应需求 | 文件位置 |
|---|---|---|---|
| db | SQLite 建表/索引/日志 | 全部 | `server/src/db.js` |
| mcp | 平台通道封装（隔离层） | R1/R4/R14 | `server/src/mcp.js` |
| assets | 素材库（上传/静态/挂载） | R10 | `server/src/assets.js` |
| dedupe | 四维加权查重 | R3 | `server/src/dedupe.js` |
| deepseek | LLM 封装（Key 只在服务端） | R2/R12/R14 | `server/src/deepseek.js` |
| generate | 内容生成引擎（四参考系+七天结构） | R2 | `server/src/generate.js` |
| publish | 发布状态机 + 调度 + 预检 | R5/R6 | `server/src/publish.js` |
| index | HTTP 路由 + 前端托管 + 创作者中心 | 全部 | `server/src/index.js` |
| competitors | 对标账号发现 + 6 维度分析 | R11 | `server/src/competitors.js` |
| report | 24/48/72h 快照 + 复盘报告与建议 | R12 | `server/src/report.js` |
| comments | 评论规则轮询 + 知识库匹配 + AI 回复 | R14 | `server/src/comments.js` |
| imagegen | AI 生图两档（含强制提示词扩写） | R15 | `server/src/imagegen.js` |
| alias-port | 旧端口转发 | — | `server/src/alias-port.js` |

**前端**：`web/`（Vue 3.5 + Element Plus），页面结构为 Wkk 定稿，**只改数据来源**（红线 2）。

---

## 三、数据模型

```sql
-- 内容（草稿/AI生成/历史导入）
CREATE TABLE contents (
  id INTEGER PRIMARY KEY, source TEXT,          -- history|generated|manual
  title TEXT, body TEXT, tags TEXT,             -- tags=JSON
  cover_text TEXT, images TEXT,                 -- images=JSON:[{path,type,source}]
  status TEXT,                                  -- draft|approved|scheduled|published|rejected
  dup_score REAL, dup_with INTEGER,             -- 查重结果
  note_id TEXT,                                 -- 发布后平台返回
  plan_id INTEGER, day_index INTEGER,
  created_at TEXT, updated_at TEXT
);

-- 发布任务（状态机，可恢复）
CREATE TABLE publish_tasks (
  id INTEGER PRIMARY KEY, content_id INTEGER,
  scheduled_at TEXT, status TEXT,               -- pending|precheck|publishing|done|failed|canceled
  retry INTEGER DEFAULT 0, note_id TEXT, error TEXT,
  created_at TEXT, updated_at TEXT
);

-- 指标快照（每日）
CREATE TABLE metrics (
  id INTEGER PRIMARY KEY, note_id TEXT, date TEXT,
  views INTEGER, likes INTEGER, collects INTEGER,
  comments INTEGER, shares INTEGER, fans_delta INTEGER,
  raw TEXT, created_at TEXT
);

-- 行业热榜
CREATE TABLE trends (
  id INTEGER PRIMARY KEY, keyword TEXT, note_id TEXT UNIQUE,
  title TEXT, author TEXT, liked INTEGER, collected INTEGER, commented INTEGER,
  cover TEXT, url TEXT, note_time TEXT,
  xsec_token TEXT,                              -- 拉笔记详情的必需参数
  scraped_at TEXT
);

-- 账号定位 + 内容支柱（运营计划表）
CREATE TABLE positioning (
  id INTEGER PRIMARY KEY, persona TEXT, audience TEXT,
  pillars TEXT,                                 -- JSON:[{name,ratio,note}]
  tone TEXT, selling TEXT, goal TEXT, updated_at TEXT
);

-- 素材库
CREATE TABLE assets (
  id INTEGER PRIMARY KEY, name TEXT, path TEXT, url TEXT,
  kind TEXT,                                    -- upload|generated|history
  size INTEGER, created_at TEXT
);

-- 其他：plans（周计划）/ settings（KV）/ comments / knowledge / logs
CREATE INDEX IF NOT EXISTS idx_metrics_note ON metrics(note_id, date);
CREATE INDEX IF NOT EXISTS idx_trends_kw   ON trends(keyword);
CREATE INDEX IF NOT EXISTS idx_pub_status  ON publish_tasks(status, scheduled_at);
```

---

## 四、关键接口（44 个，分组）

| 分组 | 接口 |
|---|---|
| 健康/设置 | `GET /api/health`、`GET|POST /api/settings` |
| 平台通道 | `GET /api/mcp/{status,qrcode,me,my-notes,search}`、`POST /api/mcp/detail` |
| 创作者数据 | `GET /api/creator/{overview,profile}` |
| 内容 | `GET|POST /api/contents`、`PATCH /api/contents/:id`、`POST /api/notes/import` |
| 生成 | `POST /api/generate`、`GET /api/generate/context`、`GET /api/ai/status` |
| 查重 | `POST /api/duplicate/{check,scan}` |
| 发布 | `GET /api/publish/{tasks,best-time}`、`POST /api/publish/{schedule,precheck,now,tick}`、`POST /api/publish/tasks/:id/{run,cancel}` |
| 热榜 | `GET /api/trends`、`POST /api/trends/{scrape}`、`GET|POST /api/trends/keywords` |
| 计划表 | `GET|POST /api/positioning`、`GET|POST /api/plan-config`、`GET|POST /api/plans` |
| 素材 | `GET /api/assets`、`POST /api/assets/{upload,register}`、`DELETE /api/assets/:id`、`POST /api/assets/:id/attach` |
| 图片代理 | `GET /api/img?url=`（绕平台防盗链） |
| 其他 | `GET /api/metrics`、`POST /api/metrics/collect`、`GET|POST /api/knowledge`、`GET /api/comments` |

> 🔴 **新增接口须先改 `00-constitution.md` 或 `01-spec.md`**（宪法红线 1、6）。历史上曾擅自新增 16 个。

---

## 五、关键机制实现要点（源自 `06 机制说明书`）

| 机制 | 实现要点 | 文件 |
|---|---|---|
| 四参考系加权 | 权重写入 system prompt，用户输入 0.45 最高 | generate.js |
| 七天叙事 | D1痛点→D2工具→D3方法→D4场景→D5案例→D6价值→D7转化 | generate.js |
| 查重四维 | 字符 bigram + 余弦；正文<30字退回标题单维 | dedupe.js |
| 发布预检 | 登录态/查重/配图/正文/间隔 五项 | publish.js |
| 建议发布时间 | 自己历史 > 对标 > 行业经验（三层） | publish.js |
| 图片防盗链 | 服务端带 Referer 代理 | index.js |
| 评论监控 | 规则轮询 5 分钟；AI 只做生成不监控 | （待开发） |

---

## 六、技术风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 平台限流 / 403 | 抓取失败 | 间隔 ≥3.5 秒；失败进重试轮；不猛打 |
| MCP 连续快速请求 | 返回"服务器内部错误" | 请求间加间隔；错误可重试 |
| 登录态过期 | 全部平台功能失效 | 预检项之一；页面明确提示重新扫码 |
| 生图渠道不可用 | 生图档位失效 | 明确报错，不静默降级；预留多渠道路由 |
| 小号中文被生图模型写错 | 交付质量事故 | 红线 8：重要中文一律 Pillow 排版后合成 |
| 本地模型被顶掉 | 微信监控挂掉 | 红线 9：卸载/加载前先查依赖 |
| Mac Intel 无官方发布通道 | 交付失败 | 交叉编译 `darwin-amd64`（R16）|
| 规格漂移 | 文档失效 | 本 SDD 体系 + 校验器（红线 5）|

---

## 七、交付清单（红线 4 / R16）

**交付前必查**：
- [ ] `server/.env` 里的 **DeepSeek Key 已删除/替换**（用户明确要求）
- [ ] `server/data/` 已清空（我的测试数据）
- [ ] `xiaohongshu-mcp-go/cookies.json` 已清空（客户自行扫码）
- [ ] `.sdd/` 未进入交付包（内部规格）
- [ ] 全项目搜索 `sk-` 确认无密钥残留
- [ ] 未提交的 46 篇测试笔记已清理（如客户不需要）
- [ ] Mac `.command` 启动脚本可双击运行
- [ ] 客户版文档三份齐（需求说明书 / 机制说明书 / 部署要求）

**交付物结构**：
```
绮点小红书运营系统/
├── server/  web/  mcp/        源码 + 依赖
├── 启动.command               Mac 一键启动
├── docs/                      三份客户文档
└── README.md                  首次使用引导
```
