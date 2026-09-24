// R19 验收：8 天前未收藏草稿 → 必须被清理；8 天前已收藏 → 必须活着；3 天前 → 必须活着
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/xhs-ops.db');
const iso = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 19).replace('T', ' ');
const ins = db.prepare('INSERT INTO contents (title, body, status, source, favorite, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
const a = ins.run('【测试】8天前未收藏草稿', '测试正文', 'draft', 'generated', 0, iso(8), iso(8));
const b = ins.run('【测试】8天前已收藏草稿', '测试正文', 'draft', 'generated', 1, iso(8), iso(8));
const c = ins.run('【测试】3天前未收藏草稿', '测试正文', 'draft', 'generated', 0, iso(3), iso(3));
const ids = { purgeCandidate: Number(a.lastInsertRowid), favorite: Number(b.lastInsertRowid), recent: Number(c.lastInsertRowid) };
const { purgeExpiredDrafts } = await import('./src/generate.js');
const dry = purgeExpiredDrafts({ dryRun: true });
const run = purgeExpiredDrafts();
const alive = (id) => !!db.prepare('SELECT id FROM contents WHERE id=?').get(id);
const after = {
  purgeCandidate: alive(ids.purgeCandidate),
  favorite: alive(ids.favorite),
  recent: alive(ids.recent),
};
console.log(JSON.stringify({
  ids,
  dryExpired: dry.expired.map((x) => x.id),
  deleted: run.deleted,
  after,
  verdict: (!after.purgeCandidate && after.favorite && after.recent) ? 'PASS' : 'FAIL',
}));
db.prepare('DELETE FROM contents WHERE id IN (?,?,?)').run(ids.purgeCandidate, ids.favorite, ids.recent);
