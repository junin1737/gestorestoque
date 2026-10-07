'use strict';

const { LICENCA_URL, APLICACAO, lerIdentidade } = require('./licenca');

async function registrarEmpresaAtual(urlPainel) {
  if (!LICENCA_URL) return { ok: false, error: 'Licença desligada.' };
  let id;
  try {
    id = await lerIdentidade();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const res = await fetch(`${LICENCA_URL}/api/mt/empresa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      aplicacao: APLICACAO,
      cnpj: id.cnpj,
      nse: id.nse,
      nome: id.fantasia || id.razao || '',
      url: String(urlPainel || '').trim(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    return { ok: false, error: data.error || `Servidor de licenças respondeu ${res.status}.` };
  }
  return data;
}

async function listarEmpresas() {
  if (!LICENCA_URL) return { ok: true, itens: [] };
  const res = await fetch(`${LICENCA_URL}/api/mt/empresas?aplicacao=${encodeURIComponent(APLICACAO)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    return { ok: false, error: data.error || `Servidor de licenças respondeu ${res.status}.`, itens: [] };
  }
  return { ok: true, itens: data.itens || [] };
}

async function chamarLicenca(caminho, opcoes = {}) {
  if (!LICENCA_URL) return { ok: false, error: 'Licença desligada.' };
  const res = await fetch(`${LICENCA_URL}${caminho}`, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    return { ok: false, error: data.error || `Servidor de licenças respondeu ${res.status}.` };
  }
  return data;
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

async function listarCadastro() {
  return chamarLicenca(`/api/mt/empresas/cadastro?aplicacao=${encodeURIComponent(APLICACAO)}`);
}

async function listarVinculos() {
  const data = await chamarLicenca(`/api/mt/vinculos?aplicacao=${encodeURIComponent(APLICACAO)}`);
  return { ok: data.ok !== false, error: data.error, itens: data.itens || [] };
}

async function criarVinculo(cnpjMatriz, cnpjFilial) {
  return chamarLicenca('/api/mt/vinculos', {
    method: 'POST',
    body: JSON.stringify({
      aplicacao: APLICACAO,
      cnpjMatriz,
      cnpjFilial,
    }),
  });
}

async function grupoLogin() {
  let cnpj = '';
  try {
    cnpj = await cnpjAtual();
  } catch (err) {
    return { ok: false, error: err.message, empresas: [] };
  }
  if (!cnpj) return { ok: true, empresas: [] };
  const data = await chamarLicenca(
    `/api/mt/grupo?aplicacao=${encodeURIComponent(APLICACAO)}&cnpj=${encodeURIComponent(cnpj)}`
  );
  return { ok: data.ok !== false, error: data.error, empresas: data.empresas || [] };
}

async function pendentesDestaEmpresa() {
  let cnpj = '';
  try {
    cnpj = await cnpjAtual();
  } catch (err) {
    return { ok: false, error: err.message, pendentes: [], aguardando: [] };
  }
  const data = await chamarLicenca(
    `/api/mt/vinculos?aplicacao=${encodeURIComponent(APLICACAO)}&cnpj=${encodeURIComponent(cnpj)}`
  );
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
  let cnpj = '';
  try {
    cnpj = await cnpjAtual();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return chamarLicenca('/api/mt/vinculos/aceite', {
    method: 'POST',
    body: JSON.stringify({
      aplicacao: APLICACAO,
      cnpj,
      id,
      aceite,
    }),
  });
}

module.exports = {
  registrarEmpresaAtual,
  listarEmpresas,
  listarCadastro,
  listarVinculos,
  criarVinculo,
  grupoLogin,
  pendentesDestaEmpresa,
  responderVinculo,
};
