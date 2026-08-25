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

function fmtDelta(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 'n/a';
  const d = after - before;
  return d >= 0 ? `+${d}` : String(d);
}

Firebird.attach(dbOpts, async (err, db) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  try {
    const before = JSON.parse(fs.readFileSync('snapshot_tecnico_before.json', 'utf8'));
    const after = {
      createdAt: new Date().toISOString(),
      database: dbOpts.database,
      tables: {},
      generators: {},
    };

    const tableRows = await q(
      db,
      "SELECT RDB$RELATION_NAME AS T FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL ORDER BY RDB$RELATION_NAME"
    );
    const tables = tableRows.map((r) => String(r.T).trim());
    for (const t of tables) {
      try {
        const cnt = await q(db, `SELECT COUNT(*) AS CNT FROM "${t}"`);
        after.tables[t] = Number(cnt[0].CNT);
      } catch (e) {
        after.tables[t] = `ERR:${e.message}`;
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
        after.generators[g] = Number(val[0].V);
      } catch (e) {
        after.generators[g] = `ERR:${e.message}`;
      }
    }

    fs.writeFileSync('snapshot_tecnico_after.json', JSON.stringify(after, null, 2), 'utf8');

    const tableDiff = [];
    const allTables = new Set([
      ...Object.keys(before.tables || {}),
      ...Object.keys(after.tables || {}),
    ]);
    for (const t of allTables) {
      const b = before.tables[t];
      const a = after.tables[t];
      if (String(b) !== String(a)) {
        tableDiff.push({ table: t, before: b, after: a });
      }
    }
    tableDiff.sort((x, y) => {
      const dx = Math.abs((Number(y.after) || 0) - (Number(y.before) || 0));
      const dy = Math.abs((Number(x.after) || 0) - (Number(x.before) || 0));
      if (dx !== dy) return dx - dy;
      return x.table.localeCompare(y.table);
    });

    const genDiff = [];
    const allGens = new Set([
      ...Object.keys(before.generators || {}),
      ...Object.keys(after.generators || {}),
    ]);
    for (const g of allGens) {
      const b = before.generators[g];
      const a = after.generators[g];
      if (String(b) !== String(a)) genDiff.push({ generator: g, before: b, after: a });
    }
    genDiff.sort((a, b) => a.generator.localeCompare(b.generator));

    const lines = [];
    lines.push('# Relatorio Tecnico de Diferencas');
    lines.push('');
    lines.push(`Base: ${dbOpts.database}`);
    lines.push(`Before: ${before.createdAt || 'n/a'}`);
    lines.push(`After: ${after.createdAt}`);
    lines.push('');
    lines.push(`Tabelas alteradas: ${tableDiff.length}`);
    lines.push(`Generators alterados: ${genDiff.length}`);
    lines.push('');
    lines.push('## Tabelas alteradas');
    for (const d of tableDiff) {
      lines.push(`- ${d.table}: ${d.before} -> ${d.after} (${fmtDelta(d.before, d.after)})`);
      const trigs = (before.triggersByTable && before.triggersByTable[d.table]) || [];
      if (trigs.length) {
        const active = trigs.filter((t) => Number(t.inactive) === 0).map((t) => t.trigger);
        if (active.length) lines.push(`  - triggers ativas relacionadas: ${active.join(', ')}`);
      }
    }
    lines.push('');
    lines.push('## Generators alterados');
    for (const g of genDiff) {
      lines.push(`- ${g.generator}: ${g.before} -> ${g.after} (${fmtDelta(g.before, g.after)})`);
    }
    lines.push('');
    lines.push('## Observacao');
    lines.push(
      '- Firebird nao registra historico de chamada de procedures/triggers por operacao sem trace/auditoria ativa. Este relatorio mostra evidencias por efeitos (tabelas + generators) e triggers relacionadas por tabela alterada.'
    );

    fs.writeFileSync('relatorio_tecnico_diferencas.md', lines.join('\n'), 'utf8');

    console.log(`TABLE_DIFF|${tableDiff.length}`);
    console.log(`GEN_DIFF|${genDiff.length}`);
    console.log('REPORT|relatorio_tecnico_diferencas.md');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    db.detach(() => process.exit(0));
  }
});
