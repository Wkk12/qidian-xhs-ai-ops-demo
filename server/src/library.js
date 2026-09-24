/**
 * 资料库（R24）
 *  上传 docx / pdf / txt / md → 服务端解析全文 → 切成「AI 可识别的知识条目」写进 knowledge 表
 *  → 评论自动回复的 matchKnowledge 本来就读 knowledge 表 ⇒ 回复立即有资料支撑（不能乱回复）
 *
 * 解析策略（尽量零依赖）：
 *  - txt / md：直接读文本
 *  - docx：zip 中央目录 + zlib.inflateRawSync 取 word/document.xml（纯 Node，零依赖）
 *  - pdf：调本机 Python（PyMuPDF / pypdf / PyPDF2 任一）；都装不上则明确报错，不假装成功
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, now, log } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LIBRARY_DIR = path.resolve(__dirname, '../data/library');
fs.mkdirSync(LIBRARY_DIR, { recursive: true });

const DOC_EXT = ['.docx', '.pdf', '.txt', '.md', '.markdown'];
const MAX_ENTRIES = 200;
const CHUNK = 520;

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_docs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT,
      ext         TEXT,
      size        INTEGER,
      file_path   TEXT,
      text        TEXT,          -- 解析出的全文
      chars       INTEGER,
      entries     INTEGER,       -- 生成的知识条目数
      status      TEXT,          -- ok | parse_failed
      note        TEXT,          -- 解析失败原因等
      created_at  TEXT
    );
  `);
  for (const sql of [
    'ALTER TABLE knowledge ADD COLUMN source TEXT',
    'ALTER TABLE knowledge ADD COLUMN doc_id INTEGER',
  ]) {
    try { db.exec(sql); } catch { /* 列已存在 */ }
  }
}

/* ---------------- 解析 ---------------- */

function readZipEntry(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const fname = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (fname === want) {
      const lnameLen = buf.readUInt16LE(localOff + 26);
      const lextraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lnameLen + lextraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function xmlToText(xml) {
  return String(xml)
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseDocx(file) {
  const buf = fs.readFileSync(file);
  const doc = readZipEntry(buf, 'word/document.xml');
  if (!doc) throw new Error('docx 结构异常：没找到 word/document.xml');
  return xmlToText(doc.toString('utf8'));
}

const PDF_PY = `
import sys, json
p = sys.argv[1]
txt = ''
err = ''
for mod in ('fitz', 'pypdf', 'PyPDF2'):
    try:
        if mod == 'fitz':
            import fitz
            d = fitz.open(p)
            txt = "\\n".join(pg.get_text() for pg in d)
        elif mod == 'pypdf':
            from pypdf import PdfReader
            txt = "\\n".join((pg.extract_text() or '') for pg in PdfReader(p).pages)
        else:
            from PyPDF2 import PdfReader
            txt = "\\n".join((pg.extract_text() or '') for pg in PdfReader(p).pages)
        err = ''
        break
    except Exception as e:
        err = "%s: %s" % (mod, e)
print(json.dumps({'ok': bool(txt.strip()), 'chars': len(txt), 'err': err, 'text': txt}))
`;

function parsePdf(file) {
  const py = process.env.PYTHON || 'python';
  const r = spawnSync(py, ['-c', PDF_PY, file], { encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, timeout: 120000 });
  if (r.error) throw new Error('无法调用本机 Python 解析 PDF：' + r.error.message);
  const out = String(r.stdout || '').trim().split('\n').pop() || '';
  let j = null;
  try { j = JSON.parse(out); } catch { j = null; }
  if (!j) throw new Error('PDF 解析无输出（stderr: ' + String(r.stderr || '').slice(0, 200) + '）');
  if (!j.ok) throw new Error('PDF 解析失败（需本机安装 PyMuPDF/pypdf）：' + (j.err || '').slice(0, 160));
  return j.text;
}

export function parseDocument(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') return fs.readFileSync(file, 'utf8');
  if (ext === '.docx') return parseDocx(file);
  if (ext === '.pdf') return parsePdf(file);
  throw new Error('不支持的格式：' + ext);
}

/* ---------------- 全文 → 知识条目 ---------------- */

const STOP = new Set(['我们', '你们', '他们', '这个', '那个', '就是', '但是', '因为', '所以', '如果', '可以', '需要', '进行', '一个', '什么', '怎么', '以及', '还有', '自己', '这样', 'these', 'the', 'and']);

/**
 * 从一段文字里抽关键词
 * matchKnowledge 的判据是 `提问文本.includes(关键词)` → 关键词必须是**短而具体的实词**。
 * 第一版抽的是 2-8 字连续片段（整句碎片），实测永远命中不了（score 恒 0）—— 这里改成：
 *   统计 2/3/4 字片段出现次数 → 取重复出现(≥2)且互不包含的短词 → 不够再补长词。
 */
function keywordsOf(text, docName) {
  const t = String(text || '').replace(/\s+/g, '');
  const cand = new Map();
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= t.length; i++) {
      const w = t.slice(i, i + n);
      if (!/[\u4e00-\u9fa5A-Za-z]/.test(w[0]) || STOP.has(w)) continue;
      cand.set(w, (cand.get(w) || 0) + 1);
    }
  }
  const picked = [];
  const strong = [...cand.entries()].filter(([, c]) => c >= 2 && c <= 40)
    .sort((a, b) => (b[1] * b[0].length) - (a[1] * a[0].length));
  for (const [w] of strong) {
    if (picked.length >= 10) break;
    if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
    picked.push(w);
  }
  if (picked.length < 6) {
    for (const [w] of [...cand.entries()].filter(([w, c]) => c === 1 && w.length >= 3)) {
      if (picked.length >= 8) break;
      if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
      picked.push(w);
    }
  }
  const out = [...new Set([...picked, docName ? String(docName).replace(/\.[a-z]+$/i, '') : ''].filter(Boolean))];
  return out.slice(0, 12);
}

/** 把全文切成 300–600 字的块，每块一条知识条目 */
export function splitChunks(text) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).flatMap((p) => (p.length > 900 ? p.split(/(?<=[。！？；\n])/) : [p]))
    .map((s) => s.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of paras) {
    if (!cur) { cur = p; continue; }
    if ((cur + '\n' + p).length <= CHUNK) cur = cur + '\n' + p;
    else { out.push(cur); cur = p; }
  }
  if (cur) out.push(cur);
  return out.filter((s) => s.replace(/\s/g, '').length >= 24).slice(0, MAX_ENTRIES);
}

/** 用全文重建该文档的知识条目（先清旧的，再写新的） */
export function rebuildEntries(docId) {
  ensureTables();
  const doc = db.prepare('SELECT * FROM library_docs WHERE id=?').get(Number(docId));
  if (!doc) throw Object.assign(new Error('资料不存在'), { status: 404 });
  db.prepare('DELETE FROM knowledge WHERE doc_id=?').run(doc.id);
  const chunks = splitChunks(doc.text || '');
  let n = 0;
  for (const c of chunks) {
    const firstLine = c.split('\n').map((s) => s.trim()).filter(Boolean)[0] || doc.name;
    const question = firstLine.length > 40 ? firstLine.slice(0, 40) : firstLine;
    const kws = keywordsOf(c, doc.name);
    db.prepare('INSERT INTO knowledge (category,question,answer,keywords,enabled,created_at,source,doc_id) VALUES (?,?,?,?,1,?,?,?)')
      .run('资料库·' + doc.name, question, c, JSON.stringify(kws), now(), 'library', doc.id);
    n++;
  }
  db.prepare('UPDATE library_docs SET entries=? WHERE id=?').run(n, doc.id);
  log('info', 'library', `资料《${doc.name}》生成知识条目 ${n} 条`);
  return n;
}

/* ---------------- 路由 ---------------- */

export async function registerLibraryApi(app) {
  ensureTables();

  app.get('/api/library', async () => {
    const rows = db.prepare('SELECT id,name,ext,size,chars,entries,status,note,created_at,substr(text,1,160) AS preview FROM library_docs ORDER BY id DESC').all();
    const total = db.prepare("SELECT COUNT(*) AS n FROM knowledge WHERE source='library'").get();
    return { ok: true, count: rows.length, entries: Number(total?.n || 0), items: rows };
  });

  app.get('/api/library/:id', async (req) => {
    const d = db.prepare('SELECT * FROM library_docs WHERE id=?').get(Number(req.params.id));
    if (!d) throw Object.assign(new Error('资料不存在'), { status: 404 });
    return { ok: true, doc: { ...d, text: String(d.text || '').slice(0, 4000) } };
  });

  app.post('/api/library/:id/rebuild', async (req) => {
    const n = rebuildEntries(Number(req.params.id));
    return { ok: true, entries: n };
  });

  app.delete('/api/library/:id', async (req) => {
    const id = Number(req.params.id);
    const d = db.prepare('SELECT * FROM library_docs WHERE id=?').get(id);
    if (!d) throw Object.assign(new Error('资料不存在'), { status: 404 });
    const del = db.prepare('DELETE FROM knowledge WHERE doc_id=?').run(id);
    db.prepare('DELETE FROM library_docs WHERE id=?').run(id);
    try { if (d.file_path) fs.unlinkSync(d.file_path); } catch { /* ignore */ }
    log('info', 'library', `删除资料《${d.name}》（连带知识条目 ${del.changes} 条）`);
    return { ok: true, removedEntries: Number(del.changes || 0) };
  });

  // 上传：docx / pdf / txt / md（可多文件）
  app.post('/api/library/upload', async (req) => {
    const parts = req.parts();
    const saved = [];
    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const ext = path.extname(part.filename || '').toLowerCase();
      const fname = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext || '.dat'}`;
      const fpath = path.join(LIBRARY_DIR, fname);
      await new Promise((res, rej) => {
        const ws = fs.createWriteStream(fpath);
        part.file.pipe(ws);
        ws.on('finish', res); ws.on('error', rej);
      });
      const st = fs.statSync(fpath);
      const base = { name: part.filename || fname, ext, size: st.size, file_path: fpath, created_at: now() };
      if (!DOC_EXT.includes(ext)) {
        const info = db.prepare(`INSERT INTO library_docs (name,ext,size,file_path,text,chars,entries,status,note,created_at)
                                 VALUES (?,?,?,?,'',0,0,'parse_failed',?,?)`)
          .run(base.name, ext, st.size, fpath, '不支持的格式（只支持 docx / pdf / txt / md）', base.created_at);
        saved.push({ id: Number(info.lastInsertRowid), name: base.name, status: 'parse_failed' });
        continue;
      }
      let text = '', status = 'ok', note = '';
      try {
        text = parseDocument(fpath);
        if (!String(text).trim()) { status = 'parse_failed'; note = '解析结果为空（可能是扫描件/图片型 PDF）'; }
      } catch (e) {
        status = 'parse_failed';
        note = String(e.message || e).slice(0, 240);
        log('error', 'library', `解析失败 ${base.name}: ${note}`);
      }
      const info = db.prepare(`INSERT INTO library_docs (name,ext,size,file_path,text,chars,entries,status,note,created_at)
                               VALUES (?,?,?,?,?,?,0,?,?,?)`)
        .run(base.name, ext, st.size, fpath, text, String(text).length, status, note, base.created_at);
      const id = Number(info.lastInsertRowid);
      let entries = 0;
      if (status === 'ok') entries = rebuildEntries(id);
      saved.push({ id, name: base.name, status, chars: String(text).length, entries, note });
    }
    return { ok: true, items: saved, count: saved.length };
  });
}
