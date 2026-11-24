'use strict';

const { withDb, withTransaction, query, writeTargets } = require('./db');
const { insertAudit } = require('./audit');
const { loadAppConfig } = require('./config');
const { classTribPorCodigoDb } = require('./importacao-notas');

const LOTE = 500;

function txt(v) {
  return String(v == null ? '' : v).trim();
}

function digitos(v) {
  return txt(v).replace(/\D/g, '');
}

function codigoClass(v) {
  const d = digitos(v);
  if (!d) return '';
  return d.padStart(6, '0').slice(-6);
}

function rtcConfig() {
  const cfg = loadAppConfig();
  const url = String(process.env.RTC_URL || cfg.rtc?.url || 'http://127.0.0.1:3210').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.RTC_API_KEY || cfg.rtc?.apiKey || '').trim();
  return { url, apiKey, configurado: !!apiKey };
}

function filtroDe(body) {
  const f = body?.filtro || body || {};
  return {
    q: txt(f.q),
    ncm: digitos(f.ncm),
    grupo: Number(f.grupo) > 0 ? Number(f.grupo) : 0,
  };
}

async function contexto() {
  const rtc = rtcConfig();
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    const rows = await query(db, `SELECT FIRST 1 SIMPLES, NOME_FANTA, NOME FROM TB_EMITENTE`).catch(() => []);
    const r = rows[0] || {};
    const simples = txt(r.SIMPLES).toUpperCase() === 'S';
    let grupos = [];
    try {
      const g = await query(db, `SELECT ID_GRUPO, DESCRICAO FROM ${alvo.tables.grupo} ORDER BY DESCRICAO`);
      grupos = g.map((x) => ({ id: Number(x.ID_GRUPO), descricao: txt(x.DESCRICAO) }));
    } catch { /* grupo ausente */ }
    return {
      ok: true,
      simples,
      regime: simples ? 'Simples Nacional' : 'Regime normal',
      crt: simples ? 1 : 3,
      nome: txt(r.NOME_FANTA || r.NOME),
      grupos,
      consultaConfigurada: rtc.configurado,
    };
  });
}

function whereProdutos(filtro) {
  const where = [`(E.STATUS = 'A' OR E.STATUS IS NULL OR E.STATUS = 'I')`];
  const params = [];
  if (filtro.ncm) {
    where.push(`REPLACE(COALESCE(P.COD_NCM, ''), '.', '') STARTING WITH ?`);
    params.push(filtro.ncm);
  }
  if (filtro.grupo) {
    where.push(`E.ID_GRUPO = ?`);
    params.push(filtro.grupo);
  }
  if (filtro.q) {
    where.push(`(UPPER(E.DESCRICAO) CONTAINING UPPER(?) OR COALESCE(P.COD_NCM, '') CONTAINING ?)`);
    params.push(filtro.q, digitos(filtro.q) || filtro.q);
  }
  return { where, params };
}

async function lerProdutos(db, tables, filtro) {
  const { where, params } = whereProdutos(filtro);
  const rows = await query(db, `
    SELECT I.ID_IDENTIFICADOR, E.ID_ESTOQUE, E.DESCRICAO, P.COD_NCM
    FROM ${tables.estoque} E
    JOIN ${tables.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
    JOIN ${tables.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    WHERE ${where.join(' AND ')}
    ORDER BY P.COD_NCM, E.DESCRICAO`, params);
  const porEstoque = new Map();
  for (const r of rows) {
    const idEst = Number(r.ID_ESTOQUE);
    const ncm = digitos(r.COD_NCM);
    const item = {
      id_identificador: Number(r.ID_IDENTIFICADOR),
      id_estoque: idEst,
      descricao: txt(r.DESCRICAO),
    };
    let grupo = porEstoque.get(idEst);
    if (!grupo) {
      grupo = { id_estoque: idEst, ncm, ncm_exibicao: txt(r.COD_NCM), itens: [], conflito: false };
      porEstoque.set(idEst, grupo);
    } else if (grupo.ncm !== ncm) {
      grupo.conflito = true;
    }
    grupo.itens.push(item);
  }
  return [...porEstoque.values()];
}

async function lerClassAtual(db, ids) {
  const nfe = new Map();
  const nfce = new Map();
  const codigos = new Map();
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    if (!lote.length) continue;
    const marcas = lote.map(() => '?').join(',');
    try {
      const rows = await query(db, `
        SELECT T.ID_ESTOQUE, T.ID_CLASS_TRIB, C.COD_CLASS_TRIB
        FROM TB_EST_TRIBUTOS T
        LEFT JOIN TB_CLASS_TRIB C ON C.ID_CLASS_TRIB = T.ID_CLASS_TRIB
        WHERE T.ID_ESTOQUE IN (${marcas})`, lote);
      rows.forEach((r) => {
        const id = r.ID_CLASS_TRIB == null ? null : Number(r.ID_CLASS_TRIB);
        nfe.set(Number(r.ID_ESTOQUE), id);
        if (id) codigos.set(id, codigoClass(r.COD_CLASS_TRIB) || String(id));
      });
    } catch { /* tabela ausente */ }
    try {
      const rows = await query(db, `
        SELECT T.ID_ESTOQUE, T.ID_CLASS_TRIB, C.COD_CLASS_TRIB
        FROM TB_EST_TRIBUTOS_NFCE T
        LEFT JOIN TB_CLASS_TRIB C ON C.ID_CLASS_TRIB = T.ID_CLASS_TRIB
        WHERE T.ID_ESTOQUE IN (${marcas})`, lote);
      rows.forEach((r) => {
        const id = r.ID_CLASS_TRIB == null ? null : Number(r.ID_CLASS_TRIB);
        nfce.set(Number(r.ID_ESTOQUE), id);
        if (id) codigos.set(id, codigoClass(r.COD_CLASS_TRIB) || String(id));
      });
    } catch { /* tabela ausente */ }
  }
  return { nfe, nfce, codigos };
}

async function consultarLote(crt, ncms) {
  const rtc = rtcConfig();
  if (!rtc.configurado) {
    throw new Error('A consulta cClassTrib não está configurada neste servidor. Informe o endereço e a chave na Configuração do serviço.');
  }
  const resultados = [];
  for (let i = 0; i < ncms.length; i += LOTE) {
    const lote = ncms.slice(i, i + LOTE).map((ncm) => ({ id: ncm, ncm }));
    let res;
    try {
      res = await fetch(`${rtc.url}/api/v1/integracao/consulta-lote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': rtc.apiKey },
        body: JSON.stringify({ crt, itens: lote }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new Error(`Não foi possível falar com a consulta cClassTrib (${rtc.url}). ${e.name === 'TimeoutError' ? 'A resposta demorou demais.' : 'Confira se o serviço está no ar.'}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.erro?.mensagem || data?.message || `A consulta cClassTrib respondeu ${res.status}.`);
    }
    resultados.push(...(data.resultados || []));
  }
  return resultados;
}

function descricoesDaConsulta(resultado) {
  const mapa = new Map();
  for (const c of [...(resultado?.nfe || []), ...(resultado?.nfce || [])]) {
    const cod = codigoClass(c.cClassTrib);
    if (cod && !mapa.has(cod)) mapa.set(cod, txt(c.descricao));
  }
  return mapa;
}

async function classeDe(db, cache, codigo) {
  const cod = codigoClass(codigo);
  if (!cod) return null;
  if (cache.has(cod)) return cache.get(cod);
  let row = null;
  try {
    row = await classTribPorCodigoDb(db, cod);
  } catch {
    row = null;
  }
  const classe = row?.id_class_trib
    ? { id: Number(row.id_class_trib), codigo: codigoClass(row.cod_class_trib) || cod, descricao: txt(row.desc_class_trib) }
    : null;
  cache.set(cod, classe);
  return classe;
}

function candidatosDe(sugestao, descricoes) {
  return [...new Set((sugestao?.candidatos || []).map(codigoClass).filter(Boolean))].map((codigo) => ({
    codigo,
    descricao: descricoes.get(codigo) || '',
  }));
}

/**
 * Decide um lado (NF-e ou NFC-e).
 * escolha, quando vier, só vale se estiver entre os candidatos da consulta.
 */
async function decidirLado(db, cache, { sugestao, descricoes, atualId, atualCodigo, substituir, escolha }) {
  const candidatos = candidatosDe(sugestao, descricoes);
  const pedido = codigoClass(escolha);
  const codigo = pedido && candidatos.some((c) => c.codigo === pedido)
    ? pedido
    : codigoClass(sugestao?.cClassTrib);
  const motivo = sugestao?.motivo || (codigo ? '' : 'ambiguo');
  if (!codigo) {
    return { acao: 'revisar', motivo, codigo: '', descricao: '', id: null, candidatos, atual: atualCodigo || '' };
  }
  const classe = await classeDe(db, cache, codigo);
  if (!classe) {
    return { acao: 'ausente', motivo, codigo, descricao: descricoes.get(codigo) || '', id: null, candidatos, atual: atualCodigo || '' };
  }
  const preenchido = atualId != null && Number(atualId) > 0;
  if (preenchido && Number(atualId) === classe.id) {
    return { acao: 'igual', motivo, codigo: classe.codigo, descricao: classe.descricao, id: classe.id, candidatos, atual: atualCodigo || classe.codigo };
  }
  if (preenchido && !substituir) {
    return { acao: 'manter', motivo, codigo: classe.codigo, descricao: classe.descricao, id: classe.id, candidatos, atual: atualCodigo || '' };
  }
  return { acao: 'gravar', motivo, codigo: classe.codigo, descricao: classe.descricao, id: classe.id, candidatos, atual: atualCodigo || '' };
}

function escolhaDo(body, ncm) {
  const lista = Array.isArray(body?.escolhas) ? body.escolhas : [];
  return lista.find((e) => digitos(e?.ncm) === ncm) || {};
}

function ladoPublico(lado, contas) {
  return {
    acao: lado.acao,
    motivo: lado.motivo || '',
    codigo: lado.codigo || '',
    descricao: lado.descricao || '',
    candidatos: lado.candidatos || [],
    gravar: contas.gravar,
    manter: contas.manter + contas.igual,
  };
}

function situacaoDaLinha(nfe, nfce) {
  if ((nfe.gravar || 0) + (nfce.gravar || 0) > 0) return 'aplicar';
  const acoes = [nfe.acao, nfce.acao];
  if (acoes.some((a) => a === 'revisar')) return 'revisar';
  if (acoes.some((a) => a === 'ausente')) return 'ausente';
  if (acoes.some((a) => a === 'sem_ncm')) return 'sem_ncm';
  if (acoes.every((a) => a === 'erro')) return 'erro';
  return 'preenchido';
}

async function montar(db, produtos, consulta, body) {
  const substituir = body?.substituir === true;
  const ids = produtos.map((p) => p.id_estoque);
  const atual = await lerClassAtual(db, ids);
  const cache = new Map();
  const porConsulta = new Map();
  for (const r of consulta) porConsulta.set(digitos(r.ncm || r.id), r);

  const porNcm = new Map();
  for (const p of produtos) {
    const chave = p.conflito ? `conflito:${p.id_estoque}` : (p.ncm || '');
    let grupo = porNcm.get(chave);
    if (!grupo) {
      grupo = {
        ncm: p.conflito ? '' : (p.ncm_exibicao || p.ncm),
        ncm_chave: p.conflito ? '' : p.ncm,
        conflito: p.conflito,
        produtos: 0,
        exemplos: [],
        estoques: [],
      };
      porNcm.set(chave, grupo);
    }
    grupo.produtos += p.itens.length;
    if (grupo.exemplos.length < 3 && p.itens[0]?.descricao) grupo.exemplos.push(p.itens[0].descricao);
    grupo.estoques.push(p);
  }

  const linhas = [];
  const gravacoes = [];
  for (const grupo of porNcm.values()) {
    if (grupo.conflito || !grupo.ncm_chave) {
      const acao = grupo.conflito ? 'revisar' : 'sem_ncm';
      const lado = { acao, motivo: grupo.conflito ? 'conflito' : '', codigo: '', descricao: '', candidatos: [], gravar: 0, manter: 0 };
      linhas.push({
        ncm: grupo.conflito ? '' : '',
        ncm_chave: '',
        conflito: grupo.conflito,
        produtos: grupo.produtos,
        exemplos: grupo.exemplos,
        situacao: acao === 'revisar' ? 'revisar' : 'sem_ncm',
        nfe: lado,
        nfce: { ...lado },
      });
      continue;
    }
    const resp = porConsulta.get(grupo.ncm_chave);
    const escolha = escolhaDo(body, grupo.ncm_chave);
    if (!resp || resp.ok === false) {
      const msg = resp?.erro?.mensagem || 'A consulta não devolveu este NCM.';
      const lado = { acao: 'erro', motivo: 'erro', codigo: '', descricao: msg, candidatos: [], gravar: 0, manter: 0 };
      linhas.push({
        ncm: grupo.ncm,
        ncm_chave: grupo.ncm_chave,
        conflito: false,
        produtos: grupo.produtos,
        exemplos: grupo.exemplos,
        situacao: 'erro',
        nfe: lado,
        nfce: { ...lado },
      });
      continue;
    }
    const resultado = resp.resultado || {};
    const descricoes = descricoesDaConsulta(resultado);
    const contasNfe = { gravar: 0, manter: 0, igual: 0 };
    const contasNfce = { gravar: 0, manter: 0, igual: 0 };
    let modeloNfe = null;
    let modeloNfce = null;
    for (const est of grupo.estoques) {
      const nfe = await decidirLado(db, cache, {
        sugestao: resultado.sugestao?.nfe,
        descricoes,
        atualId: atual.nfe.get(est.id_estoque),
        atualCodigo: atual.codigos.get(atual.nfe.get(est.id_estoque)) || '',
        substituir,
        escolha: escolha.nfe,
      });
      const nfce = await decidirLado(db, cache, {
        sugestao: resultado.sugestao?.nfce,
        descricoes,
        atualId: atual.nfce.get(est.id_estoque),
        atualCodigo: atual.codigos.get(atual.nfce.get(est.id_estoque)) || '',
        substituir,
        escolha: escolha.nfce,
      });
      modeloNfe = nfe;
      modeloNfce = nfce;
      contasNfe[nfe.acao] = (contasNfe[nfe.acao] || 0) + est.itens.length;
      contasNfce[nfce.acao] = (contasNfce[nfce.acao] || 0) + est.itens.length;
      if (nfe.acao === 'gravar' || nfce.acao === 'gravar') {
        gravacoes.push({ est, nfe, nfce, ncm: grupo.ncm_chave });
      }
    }
    const nfePub = ladoPublico(modeloNfe, contasNfe);
    const nfcePub = ladoPublico(modeloNfce, contasNfce);
    linhas.push({
      ncm: grupo.ncm,
      ncm_chave: grupo.ncm_chave,
      conflito: false,
      produtos: grupo.produtos,
      exemplos: grupo.exemplos,
      situacao: situacaoDaLinha(nfePub, nfcePub),
      nfe: nfePub,
      nfce: nfcePub,
    });
  }
  linhas.sort((a, b) => String(a.ncm).localeCompare(String(b.ncm), 'pt-BR'));
  return { linhas, gravacoes };
}

async function previa(body) {
  const filtro = filtroDe(body);
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    const emit = await query(db, `SELECT FIRST 1 SIMPLES FROM TB_EMITENTE`).catch(() => []);
    const simples = txt(emit[0]?.SIMPLES).toUpperCase() === 'S';
    const produtos = await lerProdutos(db, alvo.tables, filtro);
    const ncms = [...new Set(produtos.filter((p) => p.ncm && !p.conflito).map((p) => p.ncm))];
    let consulta = [];
    if (ncms.length) consulta = await consultarLote(simples ? 1 : 3, ncms);
    const { linhas } = await montar(db, produtos, consulta, { ...body, escolhas: [] });
    const resumo = linhas.reduce((acc, l) => {
      acc[l.situacao] = (acc[l.situacao] || 0) + l.produtos;
      return acc;
    }, {});
    return {
      ok: true,
      regime: simples ? 'Simples Nacional' : 'Regime normal',
      ncms: ncms.length,
      produtos: produtos.reduce((n, p) => n + p.itens.length, 0),
      resumo,
      linhas,
    };
  });
}

async function gravarClass(tx, tabela, idEst, idClass) {
  const existe = await query(tx, `SELECT FIRST 1 ID_ESTOQUE FROM ${tabela} WHERE ID_ESTOQUE = ?`, [idEst]);
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

async function aplicar(body, autor) {
  const filtro = filtroDe(body);
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    const emit = await query(db, `SELECT FIRST 1 SIMPLES FROM TB_EMITENTE`).catch(() => []);
    const simples = txt(emit[0]?.SIMPLES).toUpperCase() === 'S';
    const produtos = await lerProdutos(db, alvo.tables, filtro);
    if (!produtos.length) return { ok: false, error: 'Nenhum produto entra nesse filtro.' };
    const ncms = [...new Set(produtos.filter((p) => p.ncm && !p.conflito).map((p) => p.ncm))];
    const consulta = ncms.length ? await consultarLote(simples ? 1 : 3, ncms) : [];
    const { linhas, gravacoes } = await montar(db, produtos, consulta, body);
    if (!gravacoes.length) {
      return { ok: true, alterados: 0, mensagem: 'Nenhum produto recebeu classificação nova. Os ambíguos continuam para revisão.' };
    }
    const auditoria = [];
    let alterados = 0;
    await withTransaction(db, async (tx) => {
      for (const g of gravacoes) {
        let mudou = false;
        if (g.nfe.acao === 'gravar' && g.nfe.id) {
          await gravarClass(tx, 'TB_EST_TRIBUTOS', g.est.id_estoque, g.nfe.id);
          mudou = true;
          for (const item of g.est.itens) {
            auditoria.push({
              id_identificador: item.id_identificador,
              id_estoque: g.est.id_estoque,
              tipo: 'ficha',
              resumo: `Class. trib. NF-e: ${g.nfe.atual || '—'} → ${g.nfe.codigo}`,
              detalhe: `Classificação por NCM ${g.ncm} · NF-e: ${g.nfe.atual || '—'} → ${g.nfe.codigo} ${g.nfe.descricao || ''}`.trim(),
              id_funcionario: autor.id || 0,
              usuario: autor.nome || 'Classificação por NCM',
              observacao: 'Classificação por NCM',
            });
          }
        }
        if (g.nfce.acao === 'gravar' && g.nfce.id) {
          await gravarClass(tx, 'TB_EST_TRIBUTOS_NFCE', g.est.id_estoque, g.nfce.id);
          mudou = true;
          for (const item of g.est.itens) {
            auditoria.push({
              id_identificador: item.id_identificador,
              id_estoque: g.est.id_estoque,
              tipo: 'ficha',
              resumo: `Class. trib. NFC-e: ${g.nfce.atual || '—'} → ${g.nfce.codigo}`,
              detalhe: `Classificação por NCM ${g.ncm} · NFC-e: ${g.nfce.atual || '—'} → ${g.nfce.codigo} ${g.nfce.descricao || ''}`.trim(),
              id_funcionario: autor.id || 0,
              usuario: autor.nome || 'Classificação por NCM',
              observacao: 'Classificação por NCM',
            });
          }
        }
        if (mudou) alterados += g.est.itens.length;
      }
    });
    for (const entrada of auditoria) await insertAudit(db, entrada);
    const revisar = linhas.filter((l) => l.situacao === 'revisar').reduce((n, l) => n + l.produtos, 0);
    return { ok: true, alterados, revisar };
  });
}

module.exports = {
  contexto,
  previa,
  aplicar,
  rtcConfig,
};
