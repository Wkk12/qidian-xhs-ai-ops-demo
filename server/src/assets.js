/**
 * 素材库路由 —— 「在线素材」= 上传图 + AI 生成图的统一存放位
 * 所有用过的图（上传的、生成的、历史素材）都在这里，供内容配图选用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, now, log } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(__dirname, '../data/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

function row(r) {
  return {
    id: r.id, kind: r.kind, name: r.name,
    url: r.web_path, path: r.file_path,
    width: r.width, height: r.height, size: r.size,
    tags: safeParse(r.tags), prompt: r.prompt,
    contentId: r.content_id, createdAt: r.created_at,
  };
}

function safeParse(s) { try { return JSON.parse(s || '[]'); } catch { return []; } }

/** 读图片宽高（仅 PNG/JPEG 头部，零依赖） */
function imageSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
    // PNG
    if (n > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG：扫描 SOF 段
    if (n > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < n - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* ignore */ }
  return { width: null, height: null };
}

export async function registerAssets(app) {
  // 列表（可按类型筛选：upload / generated / history）
  app.get('/api/assets', async (req) => {
    const { kind, limit = 200, contentId } = req.query || {};
    let sql = 'SELECT * FROM assets';
    const args = [], where = [];
    if (kind && kind !== '全部') { where.push('kind=?'); args.push(kind); }
    if (contentId) { where.push('content_id=?'); args.push(Number(contentId)); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY id DESC LIMIT ?';
    args.push(Number(limit));
    const rows = db.prepare(sql).all(...args);
    return { ok: true, count: rows.length, items: rows.map(row) };
  });

  // 上传（multipart；也支持 AI 生图落库）
  app.post('/api/assets/upload', async (req, reply) => {
    const parts = req.parts();
    const saved = [];
    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const ext = path.extname(part.filename || '').toLowerCase() || '.png';
      if (!IMG_EXT.includes(ext)) { part.file.resume(); continue; }
      const fname = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const fpath = path.join(UPLOAD_DIR, fname);
      await new Promise((res, rej) => {
        const ws = fs.createWriteStream(fpath);
        part.file.pipe(ws);
        ws.on('finish', res); ws.on('error', rej);
      });
      const st = fs.statSync(fpath);
      const dim = imageSize(fpath);
      const kind = String(part.fields?.kind?.value || 'upload');
      const info = db.prepare(`INSERT INTO assets (kind,name,file_path,web_path,mime,width,height,size,prompt,created_at)
                               VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(kind, part.filename || fname, fpath, `/files/${fname}`, part.mimetype || '',
             dim.width, dim.height, st.size, String(part.fields?.prompt?.value || ''), now());
      saved.push(Number(info.lastInsertRowid));
    }
    log('info', 'assets', `上传 ${saved.length} 个素材`);
    return { ok: true, ids: saved, count: saved.length };
  });

  // 登记一张已存在的本地图（AI 生图产出落库用）
  app.post('/api/assets/register', async (req) => {
    const { filePath, kind = 'generated', name, prompt, tags } = req.body || {};
    if (!filePath || !fs.existsSync(filePath)) {
      throw Object.assign(new Error('文件不存在: ' + filePath), { status: 400 });
    }
    const dim = imageSize(filePath);
    const st = fs.statSync(filePath);
    const info = db.prepare(`INSERT INTO assets (kind,name,file_path,web_path,mime,width,height,size,tags,prompt,created_at)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(kind, name || path.basename(filePath), filePath, '', '', dim.width, dim.height,
           st.size, JSON.stringify(tags || []), prompt || '', now());
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  // 删除（同时删文件）
  app.delete('/api/assets/:id', async (req) => {
    const r = db.prepare('SELECT * FROM assets WHERE id=?').get(Number(req.params.id));
    if (!r) throw Object.assign(new Error('素材不存在'), { status: 404 });
    if (r.file_path) { try { fs.unlinkSync(r.file_path); } catch { /* ignore */ } }
    db.prepare('DELETE FROM assets WHERE id=?').run(Number(req.params.id));
    return { ok: true };
  });

  // 把素材挂到某篇内容上（配图）
  app.post('/api/assets/:id/attach', async (req) => {
    const { contentId } = req.body || {};
    db.prepare('UPDATE assets SET content_id=? WHERE id=?').run(Number(contentId) || null, Number(req.params.id));
    return { ok: true };
  });
}
