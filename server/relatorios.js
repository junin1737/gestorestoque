'use strict';

const { withDb, query, hasTable, activeTargets } = require('./db');

function txt(v) {
  return String(v == null ? '' : v).trim();
}

function ordenar(lista) {
  return [...lista].sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR', { sensitivity: 'base' }));
}

function viewDe(appCfg) {
  const alvos = activeTargets(appCfg);
  if (alvos.some((a) => !a.manage) && hasTable('V_ESTOQUE')) return 'V_ESTOQUE';
  if (alvos.some((a) => a.manage) && hasTable('V_ESTOQUE_2')) return 'V_ESTOQUE_2';
  if (hasTable('V_ESTOQUE')) return 'V_ESTOQUE';
  if (hasTable('V_ESTOQUE_2')) return 'V_ESTOQUE_2';
  return '';
}

const GRUPOS = [
  { id: 'produtos', titulo: 'Produtos' },
];

const RELATORIOS = [
  {
    id: 'ncm-branco',
    grupo: 'produtos',
    titulo: 'NCM em branco ou inválido',
    colunas: [
      { id: 'id_identificador', titulo: 'Código' },
      { id: 'descricao', titulo: 'Descrição' },
      { id: 'ncm', titulo: 'NCM' },
    ],
  },
  {
    id: 'ncm-distintos',
    grupo: 'produtos',
    titulo: 'NCMs distintos',
    colunas: [
      { id: 'cod_ncm', titulo: 'NCM' },
    ],
  },
];

function catalogo() {
  const grupos = ordenar(GRUPOS).map((g) => ({
    id: g.id,
    titulo: g.titulo,
    relatorios: ordenar(RELATORIOS.filter((r) => r.grupo === g.id)).map((r) => ({ id: r.id, titulo: r.titulo })),
  }));
  return { ok: true, grupos };
}

async function executar(id) {
  const def = RELATORIOS.find((r) => r.id === id);
  if (!def) return { ok: false, error: 'Relatório não encontrado.' };
  return withDb(async (db, appCfg) => {
    const view = viewDe(appCfg);
    if (!view) return { ok: false, error: 'A view de estoque não está disponível nesta base.' };
    const emit = await query(db, `SELECT FIRST 1 NOME_FANTA, NOME FROM TB_EMITENTE`).catch(() => []);
    const empresa = txt(emit[0]?.NOME_FANTA || emit[0]?.NOME);
    if (id === 'ncm-distintos') {
      const rows = await query(db, `
        SELECT DISTINCT COD_NCM
          FROM ${view}
         WHERE COD_NCM IS NOT NULL
         ORDER BY COD_NCM`);
      return {
        ok: true,
        id,
        titulo: def.titulo,
        empresa,
        colunas: def.colunas,
        linhas: rows.map((r) => ({ cod_ncm: txt(r.COD_NCM) })),
      };
    }
    const rows = await query(db, `
      SELECT ID_IDENTIFICADOR, PROD_SERV AS DESCRICAO, COD_NCM AS NCM
        FROM ${view}
       WHERE COD_NCM = '00000000'
          OR COD_NCM IS NULL
          OR CHAR_LENGTH(COD_NCM) < 8
       ORDER BY COD_NCM, PROD_SERV`);
    return {
      ok: true,
      id,
      titulo: def.titulo,
      empresa,
      colunas: def.colunas,
      linhas: rows.map((r) => ({
        id_identificador: r.ID_IDENTIFICADOR,
        descricao: txt(r.DESCRICAO),
        ncm: txt(r.NCM),
      })),
    };
  });
}

module.exports = { catalogo, executar };
