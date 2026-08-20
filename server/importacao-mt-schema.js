'use strict';

const { query, hasTable, refreshTables, refreshGenerators, columnExists } = require('./db');

const TABLE = 'TB_MT_REGRA_TRIBUTO';
const GEN = 'GEN_TB_MT_REGRA_TRIBUTO_ID';

const EXTRA_COLUMNS = [
  ['CSOSN_ENTRADA', 'VARCHAR(3)'],
  ['CSOSN_SAIDA', 'VARCHAR(3)'],
  ['CST_ENTRADA', 'VARCHAR(3)'],
  ['CST_SAIDA', 'VARCHAR(3)'],
  ['CST_CFE', 'VARCHAR(3)'],
  ['CSOSN_CFE', 'VARCHAR(3)'],
  ['CST_PIS_ENTRADA', 'VARCHAR(2)'],
  ['CST_PIS_SAIDA', 'VARCHAR(2)'],
  ['CST_COFINS_ENTRADA', 'VARCHAR(2)'],
  ['CST_COFINS_SAIDA', 'VARCHAR(2)'],
];

async function ensureColumn(db, column, ddlType) {
  if (await columnExists(db, TABLE, column)) return;
  await query(db, `ALTER TABLE ${TABLE} ADD ${column} ${ddlType}`);
}

async function ensureMtRegraTributo(db) {
  await refreshTables(db);
  if (!hasTable(TABLE)) {
    await query(db, `
      CREATE TABLE ${TABLE} (
        ID_REGRA INTEGER NOT NULL,
        ID_FORNEC INTEGER,
        ID_IDENTIFICADOR INTEGER,
        COD_FORNECEDOR VARCHAR(60),
        CFOP_ENTRADA VARCHAR(4),
        CFOP_SAIDA VARCHAR(4),
        CFOP_NF VARCHAR(4),
        CST VARCHAR(3),
        CSOSN VARCHAR(3),
        CST_PIS VARCHAR(2),
        CST_COFINS VARCHAR(2),
        CSOSN_ENTRADA VARCHAR(3),
        CSOSN_SAIDA VARCHAR(3),
        CST_ENTRADA VARCHAR(3),
        CST_SAIDA VARCHAR(3),
        CST_CFE VARCHAR(3),
        CSOSN_CFE VARCHAR(3),
        CST_PIS_ENTRADA VARCHAR(2),
        CST_PIS_SAIDA VARCHAR(2),
        CST_COFINS_ENTRADA VARCHAR(2),
        CST_COFINS_SAIDA VARCHAR(2),
        PIS NUMERIC(18,4),
        COFINS NUMERIC(18,4),
        ID_CTI VARCHAR(10),
        ID_CTI_CFE VARCHAR(10),
        ID_CLASS_TRIB INTEGER,
        ID_CLASS_TRIB_NFCE INTEGER,
        APLICAR_SAIDA CHAR(1) DEFAULT 'S',
        PRIORIDADE INTEGER DEFAULT 100,
        STATUS CHAR(1) DEFAULT 'A',
        OBS VARCHAR(200),
        CREATED_AT TIMESTAMP,
        UPDATED_AT TIMESTAMP,
        CONSTRAINT PK_TB_MT_REGRA_TRIBUTO PRIMARY KEY (ID_REGRA)
      )`);
    await refreshTables(db);
  } else {
    for (const [col, typ] of EXTRA_COLUMNS) {
      try {
        await ensureColumn(db, col, typ);
      } catch (e) {
        console.warn(`Coluna ${col} TB_MT_REGRA_TRIBUTO:`, e.message);
      }
    }
    // Migra campos legados → novos (só onde o novo está vazio)
    try {
      await query(db, `
        UPDATE ${TABLE} SET CSOSN_SAIDA = CSOSN
        WHERE (CSOSN_SAIDA IS NULL OR CSOSN_SAIDA = '')
          AND CSOSN IS NOT NULL AND CSOSN <> ''`);
      await query(db, `
        UPDATE ${TABLE} SET CST_ENTRADA = CST
        WHERE (CST_ENTRADA IS NULL OR CST_ENTRADA = '')
          AND CST IS NOT NULL AND CST <> ''`);
      await query(db, `
        UPDATE ${TABLE} SET CST_PIS_ENTRADA = CST_PIS
        WHERE (CST_PIS_ENTRADA IS NULL OR CST_PIS_ENTRADA = '')
          AND CST_PIS IS NOT NULL AND CST_PIS <> ''`);
      await query(db, `
        UPDATE ${TABLE} SET CST_PIS_SAIDA = CST_PIS
        WHERE (CST_PIS_SAIDA IS NULL OR CST_PIS_SAIDA = '')
          AND CST_PIS IS NOT NULL AND CST_PIS <> ''`);
      await query(db, `
        UPDATE ${TABLE} SET CST_COFINS_ENTRADA = CST_COFINS
        WHERE (CST_COFINS_ENTRADA IS NULL OR CST_COFINS_ENTRADA = '')
          AND CST_COFINS IS NOT NULL AND CST_COFINS <> ''`);
      await query(db, `
        UPDATE ${TABLE} SET CST_COFINS_SAIDA = CST_COFINS
        WHERE (CST_COFINS_SAIDA IS NULL OR CST_COFINS_SAIDA = '')
          AND CST_COFINS IS NOT NULL AND CST_COFINS <> ''`);
    } catch (e) {
      console.warn('Migração colunas regra:', e.message);
    }
  }

  await refreshGenerators(db);
  const gens = await query(db, `
    SELECT 1 AS OK FROM RDB$GENERATORS
    WHERE TRIM(RDB$GENERATOR_NAME) = ?`, [GEN]);
  if (!gens.length) {
    await query(db, `CREATE GENERATOR ${GEN}`);
    await query(db, `SET GENERATOR ${GEN} TO 0`);
    await refreshGenerators(db);
  }
}

module.exports = {
  TABLE,
  GEN,
  ensureMtRegraTributo,
};
