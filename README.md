# 绮点 AI · 小红书运营平台（完整项目）

面向**美业 / 化妆培训机构**的本地化小红书运营工作台：AI 生成内容 → 排期 → 自动/人工发布 → 评论回复 → 数据复盘，全流程跑在**客户自己电脑**上（账号、素材、数据都不出本机）。

> 前端原本是 Wkk 的 Demo（`index.html + src/`），现已替换为**完整项目**：Vue3 前端 + 本地 Node 服务 + 小红书 MCP + DeepSeek 文案 + 生图渠道。

---

## 一、目录结构

```
启动.bat                  # Windows 一键启动（服务 + 前端托管）
server/                   # 本地服务（Node + Fastify + node:sqlite，端口 8787）
  src/index.js            #   全部 HTTP 路由（78 条）
  src/generate.js         #   内容生成（参考系加权：你的指定 > 运营计划表 > 历史好文 > 行业热榜 + 平台真实数据 + 运营策略）
  src/publish.js          #   排期发布、15 分钟预检、自动发送/待确认、7 天清理
  src/comments.js         #   评论轮询、知识库命中、自动回复开关、禁用词
  src/imagegen.js         #   生图（渠道可切换：apikiki / qweapi；档位按渠道真实能力）
  src/analytics.js        #   数据洞察（真数据 + AI 解读）
  src/outline.js          #   运营大纲（三板块 + 完整策略 + AI 对话带记忆）
  src/library.js          #   资料库（docx/pdf/txt/md 解析 → 知识条目）
  src/knowledge.js        #   知识库（文档 AI 提炼 + 对话补全 + 条目管理）
  src/keys.js             #   界面手动填 Key + 当场检查（客户机不需要 Hermes）
  src/mcp.js              #   小红书 MCP 客户端（发布/评论/数据）
  data/                   # 运行时数据库、素材、上传（**不入库**）
web/                      # Vue3 前端（Vite 构建 → dist，由 8787 托管）
  src/App.vue             #   外壳 + 今日运营
  src/components/ModuleViews.vue   # 各功能模块
  src/account.js          #   登录/切换账号/退出登录（设置页与左下角弹框共用一套）
mcp/                      # 小红书 MCP 可执行文件（含 Mac Intel / ARM 双架构）
mac/                      # Mac 交付包
dist_delivery/            # 交付产物
docs/                     # 交付说明、需求文档、改版任务分配
.sdd/                     # 规格/决策/验证记录（SDD 流程）
scripts/                  # 工具脚本（交付、密钥清理、推送）
```

## 二、怎么跑起来

**Windows（客户机）**
```bat
双击 启动.bat
```
`启动.bat` 会依次拉起：① 连接服务（小红书 MCP，18060；没在跑才启动）② 本地服务（8787）③ 兼容地址（5199），并打开浏览器。
服务起在 `http://127.0.0.1:8787`，浏览器打开即用。

**Windows 首次配置（凭据 & 修复版 MCP）**
```bat
REM 1) 凭据：本地服务与 MCP 共用项目内这一份（不入库）
REM    启动.bat 已自动设置 XHS_COOKIE_FILE=<项目>\data\cookies.json
REM    若 MCP 由别处启动，请一并给它 COOKIES_PATH= 同一路径

REM 2) 修复版 MCP（带扫码会话修复）：装 Go 1.24 → 打补丁 → 编译到 .runtime\
git -C <xiaohongshu-mcp 检出> apply patches/mcp-login-session.patch
go test . -run TestLoginSession -count=1
go build -o "<项目>\.runtime\xiaohongshu-mcp-windows-amd64.exe" .
REM 之后 scripts\start-mcp-local.bat 会优先使用 .runtime\ 里的这一版
```
> macOS 的对应流程见 `docs/login-session-fix.md`（Wkk 提供，基线提交 6583124）。
> MCP 访问小红书需要代理（默认 `http://127.0.0.1:7890`）。


**手动/开发**
```bash
cd server && npm install && node --no-warnings src/index.js      # 后端 8787
cd web    && npm install && npm run build                        # 前端构建（产物由 8787 托管）
```

**配置（首次必做）**：打开页面 → 左下角/「系统设置」
1. **小红书账号**：点「扫码登录」（换号点「切换账号（扫码）」，会先退出当前账号出新码）
2. **文案/回复模型**：填 DeepSeek API Key → 点「保存并检查」（当场真调一次，通不过会报错）
3. **生图渠道**：选渠道 + 填 Key/Base → 「保存并检查」，必要时「试出一张」真验证

密钥只存本机 `server/.env`（**已被 .gitignore 排除，永不入库**）。

## 三、功能地图

| 模块 | 做什么 |
|---|---|
| 今日运营 | 粉丝/关注/点赞指标、内容增长趋势、待办、互动运营区（真实数据） |
| 内容工坊 | 统一生成入口（首次 7 天 / 之后 1 篇）、一起生图、生成后按策略时间自动排期、待发送内容池（7 天未排期自动清理、收藏永久保留）、行业热榜 |
| 排期发布 | 周视图（默认定位今天）、文章横条展开（左内容/右手机预览/预检框）、自动发送、发布保护五项预检、建议发布时间默认走运营策略 |
| 数据洞察 | 真实数据 + AI 整体解读 + 高潜内容方向建议 + 逐篇数据 |
| 运营大纲 | 三板块（人物设定/目标人群/核心要求）、完整运营策略（含发布时间表，是内容生成的基础框架）、**跟 AI 聊运营（带记忆，会真实改策略）**、互动区开关 |
| 文案库 | 内容库 + **资料库**（上传文档 → AI 提炼知识条目 → 评论回复有据可依，未命中不回复、转人工） |
| 系统设置 | 账号（扫码登录/切号/退出）、密钥手动填写+检查、内容与发布保护开关、评论自动回复、知识库（文档提炼 + AI 对话补全）、回复人设、禁用词表 |

## 四、交接注意

- **密钥**：仓库里不含任何真实 Key；交付时在「系统设置」里填客户自己的。
- **生图渠道**：`apikiki`（nano banana pro，实测 2K=2048×2048、4K=4096×4096）与 `qweapi`（gpt-image 系最高 1K；image2.5 需先在渠道方开通，否则 404）可在界面切换。
- **Mac 客户机**：需用 `mac/` 下的交叉编译产物（darwin-amd64 / darwin-arm64）。
- **发布安全**：默认「发布保护」开（五项预检全过才发）；「自动发送」关 = 到点转待确认，人工点确认才发。

## 五、交付脚本

```bash
bash scripts/purge-secrets.sh      # 推远端前：全历史密钥铲除（含防呆，必须先备份）
bash scripts/push-to-wkk.sh        # 一键推送（token 只在本次命令行使用，不落盘）
GITHUB_TOKEN=xxx FORCE=1 bash scripts/push-to-wkk.sh <repo_url> main   # 强推覆盖
```
