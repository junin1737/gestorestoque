'use strict';

const { LICENCA_URL, APLICACAO, lerIdentidade, cabecalhosInstalacao } = require('./licenca');

const TIMEOUT_MS = 10000;

async function chamarLicenca(caminho, opcoes = {}) {
  if (!LICENCA_URL) return { ok: false, error: 'Licença desligada.' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${LICENCA_URL}${caminho}`, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
      signal: ctrl.signal,
    });
  } catch (err) {
    return { ok: false, offline: true, error: err.name === 'AbortError' ? 'Servidor de licenças não respondeu.' : 'Sem conexão com o servidor de licenças.' };
  } finally {
    clearTimeout(t);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    return { ok: false, status: res.status, code: data.code, error: data.error || `Servidor de licenças respondeu ${res.status}.` };
  }
  return data;
}

/** Senha do MT Entradas: conferida só no servidor de licenças (não fica gravada no Gestor). */
async function loginMt(senha) {
  return chamarLicenca('/api/mt/login', { method: 'POST', body: JSON.stringify({ senha: String(senha || '') }) });
}

function comToken(tokenMt) {
  return { Authorization: `Bearer ${tokenMt}` };
}

async function comoEstaEmpresa(caminho, opcoes = {}) {
  let headers;
  try {
    headers = await cabecalhosInstalacao();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return chamarLicenca(caminho, { ...opcoes, headers: { ...(opcoes.headers || {}), ...headers } });
}

async function listarEmpresas(tokenMt) {
  const data = await chamarLicenca(`/api/mt/empresas?aplicacao=${encodeURIComponent(APLICACAO)}`, { headers: comToken(tokenMt) });
  return { ...data, ok: data.ok !== false, itens: data.itens || [] };
}

async function cnpjAtual() {
  const id = await lerIdentidade();
  return String(id.cnpj || '').replace(/\D/g, '');
}

function ladoVinculo(v, cnpj) {
  if (v.cnpj_matriz === cnpj) return 'matriz';
  if (v.cnpj_filial === cnpj) return 'filial';
  return '';
}

function paraEstaEmpresa(v, cnpj) {
  const lado = ladoVinculo(v, cnpj);
  const nosso = lado === 'matriz' ? v.aceite_matriz : v.aceite_filial;
  return {
    id: v.id,
    status: v.status,
    nosso: nosso || null,
    outra_nome: lado === 'matriz' ? v.nome_filial : v.nome_matriz,
    outra_cnpj: lado === 'matriz' ? v.cnpj_filial : v.cnpj_matriz,
    papel_outra: lado === 'matriz' ? 'filial' : 'matriz',
    nome_matriz: v.nome_matriz,
    nome_filial: v.nome_filial,
    cnpj_matriz: v.cnpj_matriz,
    cnpj_filial: v.cnpj_filial,
  };
}

async function listarCadastro(tokenMt) {
  return chamarLicenca(`/api/mt/empresas/cadastro?aplicacao=${encodeURIComponent(APLICACAO)}`, { headers: comToken(tokenMt) });
}

async function listarVinculos(tokenMt) {
  const data = await chamarLicenca(`/api/mt/vinculos?aplicacao=${encodeURIComponent(APLICACAO)}`, { headers: comToken(tokenMt) });
  return { ...data, ok: data.ok !== false, itens: data.itens || [] };
}

async function criarVinculo(tokenMt, cnpjMatriz, cnpjFilial) {
  return chamarLicenca('/api/mt/vinculos', {
    method: 'POST',
    headers: comToken(tokenMt),
    body: JSON.stringify({
      aplicacao: APLICACAO,
      cnpjMatriz,
      cnpjFilial,
    }),
  });
}

async function grupoLogin() {
  const data = await comoEstaEmpresa(`/api/mt/grupo?aplicacao=${encodeURIComponent(APLICACAO)}`);
  return { ok: data.ok !== false, error: data.error, empresas: data.empresas || [] };
}

async function pendentesDestaEmpresa() {
  let cnpj = '';
  try {
    cnpj = await cnpjAtual();
  } catch (err) {
    return { ok: false, error: err.message, pendentes: [], aguardando: [] };
  }
  const data = await comoEstaEmpresa(`/api/mt/vinculos?aplicacao=${encodeURIComponent(APLICACAO)}`);
  if (data.ok === false) return { ok: false, error: data.error, pendentes: [], aguardando: [] };
  const pendentes = [];
  const aguardando = [];
  for (const v of data.itens || []) {
    if (!ladoVinculo(v, cnpj) || v.status === 'recusado' || v.status === 'ativo') continue;
    const item = paraEstaEmpresa(v, cnpj);
    if (!item.nosso) pendentes.push(item);
    else if (item.nosso === 'aceito') aguardando.push(item);
  }
  return { ok: true, pendentes, aguardando };
}

async function responderVinculo(id, aceite) {
  return comoEstaEmpresa('/api/mt/vinculos/aceite', {
    method: 'POST',
    body: JSON.stringify({
      aplicacao: APLICACAO,
      id,
      aceite,
    }),
  });
}

module.exports = {
  loginMt,
  listarEmpresas,
  listarCadastro,
  listarVinculos,
  criarVinculo,
  grupoLogin,
  pendentesDestaEmpresa,
  responderVinculo,
};
