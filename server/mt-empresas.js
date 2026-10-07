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

module.exports = {
  registrarEmpresaAtual,
  listarEmpresas,
};
