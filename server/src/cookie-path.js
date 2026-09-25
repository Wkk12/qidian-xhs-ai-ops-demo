import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 与本地 MCP 启动脚本的 COOKIES_PATH 一致；两处创作者数据接口共用此路径。
const projectCookie = fileURLToPath(new URL('../../data/cookies.json', import.meta.url));
export const CREATOR_COOKIE = process.env.XHS_COOKIE_FILE || process.env.COOKIES_PATH || projectCookie;

// 新检出项目没有运行时目录，先创建以便 MCP 在扫码成功后保存凭据。
fs.mkdirSync(path.dirname(CREATOR_COOKIE), { recursive: true, mode: 0o700 });
