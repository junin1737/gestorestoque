'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAppDataDir, loadAppConfig } = require('./config');
const { gerarHashSenha, conferirHashSenha } = require('./senha');
const { withDb, query, writeTargets } = require('./db');
const { listClassTrib } = require('./importacao-notas');

const COOKIE = 'gestor_contador';
const MAX_LOG = 400;

function arquivoContas() {
  return path.join(getAppDataDir(), 'contadores.json');
}

function arquivoLog() {
  return path.join(getAppDataDir(), 'contador-auditoria.json');
}

function arquivoChave() {
  return path.join(getAppDataDir(), '.contador-key');
}

function lerJson(arquivo, fallback) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return fallback;
  }
}

function gravarJson(arquivo, data) {
  fs.writeFileSync(arquivo, JSON.stringify(data, null, 2));
}

function segredo() {
  try {
    return fs.readFileSync(arquivoChave());
  } catch {
    const buf = crypto.randomBytes(32);
    fs.writeFileSync(arquivoChave(), buf);
    return buf;
  }
}

function lerContas() {
  const data = lerJson(arquivoContas(), { contas: [] });
  return Array.isArray(data.contas) ? data.contas : [];
}

function salvarContas(contas) {
  gravarJson(arquivoContas(), { contas });
}

function lerLog() {
  const data = lerJson(arquivoLog(), { itens: [] });
  return Array.isArray(data.itens) ? data.itens : [];
}

function salvarLog(itens) {
  gravarJson(arquivoLog(), { itens: itens.slice(0, MAX_LOG) });
}

function contaPublica(c) {
  return {
    email: c.email,
    nome: c.nome,
    ativo: c.ativo !== false,
  };
}

function listarContas() {
  return lerContas().map(contaPublica);
}

function cadastrarConta({ email, nome, senha }) {
  const mail = String(email || '').trim().toLowerCase();
  const nomeLimpo = String(nome || '').trim().slice(0, 80);
  const senhaLimpa = String(senha || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return { ok: false, error: 'Informe um e-mail válido.' };
  }
  if (senhaLimpa.length < 6) {
    return { ok: false, error: 'A senha do contador precisa ter ao menos 6 caracteres.' };
  }
  const contas = lerContas();
  const ja = contas.find((c) => c.email === mail);
  const conta = {
    email: mail,
    nome: nomeLimpo || mail,
    senhaHash: gerarHashSenha(senhaLimpa),
    ativo: true,
  };
  if (ja) {
    Object.assign(ja, conta);
  } else {
    contas.push(conta);
  }
  salvarContas(contas);
  return { ok: true, conta: contaPublica(conta) };
}

function removerConta(email) {
  const mail = String(email || '').trim().toLowerCase();
  const contas = lerContas().filter((c) => c.email !== mail);
  salvarContas(contas);
  return { ok: true };
}

function emitirToken(conta) {
  const payload = Buffer.from(JSON.stringify({
    e: conta.email,
    exp: Date.now() + 12 * 3600000,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', segredo()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function lerToken(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 2) return null;
  const [payload, sig] = partes;
  const esperado = crypto.createHmac('sha256', segredo()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!dados?.e || Number(dados.exp) < Date.now()) return null;
    return dados;
  } catch {
    return null;
  }
}

function lerCookie(req, nome) {
  const bruto = String(req.headers.cookie || '');
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return '';
}

function definirCookie(res, valor, maxAgeS) {
  const partes = [`${COOKIE}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeS != null) partes.push(`Max-Age=${maxAgeS}`);
  const existente = res.getHeader('Set-Cookie');
  const linha = partes.join('; ');
  if (!existente) res.setHeader('Set-Cookie', linha);
  else if (Array.isArray(existente)) res.setHeader('Set-Cookie', existente.concat(linha));
  else res.setHeader('Set-Cookie', [existente, linha]);
}

function contaDoToken(token) {
  const dados = lerToken(token);
  if (!dados) return null;
  const conta = lerContas().find((c) => c.email === dados.e && c.ativo !== false);
  if (!conta) return null;
  return contaPublica(conta);
}

function daRequisicao(req) {
  return contaDoToken(lerCookie(req, COOKIE));
}

function login(email, senha) {
  const mail = String(email || '').trim().toLowerCase();
  const conta = lerContas().find((c) => c.email === mail && c.ativo !== false);
  if (!conta || !conferirHashSenha(senha, conta.senhaHash)) {
    return { ok: false, error: 'E-mail ou senha incorretos.' };
  }
  return { ok: true, token: emitirToken(conta), conta: contaPublica(conta) };
}

function responderLogin(req, res) {
  const r = login(req.body?.email, req.body?.senha);
  if (!r.ok) return res.status(401).json(r);
  definirCookie(res, r.token, 12 * 3600);
  return res.json({ ok: true, contador: r.conta });
}

function logout(_req, res) {
  definirCookie(res, '', 0);
  res.json({ ok: true });
}

async function listarClientes() {
  let atual = { nome: 'Esta loja', cnpj: '', atual: true, online: true, url: '' };
  try {
    const emit = await withDb(async (db) => {
      const rows = await query(db, `
        SELECT FIRST 1 NOME_FANTA, NOME, CNPJ FROM TB_EMITENTE`);
      return rows[0] || {};
    });
    atual = {
      nome: String(emit.NOME_FANTA || emit.NOME || 'Esta loja').trim(),
      cnpj: String(emit.CNPJ || '').replace(/\D/g, ''),
      atual: true,
      online: true,
      url: '',
    };
  } catch (e) {
    atual.erro = e.message;
  }
  let outros = [];
  try {
    const grupo = await require('./mt-empresas').grupoLogin();
    outros = (grupo.empresas || [])
      .filter((e) => e && !e.atual)
      .map((e) => ({
        nome: e.nome || e.cnpj,
        cnpj: String(e.cnpj || '').replace(/\D/g, ''),
        url: e.url || '',
        atual: false,
        online: !!e.url,
      }));
  } catch {
    outros = [];
  }
  return [atual, ...outros];
}

function txt(v) {
  return String(v == null ? '' : v).trim();
}

async function lerItem(db, t, id) {
  const rows = await query(db, `
    SELECT FIRST 1
      E.ID_ESTOQUE, I.ID_IDENTIFICADOR, E.DESCRICAO, E.CFOP, E.CFOP_NF,
      P.COD_NCM, P.COD_CEST, P.REFERENCIA, P.COD_BARRA, P.QTD_ATUAL, E.UNI_MEDIDA
    FROM ${t.estoque} E
    JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
    JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
    WHERE I.ID_IDENTIFICADOR = ?`, [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  const idEst = Number(r.ID_ESTOQUE);
  let nfe = {};
  let nfce = {};
  try {
    nfe = (await query(db, `
      SELECT FIRST 1 T.ID_CLASS_TRIB, C.COD_CLASS_TRIB, C.DESC_CLASS_TRIB
      FROM TB_EST_TRIBUTOS T
      LEFT JOIN TB_CLASS_TRIB C ON C.ID_CLASS_TRIB = T.ID_CLASS_TRIB
      WHERE T.ID_ESTOQUE = ?`, [idEst]))[0] || {};
  } catch { nfe = {}; }
  try {
    nfce = (await query(db, `
      SELECT FIRST 1 T.ID_CLASS_TRIB, C.COD_CLASS_TRIB, C.DESC_CLASS_TRIB
      FROM TB_EST_TRIBUTOS_NFCE T
      LEFT JOIN TB_CLASS_TRIB C ON C.ID_CLASS_TRIB = T.ID_CLASS_TRIB
      WHERE T.ID_ESTOQUE = ?`, [idEst]))[0] || {};
  } catch { nfce = {}; }
  const label = (row) => {
    const cod = txt(row.COD_CLASS_TRIB);
    const desc = txt(row.DESC_CLASS_TRIB);
    return cod || desc ? `${cod}${desc ? ` — ${desc}` : ''}` : '';
  };
  return {
    id_estoque: idEst,
    id_identificador: Number(r.ID_IDENTIFICADOR),
    descricao: txt(r.DESCRICAO),
    ncm: txt(r.COD_NCM),
    cest: txt(r.COD_CEST),
    cfop: txt(r.CFOP),
    cfop_nf: txt(r.CFOP_NF),
    referencia: txt(r.REFERENCIA),
    cod_barras: txt(r.COD_BARRA),
    qtd_atual: Number(r.QTD_ATUAL || 0),
    uni_medida: txt(r.UNI_MEDIDA),
    id_class_trib: nfe.ID_CLASS_TRIB != null ? Number(nfe.ID_CLASS_TRIB) : null,
    class_nfe: label(nfe),
    id_class_trib_nfce: nfce.ID_CLASS_TRIB != null ? Number(nfce.ID_CLASS_TRIB) : null,
    class_nfce: label(nfce),
  };
}

async function buscarItens(q) {
  const busca = String(q || '').trim();
  if (busca.length < 1) return [];
  return withDb(async (db) => {
    const alvo = writeTargets(loadAppConfig())[0];
    if (!alvo) return [];
    const t = alvo.tables;
    const where = [];
    const params = [];
    if (/^\d+$/.test(busca) && busca.length <= 8) {
      where.push(`(I.ID_IDENTIFICADOR = ? OR CAST(I.ID_IDENTIFICADOR AS VARCHAR(20)) STARTING WITH ? OR P.COD_NCM STARTING WITH ?)`);
      params.push(Number(busca), busca, busca);
    } else {
      where.push(`(
        UPPER(E.DESCRICAO) CONTAINING UPPER(?)
        OR UPPER(COALESCE(P.COD_BARRA, '')) CONTAINING UPPER(?)
        OR UPPER(COALESCE(P.REFERENCIA, '')) CONTAINING UPPER(?)
        OR COALESCE(P.COD_NCM, '') CONTAINING ?
      )`);
      params.push(busca, busca, busca, busca.replace(/\D/g, '') || busca);
    }
    const rows = await query(db, `
      SELECT FIRST 40
        I.ID_IDENTIFICADOR, E.DESCRICAO, P.COD_NCM, P.COD_BARRA, P.QTD_ATUAL
      FROM ${t.estoque} E
      JOIN ${t.identificador} I ON I.ID_ESTOQUE = E.ID_ESTOQUE
      JOIN ${t.produto} P ON P.ID_IDENTIFICADOR = I.ID_IDENTIFICADOR
      WHERE (E.STATUS = 'A' OR E.STATUS IS NULL) AND ${where.join(' AND ')}
      ORDER BY E.DESCRICAO`, params);
    return rows.map((r) => ({
      id_identificador: Number(r.ID_IDENTIFICADOR),
      descricao: txt(r.DESCRICAO),
      ncm: txt(r.COD_NCM),
      cod_barras: txt(r.COD_BARRA),
      qtd_atual: Number(r.QTD_ATUAL || 0),
    }));
  });
}

async function obterItem(id) {
  return withDb(async (db) => {
    const alvo = writeTargets(loadAppConfig())[0];
    if (!alvo) return null;
    return lerItem(db, alvo.tables, Number(id));
  });
}

function numOuNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function gravarClass(db, tabela, idEst, idClass) {
  const existe = await query(db, `SELECT FIRST 1 ID_ESTOQUE FROM ${tabela} WHERE ID_ESTOQUE = ?`, [idEst]);
  if (!idClass) {
    if (existe.length) await query(db, `UPDATE ${tabela} SET ID_CLASS_TRIB = NULL WHERE ID_ESTOQUE = ?`, [idEst]);
    return;
  }
  if (tabela === 'TB_EST_TRIBUTOS') {
    if (existe.length) {
      await query(db, `UPDATE TB_EST_TRIBUTOS SET ID_CLASS_TRIB = ? WHERE ID_ESTOQUE = ?`, [idClass, idEst]);
    } else {
      await query(db, `
        INSERT INTO TB_EST_TRIBUTOS (
          ID_ESTOQUE, ID_CLASS_TRIB, DIFERIMENTO_CBS, COD_CRED_PRESU_CBS, ALIQ_CRED_PRESU_CBS,
          DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN, COD_CRED_PRESU_IBS, ALIQ_CRED_PRESU_IBS,
          ID_CLASS_TRIB_REGULAR, DEDUZ_CRED_PRESU_CBS, DEDUZ_CRED_PRESU_IBS, IND_BEM_MOVEL_USADO
        ) VALUES (?, ?, 0, NULL, 0, 0, 0, NULL, 0, NULL, 'N', 'N', 'N')`, [idEst, idClass]);
    }
    return;
  }
  if (existe.length) {
    await query(db, `UPDATE TB_EST_TRIBUTOS_NFCE SET ID_CLASS_TRIB = ? WHERE ID_ESTOQUE = ?`, [idClass, idEst]);
  } else {
    await query(db, `
      INSERT INTO TB_EST_TRIBUTOS_NFCE (
        ID_ESTOQUE, ID_CLASS_TRIB, DIFERIMENTO_CBS, DIFERIMENTO_IBS_UF, DIFERIMENTO_IBS_MUN
      ) VALUES (?, ?, 0, 0, 0)`, [idEst, idClass]);
  }
}

async function aplicarSnapshot(db, t, id, snap) {
  const atual = await lerItem(db, t, id);
  if (!atual) throw new Error('Produto não encontrado.');
  await query(db, `
    UPDATE ${t.estoque}
    SET DESCRICAO = ?, CFOP = ?, CFOP_NF = ?
    WHERE ID_ESTOQUE = ?`, [
    String(snap.descricao || '').slice(0, 120),
    txt(snap.cfop) || null,
    txt(snap.cfop_nf) || null,
    atual.id_estoque,
  ]);
  await query(db, `
    UPDATE ${t.produto}
    SET COD_NCM = ?, COD_CEST = ?, REFERENCIA = ?
    WHERE ID_IDENTIFICADOR = ?`, [
    txt(snap.ncm).replace(/\D/g, '').slice(0, 8) || null,
    txt(snap.cest).replace(/\D/g, '').slice(0, 7) || null,
    txt(snap.referencia).slice(0, 18) || null,
    id,
  ]);
  await gravarClass(db, 'TB_EST_TRIBUTOS', atual.id_estoque, numOuNull(snap.id_class_trib));
  await gravarClass(db, 'TB_EST_TRIBUTOS_NFCE', atual.id_estoque, numOuNull(snap.id_class_trib_nfce));
  return lerItem(db, t, id);
}

function camposIguais(a, b) {
  const chaves = ['descricao', 'ncm', 'cest', 'cfop', 'cfop_nf', 'referencia', 'id_class_trib', 'id_class_trib_nfce'];
  return chaves.every((k) => String(a?.[k] ?? '') === String(b?.[k] ?? ''));
}

async function salvarItem(id, body, autor) {
  const ident = Number(id);
  return withDb(async (db) => {
    const alvo = writeTargets(loadAppConfig())[0];
    if (!alvo) return { ok: false, error: 'Base de estoque indisponível.' };
    const t = alvo.tables;
    const antes = await lerItem(db, t, ident);
    if (!antes) return { ok: false, error: 'Produto não encontrado.' };
    const depoisPedido = {
      ...antes,
      descricao: body.descricao != null ? txt(body.descricao) : antes.descricao,
      ncm: body.ncm != null ? txt(body.ncm) : antes.ncm,
      cest: body.cest != null ? txt(body.cest) : antes.cest,
      cfop: body.cfop != null ? txt(body.cfop) : antes.cfop,
      cfop_nf: body.cfop_nf != null ? txt(body.cfop_nf) : antes.cfop_nf,
      referencia: body.referencia != null ? txt(body.referencia) : antes.referencia,
      id_class_trib: body.id_class_trib !== undefined ? numOuNull(body.id_class_trib) : antes.id_class_trib,
      id_class_trib_nfce: body.id_class_trib_nfce !== undefined ? numOuNull(body.id_class_trib_nfce) : antes.id_class_trib_nfce,
    };
    if (camposIguais(antes, depoisPedido)) {
      return { ok: true, item: antes, sem_mudanca: true };
    }
    const depois = await aplicarSnapshot(db, t, ident, depoisPedido);
    const registro = {
      id: crypto.randomUUID(),
      em: new Date().toISOString(),
      email: autor?.email || '',
      nome: autor?.nome || 'Contador',
      id_identificador: ident,
      descricao: depois.descricao,
      antes,
      depois,
      desfeito: false,
    };
    salvarLog([registro, ...lerLog()]);
    return { ok: true, item: depois, registro };
  });
}

function relacao() {
  return lerLog();
}

async function desfazer(id, autor) {
  const itens = lerLog();
  const reg = itens.find((x) => x.id === id);
  if (!reg) return { ok: false, error: 'Alteração não encontrada.' };
  if (reg.desfeito) return { ok: false, error: 'Esta alteração já foi desfeita.' };
  const out = await withDb(async (db) => {
    const alvo = writeTargets(loadAppConfig())[0];
    if (!alvo) throw new Error('Base de estoque indisponível.');
    const depois = await aplicarSnapshot(db, alvo.tables, reg.id_identificador, reg.antes);
    return depois;
  });
  reg.desfeito = true;
  reg.desfeito_em = new Date().toISOString();
  reg.desfeito_por = autor?.nome || autor?.email || '';
  const volta = {
    id: crypto.randomUUID(),
    em: new Date().toISOString(),
    email: autor?.email || '',
    nome: autor?.nome || 'Contador',
    id_identificador: reg.id_identificador,
    descricao: out.descricao,
    antes: reg.depois,
    depois: out,
    desfeito: false,
    desfaz: reg.id,
  };
  salvarLog([volta, ...itens]);
  return { ok: true, item: out };
}

module.exports = {
  COOKIE,
  listarContas,
  cadastrarConta,
  removerConta,
  daRequisicao,
  responderLogin,
  logout,
  listarClientes,
  buscarItens,
  obterItem,
  salvarItem,
  relacao,
  desfazer,
  listarClassTrib: listClassTrib,
};
