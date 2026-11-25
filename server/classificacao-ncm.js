'use strict';

const { withDb, withTransaction, query, writeTargets } = require('./db');
const { insertAudit } = require('./audit');
const { classTribPorCodigoDb } = require('./importacao-notas');
const receitaBase = require('./receita-base');
const licenca = require('./licenca');

const TERMO = {
  titulo: 'TERMO DE CIÊNCIA E RESPONSABILIDADE — ATUALIZAÇÃO DE NCM',
  paragrafos: [
    'A consulta automática utiliza como parâmetro o NCM informado no cadastro de cada produto. SE O NCM CADASTRADO ESTIVER INCORRETO, A CONSULTA PODERÁ LOCALIZAR E APRESENTAR UM RESULTADO INCORRETO.',
    'Antes da atualização, o sistema disponibiliza uma prévia dos NCMs que serão alterados. O usuário que realizar a operação deverá revisar integralmente essa prévia e submetê-la à análise do contador responsável. A atualização de toda a base de produtos só deve ser confirmada após a aprovação expressa do contador.',
    'Ao confirmar a atualização, o usuário declara que revisou a prévia, obteve a aprovação do contador e autoriza a aplicação dos NCMs apresentados na base de produtos. A responsabilidade pela conferência e pela atualização realizada é do usuário que a confirmou, inclusive quanto a inconsistências decorrentes de dados incorretos no cadastro de origem ou da aplicação sem a devida aprovação contábil.',
  ],
};

function termoTexto() {
  return [TERMO.titulo, ...TERMO.paragrafos].join('\n\n');
}

function cpfValido(valor) {
  const d = digitos(valor);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (tamanho) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * ((tamanho + 1) - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function formatarCpf(valor) {
  const d = digitos(valor);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
}

function validarAceite(aceite) {
  const nome = txt(aceite?.nome).replace(/\s+/g, ' ');
  const partes = nome.split(' ').filter((p) => p.length >= 2);
  if (partes.length < 2) return { ok: false, error: 'Informe o nome completo de quem assina o termo.' };
  if (!cpfValido(aceite?.cpf)) return { ok: false, error: 'Informe um CPF válido.' };
  return { ok: true, nome: nome.slice(0, 120), cpf: digitos(aceite.cpf), cpfFormatado: formatarCpf(aceite.cpf) };
}

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

function filtroDe(body) {
  const f = body?.filtro || body || {};
  return {
    q: txt(f.q),
    ncm: digitos(f.ncm),
    grupo: Number(f.grupo) > 0 ? Number(f.grupo) : 0,
  };
}

async function contexto() {
  const consulta = await situacaoConsulta();
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
      consultaConfigurada: true,
      consultaOnline: consulta.online,
      versaoBase: consulta.versaoBase,
    };
  });
}

function whereProdutos(filtro) {
  const where = [`(E.STATUS = 'A' OR E.STATUS IS NULL OR E.STATUS = 'I')`];
  const params = [];
  if (filtro.ncm) {
    where.push(filtro.exato
      ? `REPLACE(COALESCE(P.COD_NCM, ''), '.', '') = ?`
      : `REPLACE(COALESCE(P.COD_NCM, ''), '.', '') STARTING WITH ?`);
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
  const descricoes = new Map();
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    if (!lote.length) continue;
    const marcas = lote.map(() => '?').join(',');
    try {
      const rows = await query(db, `
        SELECT T.ID_ESTOQUE, T.ID_CLASS_TRIB, C.COD_CLASS_TRIB, C.DESC_CLASS_TRIB
        FROM TB_EST_TRIBUTOS T
        LEFT JOIN TB_CLASS_TRIB C ON C.ID_CLASS_TRIB = T.ID_CLASS_TRIB
        WHERE T.ID_ESTOQUE IN (${marcas})`, lote);
      rows.forEach((r) => {
        const id = r.ID_CLASS_TRIB == null ? null : Number(r.ID_CLASS_TRIB);
        nfe.set(Number(r.ID_ESTOQUE), id);
        if (id) {
          codigos.set(id, codigoClass(r.COD_CLASS_TRIB) || String(id));
          descricoes.set(id, txt(r.DESC_CLASS_TRIB));
        }
      });
    } catch { /* tabela ausente */ }
    try {
      const rows = await query(db, `
        SELECT T.ID_ESTOQUE, T.ID_CLASS_TRIB, C.COD_CLASS_TRIB, C.DESC_CLASS_TRIB
        FROM TB_EST_TRIBUTOS_NFCE T
        LEFT JOIN TB_CLASS_TRIB C ON C.ID_CLASS_TRIB = T.ID_CLASS_TRIB
        WHERE T.ID_ESTOQUE IN (${marcas})`, lote);
      rows.forEach((r) => {
        const id = r.ID_CLASS_TRIB == null ? null : Number(r.ID_CLASS_TRIB);
        nfce.set(Number(r.ID_ESTOQUE), id);
        if (id) {
          codigos.set(id, codigoClass(r.COD_CLASS_TRIB) || String(id));
          descricoes.set(id, txt(r.DESC_CLASS_TRIB));
        }
      });
    } catch { /* tabela ausente */ }
  }
  return { nfe, nfce, codigos, descricoes };
}

async function consultarLote(_crt, ncms) {
  const resultados = [];
  for (const ncm of ncms) {
    try {
      const resultado = await receitaBase.consultar(ncm);
      resultados.push({ id: ncm, ncm, ok: true, resultado });
    } catch (e) {
      resultados.push({ id: ncm, ncm, ok: false, erro: { mensagem: e.message } });
    }
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

function opcoesDe(lista, sugestao) {
  const sugerida = codigoClass(sugestao?.cClassTrib);
  const vistos = new Set();
  const out = [];
  for (const c of lista || []) {
    const codigo = codigoClass(c?.cClassTrib);
    if (!codigo || vistos.has(codigo)) continue;
    vistos.add(codigo);
    const cst = c?.cst;
    out.push({
      codigo,
      descricao: txt(c?.descricao),
      cst: txt(cst && typeof cst === 'object' ? cst.codigo : cst),
      sugerida: codigo === sugerida,
    });
  }
  return out;
}

async function consultarUm(_crt, ncm) {
  return receitaBase.consultar(ncm);
}

async function situacaoConsulta() {
  try {
    const base = await receitaBase.situacao();
    return { online: true, versaoBase: base.versaoBase, repositorio: base.repositorio };
  } catch {
    return { online: false, versaoBase: '', repositorio: receitaBase.REPOSITORIO };
  }
}

async function regimeDaBase(db) {
  const emit = await query(db, `SELECT FIRST 1 SIMPLES FROM TB_EMITENTE`).catch(() => []);
  const simples = txt(emit[0]?.SIMPLES).toUpperCase() === 'S';
  return { simples, crt: simples ? 1 : 3, regime: simples ? 'Simples Nacional' : 'Regime normal' };
}

function produtosDoNcm(grupos, ncm) {
  const lista = [];
  let conflito = 0;
  for (const grupo of grupos) {
    if (grupo.conflito || grupo.ncm !== ncm) {
      conflito += grupo.itens.length;
      continue;
    }
    lista.push(grupo);
  }
  return { lista, conflito };
}

async function buscar(body) {
  const ncm = digitos(body?.ncm || body?.filtro?.ncm);
  if (ncm.length !== 8) return { ok: false, error: 'Informe o NCM com 8 dígitos.' };
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    const regime = await regimeDaBase(db);
    const consulta = await consultarUm(regime.crt, ncm);
    const grupos = await lerProdutos(db, alvo.tables, { ncm, q: '', grupo: 0, exato: true });
    const { lista, conflito } = produtosDoNcm(grupos, ncm);
    const atual = await lerClassAtual(db, lista.map((p) => p.id_estoque));
    const produtos = [];
    for (const grupo of lista) {
      const idNfe = atual.nfe.get(grupo.id_estoque);
      const idNfce = atual.nfce.get(grupo.id_estoque);
      for (const item of grupo.itens) {
        produtos.push({
          id_identificador: item.id_identificador,
          id_estoque: grupo.id_estoque,
          descricao: item.descricao,
          nfe: idNfe ? (atual.codigos.get(idNfe) || '') : '',
          nfce: idNfce ? (atual.codigos.get(idNfce) || '') : '',
        });
      }
    }
    produtos.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR') || a.id_identificador - b.id_identificador);
    return {
      ok: true,
      ncm: consulta.ncm?.codigoFormatado || ncm,
      ncm_chave: ncm,
      descricaoNcm: txt(consulta.ncm?.descricao),
      regime: regime.regime,
      versaoBase: txt(consulta.base?.versao),
      produtos,
      conflito,
      nfe: opcoesDe(consulta.nfe, consulta.sugestao?.nfe),
      nfce: opcoesDe(consulta.nfce, consulta.sugestao?.nfce),
    };
  });
}

function ncmValido(codigo) {
  const ncm = digitos(codigo);
  return ncm.length === 8 && ncm !== '00000000';
}

function formatarNcm(codigo) {
  const s = digitos(codigo);
  return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s;
}

function observacaoDe(origem, aceite) {
  const base = origem || 'Classificação por NCM';
  if (!aceite?.nome) return base;
  return `${base} · ${aceite.nome} · CPF ${aceite.cpfFormatado}`.slice(0, 200);
}

async function aplicarNcm(db, appCfg, autor, ncmInformado, nfeInformado, nfceInformado, origem, opcoes = {}) {
  const somentePrevia = opcoes.previa === true;
  const aceite = opcoes.aceite || null;
  const ncm = digitos(ncmInformado);
  const nfeCod = codigoClass(nfeInformado);
  const nfceCod = codigoClass(nfceInformado);
  if (!ncmValido(ncm)) return { ok: false, error: 'NCM inválido.' };
  if (!nfeCod && !nfceCod) return { ok: false, error: 'Escolha a classificação da NF-e, da NFC-e ou as duas.' };
  const alvo = writeTargets(appCfg)[0];
  if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
  const regime = await regimeDaBase(db);
  const consulta = await consultarUm(regime.crt, ncm);
  const permitidasNfe = new Set(opcoesDe(consulta.nfe, consulta.sugestao?.nfe).map((o) => o.codigo));
  const permitidasNfce = new Set(opcoesDe(consulta.nfce, consulta.sugestao?.nfce).map((o) => o.codigo));
  if (nfeCod && !permitidasNfe.has(nfeCod)) {
    return { ok: false, error: 'A classificação de NF-e escolhida não está entre as opções da Receita para este NCM.' };
  }
  if (nfceCod && !permitidasNfce.has(nfceCod)) {
    return { ok: false, error: 'A classificação de NFC-e escolhida não está entre as opções da Receita para este NCM.' };
  }
  const cache = new Map();
  const classeNfe = nfeCod ? await classeDe(db, cache, nfeCod) : null;
  const classeNfce = nfceCod ? await classeDe(db, cache, nfceCod) : null;
  if (nfeCod && !classeNfe) {
    return { ok: false, error: `O código ${nfeCod} da NF-e não está cadastrado na tabela de classificação tributária.` };
  }
  if (nfceCod && !classeNfce) {
    return { ok: false, error: `O código ${nfceCod} da NFC-e não está cadastrado na tabela de classificação tributária.` };
  }
  const grupos = await lerProdutos(db, alvo.tables, { ncm, q: '', grupo: 0, exato: true });
  const { lista, conflito } = produtosDoNcm(grupos, ncm);
  if (!lista.length) return { ok: false, error: 'Nenhum produto com esse NCM para preencher.' };
  const atual = await lerClassAtual(db, lista.map((p) => p.id_estoque));
  const auditoria = [];
  const linhas = [];
  let alterados = 0;
  let jaIguais = 0;
  const executar = async (tx) => {
    for (const grupo of lista) {
      let mudou = false;
      if (classeNfe && atual.nfe.get(grupo.id_estoque) !== classeNfe.id) {
        if (!somentePrevia) await gravarClass(tx, 'TB_EST_TRIBUTOS', grupo.id_estoque, classeNfe.id);
        mudou = true;
        const deId = atual.nfe.get(grupo.id_estoque);
        const de = atual.codigos.get(deId) || '—';
        linhas.push({
          ncm: formatarNcm(ncm),
          documento: 'NF-e',
          anterior: de,
          anterior_descricao: atual.descricoes.get(deId) || '',
          atual: classeNfe.codigo,
          atual_descricao: classeNfe.descricao || '',
          produtos: grupo.itens.length,
        });
        if (!somentePrevia) for (const item of grupo.itens) {
          auditoria.push({
            id_identificador: item.id_identificador,
            id_estoque: grupo.id_estoque,
            tipo: 'ficha',
            resumo: `Class. trib. NF-e: ${de} → ${classeNfe.codigo}`,
            detalhe: `Classificação por NCM ${ncm} · NF-e: ${de} → ${classeNfe.codigo} ${classeNfe.descricao || ''}`.trim(),
            id_funcionario: autor.id || 0,
            usuario: (aceite?.nome || autor.nome || 'Classificação por NCM').slice(0, 80),
            observacao: observacaoDe(origem, aceite),
          });
        }
      }
      if (classeNfce && atual.nfce.get(grupo.id_estoque) !== classeNfce.id) {
        if (!somentePrevia) await gravarClass(tx, 'TB_EST_TRIBUTOS_NFCE', grupo.id_estoque, classeNfce.id);
        mudou = true;
        const deId = atual.nfce.get(grupo.id_estoque);
        const de = atual.codigos.get(deId) || '—';
        linhas.push({
          ncm: formatarNcm(ncm),
          documento: 'NFC-e',
          anterior: de,
          anterior_descricao: atual.descricoes.get(deId) || '',
          atual: classeNfce.codigo,
          atual_descricao: classeNfce.descricao || '',
          produtos: grupo.itens.length,
        });
        if (!somentePrevia) for (const item of grupo.itens) {
          auditoria.push({
            id_identificador: item.id_identificador,
            id_estoque: grupo.id_estoque,
            tipo: 'ficha',
            resumo: `Class. trib. NFC-e: ${de} → ${classeNfce.codigo}`,
            detalhe: `Classificação por NCM ${ncm} · NFC-e: ${de} → ${classeNfce.codigo} ${classeNfce.descricao || ''}`.trim(),
            id_funcionario: autor.id || 0,
            usuario: (aceite?.nome || autor.nome || 'Classificação por NCM').slice(0, 80),
            observacao: observacaoDe(origem, aceite),
          });
        }
      }
      if (mudou) alterados += grupo.itens.length;
      else jaIguais += grupo.itens.length;
    }
  };
  if (somentePrevia) await executar(db);
  else await withTransaction(db, executar);
  if (!somentePrevia) {
    for (const entrada of auditoria) await insertAudit(db, entrada);
  }
  return { ok: true, previa: somentePrevia, alterados, jaIguais, conflito, linhas: juntarLinhas(linhas) };
}

function juntarLinhas(lista) {
  const mapa = new Map();
  for (const linha of lista) {
    const chave = [linha.ncm, linha.documento, linha.anterior, linha.anterior_descricao, linha.atual, linha.atual_descricao].join('|');
    const atual = mapa.get(chave);
    if (atual) atual.produtos += linha.produtos;
    else mapa.set(chave, { ...linha });
  }
  return [...mapa.values()].sort((a, b) => a.ncm.localeCompare(b.ncm, 'pt-BR') || a.documento.localeCompare(b.documento, 'pt-BR'));
}

async function executarLista(db, appCfg, itens, autor, origem, opcoes) {
  let alterados = 0;
  let jaIguais = 0;
  let conflito = 0;
  const falhas = [];
  const linhas = [];
  for (const item of itens) {
    try {
      const res = await aplicarNcm(db, appCfg, autor, item.ncm, item.nfe, item.nfce, origem, opcoes);
      if (!res.ok) falhas.push({ ncm: formatarNcm(item.ncm), error: res.error });
      else {
        alterados += res.alterados || 0;
        jaIguais += res.jaIguais || 0;
        conflito += res.conflito || 0;
        linhas.push(...(res.linhas || []));
      }
    } catch (err) {
      falhas.push({ ncm: formatarNcm(item.ncm), error: err.message });
    }
  }
  if (!alterados && !jaIguais && falhas.length) {
    return { ok: false, error: falhas[0].error, falhas, termo: TERMO };
  }
  return { ok: true, alterados, jaIguais, conflito, falhas, linhas: juntarLinhas(linhas), termo: TERMO };
}

async function simular(db, appCfg, body) {
  const autor = { id: 0, nome: '' };
  if (Array.isArray(body?.itens)) {
    const itens = body.itens.filter((item) => ncmValido(item?.ncm));
    if (!itens.length) return { ok: false, error: 'Marque ao menos um NCM válido.' };
    return executarLista(db, appCfg, itens, autor, 'Replicador Geral', { previa: true });
  }
  const res = await aplicarNcm(db, appCfg, autor, body?.ncm, body?.nfe, body?.nfce, 'Classificação por NCM', { previa: true });
  return { ...res, termo: TERMO };
}

async function previaAlteracao(body) {
  return withDb((db, appCfg) => simular(db, appCfg, body || {}));
}

async function gravarAceiteLocal(db, aceite, origem, res, autor) {
  await insertAudit(db, {
    id_identificador: 0,
    id_estoque: 0,
    tipo: 'cadastro',
    resumo: 'Aceite do termo de atualização de NCM',
    detalhe: `${aceite.nome} · CPF ${aceite.cpfFormatado} · ${origem} · ${res.alterados || 0} produto(s). ${TERMO.titulo}`,
    id_funcionario: autor.id || 0,
    usuario: aceite.nome.slice(0, 80),
    observacao: `CPF ${aceite.cpfFormatado}`,
  });
}

async function aplicarComAceite(body, autor, origem) {
  const plano = await previaAlteracao(body);
  if (!plano.ok) return plano;
  const produtos = (plano.linhas || []).reduce((n, linha) => n + (Number(linha.produtos) || 0), 0);
  if (!produtos) {
    return { ...plano, mensagem: 'Nenhuma classificação mudaria. Nada foi gravado.' };
  }
  const aceite = validarAceite(body?.aceite);
  if (!aceite.ok) return aceite;
  const registro = await licenca.registrarAceiteNcm({
    nome: aceite.nome,
    cpf: aceite.cpfFormatado,
    origem,
    resumo: `${plano.linhas.length} alteração(ões), ${produtos} produto(s)`,
    termo: termoTexto(),
  });
  if (!registro.ok) {
    return { ok: false, error: registro.error || 'Não foi possível registrar o aceite no cadastro do cliente, no painel.' };
  }
  try {
    return await withDb(async (db, appCfg) => {
      const res = Array.isArray(body?.itens)
        ? await executarLista(db, appCfg, body.itens.filter((item) => ncmValido(item?.ncm)), autor, origem, { aceite })
        : await aplicarNcm(db, appCfg, autor, body?.ncm, body?.nfe, body?.nfce, origem, { aceite });
      if (res.ok && (res.alterados || 0) > 0) await gravarAceiteLocal(db, aceite, origem, res, autor);
      return { ...res, termo: TERMO, aceite: { nome: aceite.nome, cpf: aceite.cpfFormatado } };
    });
  } catch (err) {
    return { ok: false, error: `O aceite foi registrado no cadastro do cliente, no painel, mas a gravação não concluiu: ${err.message}` };
  }
}

async function atribuir(body, autor) {
  return aplicarComAceite(body, autor, 'Classificação por NCM');
}

async function replicador() {
  return withDb(async (db, appCfg) => {
    const alvo = writeTargets(appCfg)[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    const regime = await regimeDaBase(db);
    const chave = `REPLACE(COALESCE(P.COD_NCM, ''), '.', '')`;
    const rows = await query(db, `
      SELECT ${chave} AS NCM, COUNT(*) AS QTD
        FROM ${alvo.tables.estoque} E
        JOIN ${alvo.tables.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
        JOIN ${alvo.tables.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
       WHERE (E.STATUS = 'A' OR E.STATUS IS NULL OR E.STATUS = 'I')
         AND P.COD_NCM IS NOT NULL
         AND CHAR_LENGTH(${chave}) >= 8
         AND ${chave} <> '00000000'
       GROUP BY ${chave}
       ORDER BY 1`);
    const itens = [];
    for (const row of rows) {
      const ncm = digitos(row.NCM);
      if (!ncmValido(ncm)) continue;
      const item = {
        ncm,
        ncm_formatado: formatarNcm(ncm),
        quantidade: Number(row.QTD) || 0,
        nfe: [],
        nfce: [],
      };
      try {
        const consulta = await consultarUm(regime.crt, ncm);
        item.descricao = txt(consulta.ncm?.descricao);
        item.nfe = opcoesDe(consulta.nfe, consulta.sugestao?.nfe);
        item.nfce = opcoesDe(consulta.nfce, consulta.sugestao?.nfce);
      } catch (err) {
        item.erro = err.message || 'A Receita não devolveu opção para este NCM.';
      }
      itens.push(item);
    }
    itens.sort((a, b) => a.ncm.localeCompare(b.ncm, 'pt-BR'));
    return { ok: true, regime: regime.regime, itens };
  });
}

async function replicar(body, autor) {
  const itens = (Array.isArray(body?.itens) ? body.itens : []).filter((item) => ncmValido(item?.ncm));
  if (!itens.length) return { ok: false, error: 'Marque ao menos um NCM válido.' };
  return aplicarComAceite({ ...body, itens }, autor, 'Replicador Geral');
}

module.exports = {
  contexto,
  previa,
  aplicar,
  buscar,
  atribuir,
  replicador,
  replicar,
  previaAlteracao,
  cpfValido,
  situacaoConsulta,
};
