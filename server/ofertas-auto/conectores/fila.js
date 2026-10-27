'use strict';

const { randomUUID } = require('crypto');
const { lerArquivo, gravarArquivo } = require('../config-loja');

function criarFilaSimulada() {
  return {
    modo: 'simulado',
    async gravar(item) {
      const dados = lerArquivo();
      dados.fila = Array.isArray(dados.fila) ? dados.fila : [];
      const novo = {
        id: item.id || randomUUID(),
        loja_id: String(item.loja_id || ''),
        produto_id: String(item.produto_id || ''),
        campo: String(item.campo || ''),
        valor_visto: item.valor_visto ?? null,
        valor_novo: item.valor_novo ?? null,
        periodo: item.periodo || null,
        usuario: String(item.usuario || ''),
        criado_em: item.criado_em || new Date().toISOString(),
        status: 'pendente',
        resultado: '',
      };
      dados.fila.push(novo);
      gravarArquivo(dados);
      return novo;
    },
    async buscar(lojaId, status) {
      const fila = lerArquivo().fila || [];
      return fila
        .filter((i) => (!lojaId || i.loja_id === lojaId) && (!status || i.status === status))
        .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
    },
    async confirmar(id, resultado) {
      const dados = lerArquivo();
      const item = (dados.fila || []).find((i) => i.id === id);
      if (!item) return null;
      item.status = resultado.status || item.status;
      item.resultado = String(resultado.resultado || '');
      gravarArquivo(dados);
      return item;
    },
  };
}

async function chamarFila(path, options = {}) {
  const { LICENCA_URL, cabecalhosInstalacao } = require('../../licenca');
  const headers = {
    ...(await cabecalhosInstalacao()),
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetch(`${LICENCA_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `A fila na nuvem recusou a chamada (${res.status}).`);
  }
  return data;
}

function criarFilaReal() {
  return {
    modo: 'real',
    async gravar(item) {
      return chamarFila('/api/ofertas/fila', { method: 'POST', body: JSON.stringify(item) });
    },
    async buscar(lojaId, status) {
      const q = new URLSearchParams();
      if (lojaId) q.set('loja', lojaId);
      if (status) q.set('status', status);
      const data = await chamarFila(`/api/ofertas/fila?${q.toString()}`);
      return data.itens || [];
    },
    async confirmar(id, resultado) {
      return chamarFila(`/api/ofertas/fila/${encodeURIComponent(id)}/confirmar`, {
        method: 'POST',
        body: JSON.stringify(resultado || {}),
      });
    },
  };
}

module.exports = { criarFilaSimulada, criarFilaReal };
