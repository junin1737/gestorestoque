'use strict';

/**
 * Contrato da ordem de serviço. O primeiro perfil é Informática; em seguida
 * autopeças, motopeças ou outro cadastrado na aba Serviços do painel de licença.
 * O Gestor recebe o perfil na licença, em situacao().servicos.
 *
 * A O.S fica nas tabelas do Gestor, com prefixo GESTOR_. O Clipp já tem TB_OS*
 * e já usa TB_PEDIDO_VENDA.ORIGEM, então essas tabelas dele não são gravadas.
 *
 * Enviar para a venda grava as tabelas do condicional (condicionais.gravarPedidoOS)
 * e marca o pedido em GESTOR_PEDIDO_ORIGEM com ORIGEM='OS'. O menu Condicional
 * esconde esses pedidos. Serviço na venda é o item tipo 9.
 */

const PERFIS_PADRAO = [
  { id: 'informatica', nome: 'Informática' },
  { id: 'autopecas', nome: 'Autopeças' },
  { id: 'motopecas', nome: 'Motopeças' },
];

function slugPerfil(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function normalizarPerfilOs(os) {
  const recebidos = Array.isArray(os?.perfis) ? os.perfis : [];
  const perfis = [];
  const vistos = new Set();
  for (const item of [...PERFIS_PADRAO, ...recebidos]) {
    const nome = String(item?.nome || '').trim().slice(0, 40);
    const id = slugPerfil(item?.id || nome);
    if (!nome || !id || vistos.has(id)) continue;
    vistos.add(id);
    perfis.push({ id, nome });
  }
  const pedido = slugPerfil(os?.perfil);
  const perfil = perfis.some((p) => p.id === pedido) ? pedido : '';
  return {
    ativo: os?.ativo === true,
    perfil,
    perfis,
  };
}

module.exports = {
  PERFIS_PADRAO,
  slugPerfil,
  normalizarPerfilOs,
};
