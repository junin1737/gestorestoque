'use strict';

const { criarErpSimulado, criarErpReal } = require('./erp');
const { criarFilaSimulada, criarFilaReal } = require('./fila');
const { criarImagensSimuladas, criarImagensReais } = require('./imagens');
const { criarInstagramSimulado, criarInstagramReal } = require('./instagram');

function modo(nome) {
  return String(process.env[nome] || 'simulado').trim().toLowerCase() === 'real' ? 'real' : 'simulado';
}

function criarConectores(deps) {
  const erpModo = modo('ERP_MODO');
  const filaModo = modo('FILA_MODO');
  const imagensModo = modo('IMAGENS_MODO');
  const igModo = modo('INSTAGRAM_MODO');
  return {
    modos: { erp: erpModo, fila: filaModo, imagens: imagensModo, instagram: igModo },
    erp: erpModo === 'real' ? criarErpReal(deps) : criarErpSimulado(),
    fila: filaModo === 'real' ? criarFilaReal() : criarFilaSimulada(),
    imagens: imagensModo === 'real' ? criarImagensReais() : criarImagensSimuladas(),
    instagram: igModo === 'real' ? criarInstagramReal() : criarInstagramSimulado(),
  };
}

module.exports = { criarConectores, modo };
