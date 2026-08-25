const Firebird = require('node-firebird');
const fs = require('fs');

const before = JSON.parse(fs.readFileSync('_snapshot_before.json', 'utf8'));
const dbOpts = {
  host: '127.0.0.1',
  port: 3050,
  database: 'C:/Work/MT/Limpo/Clipp/Base/CLIPP.FDB',
  user: 'SYSDBA',
  password: 'masterkey',
  charset: 'UTF8',
};

function q(db, sql) {
  return new Promise((res, rej) => db.query(sql, (e, r) => (e ? rej(e) : res(r || []))));
}

Firebird.attach(dbOpts, async (err, db) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  try {
    const rows = await q(
      db,
      'SELECT RDB$RELATION_NAME AS TNAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL ORDER BY RDB$RELATION_NAME'
    );
    const tables = rows.map((r) => r.TNAME.trim());
    const after = {};
    for (const t of tables) {
      try {
        const r = await q(db, 'SELECT COUNT(*) AS CNT FROM "' + t + '"');
        after[t] = Number(r[0].CNT);
      } catch (e) {
        after[t] = 'ERR:' + e.message;
      }
    }

    fs.writeFileSync('_snapshot_after.json', JSON.stringify(after, null, 2));

    const all = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed = [];
    for (const t of all) {
      const b = before[t];
      const a = after[t];
      if (String(b) !== String(a)) {
        const delta = Number.isFinite(b) && Number.isFinite(a) ? a - b : null;
        changed.push({ table: t, before: b, after: a, delta });
      }
    }

    changed.sort((x, y) => {
      const ax = Math.abs(x.delta ?? 0);
      const ay = Math.abs(y.delta ?? 0);
      if (ay !== ax) return ay - ax;
      return x.table.localeCompare(y.table);
    });

    console.log('CHANGED_TOTAL|' + changed.length);
    for (const c of changed) {
      const d = c.delta === null ? 'n/a' : (c.delta >= 0 ? '+' : '') + c.delta;
      console.log(`${c.table}|${c.before}|${c.after}|${d}`);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    db.detach(() => process.exit(0));
  }
});
