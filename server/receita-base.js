'use strict';

const fs = require('fs');
const path = require('path');

const REPOSITORIO = 'https://github.com/ReceitaFederal/calculadora-rtc-regime-regular';
const PADRAO = '000001';

let aberto = null;

function vig(col) {
  return `substr(${col}_INICIO_VIGENCIA, 1, 10) <= @data AND (${col}_FIM_VIGENCIA IS NULL OR substr(${col}_FIM_VIGENCIA, 1, 10) >= @data)`;
}

function caminhoBase() {
  const atualizada = 'C:\\ProgramData\\ConsultaCClassTrib\\data\\calculadora-rtc.db';
  const embutida = path.join(__dirname, 'dados', 'calculadora-rtc.db');
  if (fs.existsSync(atualizada)) return atualizada;
  if (fs.existsSync(embutida)) return embutida;
  return '';
}

function linhas(db, sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function um(db, sql, params) {
  return linhas(db, sql, params)[0] || null;
}

async function banco() {
  if (aberto) return aberto;
  const arquivo = caminhoBase();
  if (!arquivo) {
    throw new Error('A base oficial da Receita não está no aplicativo.');
  }
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(arquivo));
  aberto = { db, arquivo };
  return aberto;
}

function info(db) {
  return um(db, `
    SELECT VRBD_VERSAO_BASE_DADO AS versao, VRBD_DATA AS data, VRBD_DESCRICAO AS descricao
      FROM VERSAO_BASE_DADO ORDER BY VRBD_ID DESC LIMIT 1`, {}) || {};
}

function formatarNcm(codigo) {
  const s = String(codigo || '');
  if (s.length === 8) return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}`;
  if (s.length === 6) return `${s.slice(0, 4)}.${s.slice(4)}`;
  return s;
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function vinculos(db, ncm, data) {
  const sql = `
    SELECT na.NCMA_ID AS ncmaId, na.NCMA_NCM_CD AS prefixo,
           ct.CLTR_ID AS cltrId, ct.CLTR_CD AS cClassTrib, ct.CLTR_DESCRICAO AS descricao,
           ct.CLTR_TIPO_ALIQUOTA AS tipoAliquota,
           s.SITR_CD AS cst, s.SITR_DESCRICAO AS cstDescricao,
           an.ANXO_NUMERO AS anexoNumero, an.ANXO_DESCRICAO AS anexoDescricao,
           an.ANXO_NUMERO_ITEM AS anexoItem, an.ANXO_TEXTO_ITEM AS anexoTexto,
           (an.ANXO_ID IS NOT NULL) AS temAnexo,
           EXISTS (SELECT 1 FROM EXCECAO_NCM_APLICAVEL e
                    WHERE e.ENCM_NCMA_ID = na.NCMA_ID
                      AND substr(@ncm, 1, length(e.ENCM_NCM_CD)) = e.ENCM_NCM_CD
                      AND ${vig('e.ENCM')}) AS excluidaPelaPropriaExcecao,
           EXISTS (SELECT 1 FROM EXCECAO_NCM_APLICAVEL e
                     JOIN NCM_APLICAVEL n ON n.NCMA_ID = e.ENCM_NCMA_ID
                    WHERE substr(@ncm, 1, length(n.NCMA_NCM_CD)) = n.NCMA_NCM_CD
                      AND substr(@ncm, 1, length(e.ENCM_NCM_CD)) = e.ENCM_NCM_CD
                      AND n.NCMA_CLTR_ID = ct.CLTR_ID
                      AND ${vig('e.ENCM')}) AS excecaoNoCClassTrib,
           EXISTS (SELECT 1 FROM NCM_APLICAVEL n
                     LEFT JOIN EXCECAO_NCM_APLICAVEL e ON e.ENCM_NCMA_ID = n.NCMA_ID
                    WHERE substr(@ncm, 1, length(n.NCMA_NCM_CD)) = n.NCMA_NCM_CD
                      AND n.NCMA_CLTR_ID = ct.CLTR_ID
                      AND ${vig('n.NCMA')}
                      AND (e.ENCM_ID IS NULL OR NOT (${vig('e.ENCM')}))) AS vinculoSemExcecao
      FROM NCM_APLICAVEL na
      JOIN CLASSIFICACAO_TRIBUTARIA ct ON ct.CLTR_ID = na.NCMA_CLTR_ID AND ${vig('ct.CLTR')}
      JOIN SITUACAO_TRIBUTARIA s ON s.SITR_ID = ct.CLTR_SITR_ID AND ${vig('s.SITR')}
      LEFT JOIN ANEXO an ON an.ANXO_ID = na.NCMA_ANXO_ID AND ${vig('an.ANXO')}
     WHERE substr(@ncm, 1, length(na.NCMA_NCM_CD)) = na.NCMA_NCM_CD
       AND ${vig('na.NCMA')}
     ORDER BY ct.CLTR_CD, length(na.NCMA_NCM_CD) DESC`;
  return linhas(db, sql, { '@ncm': ncm, '@data': data }).filter((l) => !(l.excecaoNoCClassTrib && !l.vinculoSemExcecao) && !l.excluidaPelaPropriaExcecao);
}

function documentos(db, cltrId, data) {
  const rows = linhas(db, `
    SELECT DISTINCT tp.TPDF_SIGLA AS sigla
      FROM TIPO_DFE_CLASSIFICACAO tc
      JOIN TIPO_DFE tp ON tp.TPDF_ID = tc.TDCL_TPDF_ID AND ${vig('tp.TPDF')}
     WHERE tc.TDCL_CLTR_ID = @cltrId AND ${vig('tc.TDCL')}
       AND tp.TPDF_SIGLA IN ('NF-e', 'NFC-e')`, { '@cltrId': cltrId, '@data': data });
  return new Set(rows.map((r) => r.sigla));
}

function padrao(db, data) {
  return um(db, `
    SELECT ct.CLTR_ID AS cltrId, ct.CLTR_CD AS cClassTrib, ct.CLTR_DESCRICAO AS descricao,
           s.SITR_CD AS cst, s.SITR_DESCRICAO AS cstDescricao
      FROM CLASSIFICACAO_TRIBUTARIA ct
      JOIN SITUACAO_TRIBUTARIA s ON s.SITR_ID = ct.CLTR_SITR_ID AND ${vig('s.SITR')}
     WHERE ct.CLTR_CD = @codigo AND ${vig('ct.CLTR')}
       AND EXISTS (SELECT 1 FROM TRIBUTO_SITUACAO_TRIBUTARIA ts
                     JOIN TRIBUTO t ON t.TBTO_ID = ts.TRST_TBTO_ID
                    WHERE ts.TRST_SITR_ID = s.SITR_ID AND t.TBTO_SIGLA = 'CBS' AND ${vig('ts.TRST')})
     LIMIT 1`, { '@codigo': PADRAO, '@data': data });
}

function candidato(row, docs, fallback) {
  return {
    cClassTrib: String(row.cClassTrib || ''),
    descricao: String(row.descricao || '').trim(),
    cst: { codigo: String(row.cst || ''), descricao: String(row.cstDescricao || '') },
    permitidoNfe: docs.has('NF-e'),
    permitidoNfce: docs.has('NFC-e'),
    fallback: !!fallback,
    condicional: !!row.temAnexo,
  };
}

function sugerir(lista, fallback) {
  const codigos = [...new Set(lista.map((c) => c.cClassTrib).filter(Boolean))];
  if (fallback && lista[0]) return { cClassTrib: lista[0].cClassTrib, motivo: 'padrao', candidatos: codigos };
  const reais = lista.filter((c) => !c.fallback);
  if (reais.length === 1 && !reais[0].condicional) return { cClassTrib: reais[0].cClassTrib, motivo: 'unico', candidatos: codigos };
  if (reais.length > 1) return { cClassTrib: null, motivo: 'ambiguo', candidatos: codigos };
  return { cClassTrib: lista[0]?.cClassTrib || null, motivo: lista[0] ? 'unico' : 'ambiguo', candidatos: codigos };
}

async function situacao() {
  const { db } = await banco();
  const base = info(db);
  return {
    online: true,
    versaoBase: String(base.versao || ''),
    descricao: String(base.descricao || ''),
    repositorio: REPOSITORIO,
  };
}

async function consultar(ncm) {
  const codigo = String(ncm || '').replace(/\D/g, '');
  if (codigo.length !== 8) throw new Error('Informe o NCM com 8 dígitos.');
  const { db } = await banco();
  const data = hoje();
  const vigente = um(db, `
    SELECT NCM_CD AS codigo, NCM_DESCRICAO AS descricao, NCM_INICIO_VIGENCIA AS inicio, NCM_FIM_VIGENCIA AS fim
      FROM NCM WHERE NCM_CD = @codigo AND ${vig('NCM')}
     ORDER BY NCM_INICIO_VIGENCIA DESC LIMIT 1`, { '@codigo': codigo, '@data': data });
  if (!vigente) throw new Error(`O NCM ${formatarNcm(codigo)} não consta na tabela oficial da Receita nesta data.`);

  const grupos = new Map();
  for (const l of vinculos(db, codigo, data)) {
    let g = grupos.get(l.cltrId);
    if (!g) {
      g = { row: l, temAnexo: false };
      grupos.set(l.cltrId, g);
    }
    if (l.temAnexo) g.temAnexo = true;
  }
  const todos = [];
  for (const g of grupos.values()) {
    const docs = documentos(db, g.row.cltrId, data);
    todos.push(candidato({ ...g.row, temAnexo: g.temAnexo ? 1 : 0 }, docs, false));
  }
  let nfe = todos.filter((c) => c.permitidoNfe);
  let nfce = todos.filter((c) => c.permitidoNfce);
  let fallbackNfe = false;
  let fallbackNfce = false;
  const geral = padrao(db, data);
  if (geral) {
    const docs = documentos(db, geral.cltrId, data);
    const item = candidato(geral, docs, true);
    if (!nfe.length && item.permitidoNfe) {
      nfe = [item];
      fallbackNfe = true;
    }
    if (!nfce.length && item.permitidoNfce) {
      nfce = [item];
      fallbackNfce = true;
    }
  }
  const base = info(db);
  return {
    ncm: {
      codigo,
      codigoFormatado: formatarNcm(codigo),
      descricao: String(vigente.descricao || '').trim(),
    },
    base: { versao: String(base.versao || ''), descricao: String(base.descricao || '') },
    repositorio: REPOSITORIO,
    nfe,
    nfce,
    sugestao: { nfe: sugerir(nfe, fallbackNfe), nfce: sugerir(nfce, fallbackNfce) },
  };
}

module.exports = { situacao, consultar, REPOSITORIO, caminhoBase };
