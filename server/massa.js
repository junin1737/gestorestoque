'use strict';

const { withDb, withTransaction, query, writeTargets } = require('./db');
const { insertAudit } = require('./audit');

const FISCAIS = [
  { k: 'ncm', rotulo: 'NCM', tabela: 'produto', col: 'COD_NCM', digitos: 8 },
  { k: 'cest', rotulo: 'CEST', tabela: 'produto', col: 'COD_CEST', digitos: 7 },
  { k: 'cfop', rotulo: 'CFOP saída', tabela: 'estoque', col: 'CFOP' },
  { k: 'cfop_nf', rotulo: 'CFOP NF', tabela: 'estoque', col: 'CFOP_NF' },
  { k: 'cst', rotulo: 'CST ICMS', tabela: 'produto', col: 'CST' },
  { k: 'csosn', rotulo: 'CSOSN', tabela: 'produto', col: 'CSOSN' },
  { k: 'cst_cfe', rotulo: 'CST CF-e', tabela: 'produto', col: 'CST_CFE' },
  { k: 'csosn_cfe', rotulo: 'CSOSN CF-e', tabela: 'produto', col: 'CSOSN_CFE' },
  { k: 'cst_pis', rotulo: 'CST PIS', tabela: 'estoque', col: 'CST_PIS' },
  { k: 'pis', rotulo: 'Alíquota PIS', tabela: 'estoque', col: 'PIS', numero: true },
  { k: 'cst_cofins', rotulo: 'CST COFINS', tabela: 'estoque', col: 'CST_COFINS' },
  { k: 'cofins', rotulo: 'Alíquota COFINS', tabela: 'estoque', col: 'COFINS', numero: true },
  { k: 'id_cti', rotulo: 'Taxa ICMS', tabela: 'estoque', col: 'ID_CTI' },
  { k: 'id_cti_cfe', rotulo: 'Taxa ICMS CF-e', tabela: 'estoque', col: 'ID_CTI_CFE' },
];

const LOJA = [
  { k: 'descricao', rotulo: 'Descrição', tabela: 'estoque', col: 'DESCRICAO', max: 120 },
  { k: 'id_grupo', rotulo: 'Grupo', tabela: 'estoque', col: 'ID_GRUPO', inteiro: true },
  { k: 'uni_medida', rotulo: 'Unidade', tabela: 'estoque', col: 'UNI_MEDIDA', max: 6 },
  { k: 'cod_barras', rotulo: 'Código de barras', tabela: 'produto', col: 'COD_BARRA', max: 20 },
  { k: 'referencia', rotulo: 'Referência', tabela: 'produto', col: 'REFERENCIA', max: 20 },
  { k: 'status', rotulo: 'Situação', tabela: 'estoque', col: 'STATUS' },
  { k: 'prc_venda', rotulo: 'Preço de venda', tabela: 'estoque', col: 'PRC_VENDA', numero: true },
  { k: 'prc_custo', rotulo: 'Preço de custo', tabela: 'estoque', col: 'PRC_CUSTO', numero: true },
];

const LIMITE = 800;

function txt(v) {
  return String(v == null ? '' : v).trim();
}

function camposPermitidos(modo) {
  return modo === 'contador' ? FISCAIS : FISCAIS.concat(LOJA);
}

function normalizar(campo, valor) {
  if (valor == null || String(valor).trim() === '') return undefined;
  if (campo.digitos) return String(valor).replace(/\D/g, '').slice(0, campo.digitos) || null;
  if (campo.numero) {
    const n = Number(String(valor).replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  if (campo.inteiro) {
    const n = Number(valor);
    return Number.isInteger(n) ? n : undefined;
  }
  if (campo.k === 'status') return String(valor).trim().toUpperCase() === 'I' ? 'I' : 'A';
  const s = txt(valor);
  return campo.max ? s.slice(0, campo.max) : s;
}

function valorAtual(row, campo) {
  const bruto = row[campo.col];
  if (bruto == null || bruto === '') return '';
  if (campo.numero || campo.inteiro) return Number(bruto);
  return txt(bruto);
}

function igual(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return Number(a || 0) === Number(b || 0);
  return String(a ?? '') === String(b ?? '');
}

async function contexto() {
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    let simples = false;
    try {
      const rows = await query(db, `SELECT FIRST 1 SIMPLES, NOME_FANTA, NOME, CNPJ FROM TB_EMITENTE`);
      const r = rows[0] || {};
      simples = txt(r.SIMPLES).toUpperCase() === 'S';
      return {
        ok: true,
        simples,
        regime: simples ? 'Simples Nacional' : 'Regime normal',
        nome: txt(r.NOME_FANTA || r.NOME),
        cnpj: txt(r.CNPJ).replace(/\D/g, ''),
        grupos: await listarGrupos(db, alvo.tables),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

async function listarGrupos(db, t) {
  try {
    const rows = await query(db, `SELECT ID_GRUPO, DESCRICAO FROM ${t.grupo} ORDER BY DESCRICAO`);
    return rows.map((r) => ({ id: Number(r.ID_GRUPO), descricao: txt(r.DESCRICAO) }));
  } catch {
    return [];
  }
}

function montarWhere(body, simples) {
  const filtro = body.filtro || {};
  const condicoes = Array.isArray(body.condicoes) ? body.condicoes : [];
  const where = [`(E.STATUS = 'A' OR E.STATUS IS NULL OR E.STATUS = 'I')`];
  const params = [];
  const ncmFiltro = txt(filtro.ncm).replace(/\D/g, '');
  if (ncmFiltro) {
    where.push(`REPLACE(COALESCE(P.COD_NCM, ''), '.', '') STARTING WITH ?`);
    params.push(ncmFiltro);
  }
  const cfop = txt(filtro.cfop).replace(/\D/g, '');
  if (cfop) {
    where.push(`(COALESCE(E.CFOP, '') STARTING WITH ? OR COALESCE(E.CFOP_NF, '') STARTING WITH ?)`);
    params.push(cfop, cfop);
  }
  const cst = txt(filtro.cst);
  if (cst) {
    where.push(`(COALESCE(P.CST, '') = ? OR COALESCE(P.CSOSN, '') = ? OR COALESCE(P.CST_CFE, '') = ? OR COALESCE(P.CSOSN_CFE, '') = ?)`);
    params.push(cst, cst, cst, cst);
  }
  if (filtro.grupo) {
    where.push(`E.ID_GRUPO = ?`);
    params.push(Number(filtro.grupo));
  }
  if (filtro.incompleto) {
    where.push(simples
      ? `(COALESCE(P.COD_NCM, '') = '' OR COALESCE(E.CFOP, '') = '' OR COALESCE(P.CSOSN, '') = '')`
      : `(COALESCE(P.COD_NCM, '') = '' OR COALESCE(E.CFOP, '') = '' OR COALESCE(P.CST, '') = '')`);
  }
  const q = txt(filtro.q);
  if (q) {
    where.push(`(UPPER(E.DESCRICAO) CONTAINING UPPER(?) OR COALESCE(P.COD_NCM, '') CONTAINING ?)`);
    params.push(q, q.replace(/\D/g, '') || q);
  }
  for (const c of condicoes) {
    const tipo = txt(c.tipo);
    const valor = txt(c.valor).replace(/\D/g, '');
    if (tipo === 'ncm_igual' && valor) {
      where.push(`REPLACE(COALESCE(P.COD_NCM, ''), '.', '') = ?`);
      params.push(valor);
    } else if (tipo === 'ncm_comeca' && valor) {
      where.push(`REPLACE(COALESCE(P.COD_NCM, ''), '.', '') STARTING WITH ?`);
      params.push(valor);
    } else if (tipo === 'grupo' && c.valor) {
      where.push(`E.ID_GRUPO = ?`);
      params.push(Number(c.valor));
    }
  }
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!body.todos_filtrados && ids.length) {
    where.push(`I.ID_IDENTIFICADOR IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  return { where, params, ids };
}

function sqlItens(t, where, limite) {
  return `
    SELECT ${limite ? `FIRST ${limite}` : ''}
      I.ID_IDENTIFICADOR, E.ID_ESTOQUE, E.DESCRICAO, E.ID_GRUPO, E.UNI_MEDIDA,
      E.PRC_VENDA, E.PRC_CUSTO, E.STATUS, E.CFOP, E.CFOP_NF, E.CST_PIS, E.CST_COFINS,
      E.PIS, E.COFINS, E.ID_CTI, E.ID_CTI_CFE,
      P.COD_BARRA, P.REFERENCIA, P.COD_NCM, P.COD_CEST, P.CST, P.CSOSN, P.CST_CFE, P.CSOSN_CFE, P.QTD_ATUAL
    FROM ${t.estoque} E
    JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
    JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    WHERE ${where.join(' AND ')}
    ORDER BY E.DESCRICAO`;
}

function acoesLimpas(body, modo) {
  const acoes = body.acoes || {};
  const out = {};
  for (const campo of camposPermitidos(modo)) {
    if (acoes[campo.k] == null || String(acoes[campo.k]).trim() === '') continue;
    const valor = normalizar(campo, acoes[campo.k]);
    if (valor === undefined) continue;
    out[campo.k] = valor;
  }
  if (modo === 'contador') {
    if (acoes.id_class_trib != null && String(acoes.id_class_trib).trim() !== '') out.id_class_trib = Number(acoes.id_class_trib) || null;
    if (acoes.id_class_trib_nfce != null && String(acoes.id_class_trib_nfce).trim() !== '') out.id_class_trib_nfce = Number(acoes.id_class_trib_nfce) || null;
  } else {
    if (acoes.id_class_trib != null && String(acoes.id_class_trib).trim() !== '') out.id_class_trib = Number(acoes.id_class_trib) || null;
    if (acoes.id_class_trib_nfce != null && String(acoes.id_class_trib_nfce).trim() !== '') out.id_class_trib_nfce = Number(acoes.id_class_trib_nfce) || null;
  }
  return out;
}

function mudancasDaLinha(row, acoes, modo) {
  const lista = [];
  for (const campo of camposPermitidos(modo)) {
    if (acoes[campo.k] === undefined) continue;
    const de = valorAtual(row, campo);
    const para = acoes[campo.k];
    if (!igual(de, para)) lista.push({ campo: campo.k, rotulo: campo.rotulo, de, para });
  }
  return lista;
}

async function listar(filtro) {
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return [];
    const emit = await query(db, `SELECT FIRST 1 SIMPLES FROM TB_EMITENTE`).catch(() => []);
    const simples = txt(emit[0]?.SIMPLES).toUpperCase() === 'S';
    const { where, params } = montarWhere({ filtro: filtro || {}, condicoes: [], todos_filtrados: true }, simples);
    const rows = await query(db, sqlItens(alvo.tables, where, 80), params);
    return rows.map((r) => ({
      id_identificador: Number(r.ID_IDENTIFICADOR),
      descricao: txt(r.DESCRICAO),
      ncm: txt(r.COD_NCM),
      cfop: txt(r.CFOP),
      cst: txt(r.CST),
      csosn: txt(r.CSOSN),
      grupo: r.ID_GRUPO == null ? null : Number(r.ID_GRUPO),
      qtd_atual: Number(r.QTD_ATUAL || 0),
    }));
  });
}

async function previa(body, modo) {
  const acoes = acoesLimpas(body, modo);
  if (!Object.keys(acoes).length) return { ok: false, error: 'Preencha ao menos um campo para alterar. Campo em branco não muda o valor atual.' };
  if (!body.todos_filtrados && !(Array.isArray(body.ids) && body.ids.length) && !(body.condicoes || []).some((c) => txt(c.valor) || c.tipo === 'grupo')) {
    return { ok: false, error: 'Marque produtos, use todos os filtrados ou informe uma condição.' };
  }
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    const emit = await query(db, `SELECT FIRST 1 SIMPLES FROM TB_EMITENTE`);
    const simples = txt(emit[0]?.SIMPLES).toUpperCase() === 'S';
    const { where, params } = montarWhere(body, simples);
    const totalRows = await query(db, `
      SELECT COUNT(*) AS N
      FROM ${alvo.tables.estoque} E
      JOIN ${alvo.tables.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
      JOIN ${alvo.tables.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
      WHERE ${where.join(' AND ')}`, params);
    const total = Number(totalRows[0]?.N || 0);
    if (total > LIMITE) {
      return { ok: false, error: `A regra pega ${total} produtos. O limite por vez é ${LIMITE}. Aperte o filtro.` };
    }
    const rows = await query(db, sqlItens(alvo.tables, where, 40), params);
    const amostra = rows.map((r) => ({
      id_identificador: Number(r.ID_IDENTIFICADOR),
      descricao: txt(r.DESCRICAO),
      mudancas: mudancasDaLinha(r, acoes, modo),
    })).filter((r) => r.mudancas.length);
    return { ok: true, total, amostra, simples };
  });
}

async function gravarClass(tx, tabela, idEst, idClass) {
  const existe = await query(tx, `SELECT FIRST 1 ID_ESTOQUE FROM ${tabela} WHERE ID_ESTOQUE = ?`, [idEst]);
  if (!idClass) {
    if (existe.length) await query(tx, `UPDATE ${tabela} SET ID_CLASS_TRIB = NULL WHERE ID_ESTOQUE = ?`, [idEst]);
    return;
  }
  if (existe.length) {
    await query(tx, `UPDATE ${tabela} SET ID_CLASS_TRIB = ? WHERE ID_ESTOQUE = ?`, [idClass, idEst]);
    return;
  }
  if (tabela === 'TB_EST_TRIBUTOS') {
    await query(tx, `
      INSERT INTO TB_EST_TRIBUTOS (
        ID_ESTOQUE, ID_CLASS_TRIB, DIFERIMENTO_CBS, COD_CRED_PRESU_CBS, ALIQ_CRED_PRESU_CBS,
        DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN, COD_CRED_PRESU_IBS, ALIQ_CRED_PRESU_IBS,
        ID_CLASS_TRIB_REGULAR, DEDUZ_CRED_PRESU_CBS, DEDUZ_CRED_PRESU_IBS, IND_BEM_MOVEL_USADO
      ) VALUES (?, ?, 0, NULL, 0, 0, 0, NULL, 0, NULL, 'N', 'N', 'N')`, [idEst, idClass]);
  } else {
    await query(tx, `
      INSERT INTO TB_EST_TRIBUTOS_NFCE (ID_ESTOQUE, ID_CLASS_TRIB, DIFERIMENTO_CBS, DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN)
      VALUES (?, ?, 0, 0, 0)`, [idEst, idClass]);
  }
}

async function aplicar(body, modo, autor) {
  const visto = await previa(body, modo);
  if (!visto.ok) return visto;
  if (!visto.total) return { ok: false, error: 'Nenhum produto entra nessa regra.' };
  const acoes = acoesLimpas(body, modo);
  const campos = camposPermitidos(modo);
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    const t = alvo.tables;
    const emit = await query(db, `SELECT FIRST 1 SIMPLES FROM TB_EMITENTE`);
    const simples = txt(emit[0]?.SIMPLES).toUpperCase() === 'S';
    const { where, params } = montarWhere(body, simples);
    const rows = await query(db, sqlItens(t, where, LIMITE), params);
    const auditoria = [];
    let alterados = 0;
    await withTransaction(db, async (tx) => {
      for (const row of rows) {
        const mudancas = mudancasDaLinha(row, acoes, modo);
        const est = [];
        const estP = [];
        const prod = [];
        const prodP = [];
        for (const campo of campos) {
          if (acoes[campo.k] === undefined) continue;
          const de = valorAtual(row, campo);
          if (igual(de, acoes[campo.k])) continue;
          const destino = campo.tabela === 'estoque' ? est : prod;
          const vals = campo.tabela === 'estoque' ? estP : prodP;
          destino.push(`${campo.col} = ?`);
          vals.push(acoes[campo.k]);
        }
        const idEst = Number(row.ID_ESTOQUE);
        const id = Number(row.ID_IDENTIFICADOR);
        if (est.length) {
          estP.push(idEst);
          await query(tx, `UPDATE ${t.estoque} SET ${est.join(', ')} WHERE ID_ESTOQUE = ?`, estP);
        }
        if (prod.length) {
          prodP.push(id);
          await query(tx, `UPDATE ${t.produto} SET ${prod.join(', ')} WHERE ID_IDENTIFICADOR = ?`, prodP);
        }
        if (acoes.id_class_trib !== undefined) await gravarClass(tx, 'TB_EST_TRIBUTOS', idEst, acoes.id_class_trib);
        if (acoes.id_class_trib_nfce !== undefined) await gravarClass(tx, 'TB_EST_TRIBUTOS_NFCE', idEst, acoes.id_class_trib_nfce);
        if (!mudancas.length && acoes.id_class_trib === undefined && acoes.id_class_trib_nfce === undefined) continue;
        alterados += 1;
        for (const m of mudancas) {
          auditoria.push({
            id_identificador: id,
            id_estoque: idEst,
            tipo: 'ficha',
            resumo: `${m.rotulo}: ${m.de || '—'} → ${m.para}`,
            detalhe: `Alteração em massa · ${m.rotulo}: ${m.de || '—'} → ${m.para}`,
            id_funcionario: autor.id || 0,
            usuario: autor.nome || 'Alteração em massa',
            observacao: modo === 'contador' ? 'Contador' : 'Alteração em massa',
          });
        }
      }
    });
    for (const entrada of auditoria) await insertAudit(db, entrada);
    return { ok: true, alterados };
  });
}

module.exports = {
  FISCAIS,
  LOJA,
  contexto,
  listar,
  previa,
  aplicar,
};
