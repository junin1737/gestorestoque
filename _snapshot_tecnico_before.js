const Firebird = require('node-firebird');
const fs = require('fs');

const dbOpts = {
  host: '127.0.0.1',
  port: 3050,
  database: 'C:/Work/MT/Limpo/Clipp/Base/CLIPP.FDB',
  user: 'SYSDBA',
  password: 'masterkey',
  charset: 'UTF8',
};

function q(db, sql) {
  return new Promise((resolve, reject) => {
    db.query(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

Firebird.attach(dbOpts, async (err, db) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  try {
    const snapshot = {
      createdAt: new Date().toISOString(),
      database: dbOpts.database,
      tables: {},
      generators: {},
      triggersByTable: {},
      procedures: [],
    };

    const tableRows = await q(
      db,
      "SELECT RDB$RELATION_NAME AS T FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL ORDER BY RDB$RELATION_NAME"
    );
    const tables = tableRows.map((r) => String(r.T).trim());

    for (const t of tables) {
      try {
        const cnt = await q(db, `SELECT COUNT(*) AS CNT FROM "${t}"`);
        snapshot.tables[t] = Number(cnt[0].CNT);
      } catch (e) {
        snapshot.tables[t] = `ERR:${e.message}`;
      }
    }

    const genRows = await q(
      db,
      "SELECT RDB$GENERATOR_NAME AS G FROM RDB$GENERATORS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 ORDER BY RDB$GENERATOR_NAME"
    );
    for (const row of genRows) {
      const g = String(row.G).trim();
      try {
        const val = await q(db, `SELECT GEN_ID(${g}, 0) AS V FROM RDB$DATABASE`);
        snapshot.generators[g] = Number(val[0].V);
      } catch (e) {
        snapshot.generators[g] = `ERR:${e.message}`;
      }
    }

    const trigRows = await q(
      db,
      "SELECT RDB$TRIGGER_NAME AS TNAME, RDB$RELATION_NAME AS TB, RDB$TRIGGER_INACTIVE AS INACT, RDB$TRIGGER_TYPE AS TTYPE FROM RDB$TRIGGERS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 ORDER BY RDB$RELATION_NAME, RDB$TRIGGER_NAME"
    );
    for (const row of trigRows) {
      const table = row.TB ? String(row.TB).trim() : null;
      const trigger = String(row.TNAME).trim();
      const info = {
        trigger,
        inactive: Number(row.INACT || 0),
        type: Number(row.TTYPE || 0),
      };
      if (!table) continue;
      if (!snapshot.triggersByTable[table]) snapshot.triggersByTable[table] = [];
      snapshot.triggersByTable[table].push(info);
    }

    const procRows = await q(
      db,
      "SELECT RDB$PROCEDURE_NAME AS P FROM RDB$PROCEDURES WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 ORDER BY RDB$PROCEDURE_NAME"
    );
    snapshot.procedures = procRows.map((r) => String(r.P).trim());

    fs.writeFileSync(
      'snapshot_tecnico_before.json',
      JSON.stringify(snapshot, null, 2),
      'utf8'
    );
    console.log('OK|snapshot_tecnico_before.json');
    console.log(`TABLES|${Object.keys(snapshot.tables).length}`);
    console.log(`GENERATORS|${Object.keys(snapshot.generators).length}`);
    console.log(`PROCEDURES|${snapshot.procedures.length}`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    db.detach(() => process.exit(0));
  }
});
