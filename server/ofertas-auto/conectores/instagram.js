'use strict';

function criarInstagramSimulado() {
  return {
    modo: 'simulado',
    async status() {
      return { conectada: false, usuario: '', token_expira_em: null, status: 'desconectada', limite_diario: 25 };
    },
    async criarContainer() {
      return { ok: true, creation_id: `sim-${Date.now()}` };
    },
    async publicar(creationId) {
      return { ok: true, media_id: `media-${creationId}` };
    },
    async consultarStatus(creationId) {
      return { id: creationId, status: 'FINISHED' };
    },
    async limite() {
      return { usado: 0, maximo: 25 };
    },
  };
}

function criarInstagramReal() {
  const erro = 'TODO: ligar PublicadorInstagram à API da Meta (container, publicação, status e limite). O token fica só em variável de ambiente.';
  return {
    modo: 'real',
    async status() { return { conectada: false, usuario: '', token_expira_em: null, status: 'desconectada', erro }; },
    async criarContainer() { throw new Error(erro); },
    async publicar() { throw new Error(erro); },
    async consultarStatus() { throw new Error(erro); },
    async limite() { throw new Error(erro); },
  };
}

module.exports = { criarInstagramSimulado, criarInstagramReal };
