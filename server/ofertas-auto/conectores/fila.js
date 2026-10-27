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

function criarFilaReal() {
  const erro = 'TODO: ligar FilaNuvem ao D1 da nuvem (gravar, buscar, confirmar e cópia incremental do catálogo).';
  return {
    modo: 'real',
    async gravar() { throw new Error(erro); },
    async buscar() { throw new Error(erro); },
    async confirmar() { throw new Error(erro); },
  };
}

module.exports = { criarFilaSimulada, criarFilaReal };
