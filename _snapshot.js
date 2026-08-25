const Firebird = require('node-firebird');
const fs = require('fs');
const db_opts = {
  host: '127.0.0.1', port: 3050,
  database: 'C:/Work/MT/Limpo/Clipp/Base/CLIPP.FDB',
  user: 'SYSDBA', password: 'masterkey', charset: 'UTF8'
};

function q(db, sql) {
  return new Promise((res, rej) => db.query(sql, (e, r) => e ? rej(e) : res(r || [])));
}

Firebird.attach(db_opts, async (err, db) => {
  if (err) { console.error(err); process.exit(1); }
  try {
    const rows = await q(db, "SELECT RDB$RELATION_NAME AS TNAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL ORDER BY RDB$RELATION_NAME");
    const tables = rows.map(r => r.TNAME.trim());
    const results = {};
    for (const t of tables) {
      try {
        const r = await q(db, 'SELECT COUNT(*) AS CNT FROM "' + t + '"');
        results[t] = Number(r[0].CNT);
      } catch (e) {
        results[t] = 'ERR:' + e.message;
      }
    }
    const sorted = Object.entries(results).sort((a, b) => a[0].localeCompare(b[0]));
    sorted.forEach(([name, cnt]) => console.log(name + '|' + cnt));
    // Save to file for later comparison
    fs.writeFileSync('_snapshot_before.json', JSON.stringify(results, null, 2));
    console.log('\nSaved _snapshot_before.json (' + tables.length + ' tables)');
  } catch (e) {
    console.error(e);
  }
  db.detach(() => process.exit(0));
});
