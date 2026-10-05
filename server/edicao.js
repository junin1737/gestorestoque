'use strict';
/**
 * Edição do aplicativo. "online" roda lado a lado com o Gestor Estoque normal:
 * outra porta, outra pasta de dados, outro instalador e atualizações só das releases online.
 */
let pkg = {};
try {
  pkg = require('../package.json');
} catch { /* sem package.json: edição normal */ }

const ONLINE = pkg.gestorEdicao === 'online';

module.exports = {
  ONLINE,
  NOME: ONLINE ? 'Gestor Estoque Online' : 'Gestor Estoque',
  PASTA_DADOS: ONLINE ? 'GestorEstoqueOnline' : 'GestorEstoque',
  PORTA_PADRAO: ONLINE ? 5078 : 5077,
  RAMO_GIT: ONLINE ? 'online' : 'main',
  INSTALADOR_RE: ONLINE ? /^gestorestoque-online-.*\.exe$/i : /^GestorEstoque-Setup-.*\.exe$/i,
};
