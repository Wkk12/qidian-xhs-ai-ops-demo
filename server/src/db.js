/**
 * 本地数据层 —— Node 22 内置 node:sqlite，零额外依赖、零安装（客户不用装数据库）
 * 表结构对应开发计划 P1：账号/内容/素材/计划/发布任务/指标/评论/知识库/设置
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'xhs-ops.db'));
/**
 * 轻量迁移：给已存在的表补列。
 * SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS → 先查 PRAGMA 再改。
 * 新增字段时，除了改上面的 CREATE TABLE，也要在这里补一条。
 */
function migrate(d) {
  const cols = (t) => {
    try { return d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); }
    catch { return []; }
  };
  const add = (t, col, type) => {
    if (cols(t).length && !cols(t).includes(col)) {
      try { d.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${type}`); } catch { /* 已存在则忽略 */ }
    }
  };
  add('trends', 'xsec_token', 'TEXT');
}
migrate(db);


db.exec(`
PRAGMA journal_mode = WAL;

-- 账号（小红书授权 + 模型密钥，密钥只存本机，前端只回掩码）
CREATE TABLE IF NOT EXISTS accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  platform     TEXT NOT NULL DEFAULT 'xiaohongshu',
  nickname     TEXT,
  user_id      TEXT,
  red_id       TEXT,
  avatar       TEXT,
  is_logged_in INTEGER DEFAULT 0,
  updated_at   TEXT
);

-- 配置/密钥（value 存密文，前端只读 masked）
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  masked     TEXT,
  updated_at TEXT
);

-- 账号定位（P3）
CREATE TABLE IF NOT EXISTS positioning (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  persona     TEXT,           -- 人设
  audience    TEXT,           -- 受众
  pillars     TEXT,           -- 内容支柱(JSON)
  tone        TEXT,           -- 语气
  selling     TEXT,           -- 卖点
  goal        TEXT,           -- 转化目标
  updated_at  TEXT
);

-- 文案库（历史 + 生成），查重门禁比对源
CREATE TABLE IF NOT EXISTS contents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT,           -- history | generated | manual
  title       TEXT,
  body        TEXT,
  tags        TEXT,           -- JSON
  cover_text  TEXT,
  images      TEXT,           -- JSON: [{path,type,source}]
  status      TEXT,           -- draft | approved | scheduled | published | rejected
  dup_score   REAL,           -- 查重得分
  dup_with    INTEGER,        -- 与哪篇相似
  plan_id     INTEGER,
  day_index   INTEGER,        -- 周计划里第几天
  created_at  TEXT,
  updated_at  TEXT
);

-- 周计划/大纲（P4）
CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start  TEXT,
  theme       TEXT,           -- 周主题/主线
  nodes       TEXT,           -- JSON: 七天节点[{day,承接,提供,留给}]
  status      TEXT,           -- drafting | confirmed | running
  version     INTEGER DEFAULT 1,
  created_at  TEXT,
  updated_at  TEXT
);

-- 行业热榜（定时/手动抓取的小红书热门笔记，供内容生成参考）
CREATE TABLE IF NOT EXISTS trends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword     TEXT,
  note_id     TEXT UNIQUE,
  title       TEXT,
  author      TEXT,
  author_id   TEXT,
  liked       INTEGER DEFAULT 0,
  collected   INTEGER DEFAULT 0,
  commented   INTEGER DEFAULT 0,
  cover       TEXT,
  url         TEXT,
  note_time   TEXT,
  xsec_token  TEXT,
  scraped_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_trends_kw ON trends(keyword, scraped_at);

-- 发布任务（P6，持久化状态机，重启可恢复）
CREATE TABLE IF NOT EXISTS publish_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  INTEGER,
  scheduled_at TEXT,
  status      TEXT,           -- pending | publishing | done | failed | canceled
  retry       INTEGER DEFAULT 0,
  note_id     TEXT,           -- 平台返回的笔记ID
  error       TEXT,
  created_at  TEXT,
  updated_at  TEXT
);

-- 指标快照（P7，M4 数据分析）
CREATE TABLE IF NOT EXISTS metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     TEXT,
  date        TEXT,
  views       INTEGER, likes INTEGER, collects INTEGER, comments INTEGER, shares INTEGER,
  fans_delta  INTEGER,
  raw         TEXT,           -- JSON 原始
  created_at  TEXT
);

-- 同行监控（P7）
CREATE TABLE IF NOT EXISTS competitors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT, nickname TEXT, note TEXT,
  created_at  TEXT
);

-- 评论 + 回复记录（M6，人工复核可查可改可撤回）
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     TEXT,
  comment_id  TEXT,
  user_name   TEXT,
  content     TEXT,
  replied     INTEGER DEFAULT 0,
  reply_text  TEXT,
  reply_status TEXT,          -- auto | manual | pending_review | skipped
  created_at  TEXT
);

-- 知识库（M5/M6，用于评论区回复；必须来源此处）
CREATE TABLE IF NOT EXISTS knowledge (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT,
  question    TEXT,
  answer      TEXT,
  keywords    TEXT,
  enabled     INTEGER DEFAULT 1,
  created_at  TEXT
);

-- 素材库（「在线素材」= 上传图 + AI 生成图的统一存放位，所有用过的图都在这里）
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT,           -- upload(上传) | generated(AI生成) | history(历史素材)
  name        TEXT,
  file_path   TEXT,           -- 本机绝对路径
  web_path    TEXT,           -- 前端可访问路径 /files/xxx
  mime        TEXT,
  width       INTEGER, height INTEGER, size INTEGER,
  tags        TEXT,           -- JSON
  prompt      TEXT,           -- 生成用提示词（AI 生图时记）
  content_id  INTEGER,        -- 被哪篇内容用过
  created_at  TEXT
);

-- 运行日志（脱敏）
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT, module TEXT, message TEXT, created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_contents_status ON contents(status);
CREATE INDEX IF NOT EXISTS idx_publish_status ON publish_tasks(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_metrics_note ON metrics(note_id, date);
`);

// 轻量迁移（列不存在时才加）
for (const sql of [
  'ALTER TABLE contents ADD COLUMN note_id TEXT',      // 导入小红书历史笔记时记录笔记ID
  'ALTER TABLE contents ADD COLUMN source_url TEXT',   // 原帖链接
]) {
  try { db.exec(sql); } catch { /* 列已存在 */ }
}

export const now = () => new Date().toISOString();

export function log(level, module, message) {
  try {
    db.prepare('INSERT INTO logs (level,module,message,created_at) VALUES (?,?,?,?)')
      .run(level, module, String(message).slice(0, 1000), now());
  } catch { /* 日志失败不影响主流程 */ }
}
