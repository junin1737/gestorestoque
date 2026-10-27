'use strict';

function criarImagensSimuladas() {
  const fotos = new Map();
  return {
    modo: 'simulado',
    async enviar({ produtoId, ean }) {
      const chave = `simulado/${ean || 'sem-ean'}/${produtoId}`;
      fotos.set(chave, { produtoId: String(produtoId || ''), ean: String(ean || ''), em: new Date().toISOString() });
      return { chave, url: `https://exemplo.local/fotos/${encodeURIComponent(chave)}` };
    },
    async urlPublica(chave) {
      return fotos.has(chave) ? `https://exemplo.local/fotos/${encodeURIComponent(chave)}` : '';
    },
    async apagar(chave) {
      fotos.delete(chave);
      return true;
    },
  };
}

function criarImagensReais() {
  const erro = 'TODO: ligar ArmazenamentoImagens ao Cloudflare R2 (enviar, URL pública HTTPS e apagar).';
  return {
    modo: 'real',
    async enviar() { throw new Error(erro); },
    async urlPublica() { throw new Error(erro); },
    async apagar() { throw new Error(erro); },
  };
}

module.exports = { criarImagensSimuladas, criarImagensReais };
