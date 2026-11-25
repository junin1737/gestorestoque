'use strict';

/**
 * Perfil da ordem de serviço escolhido no painel do serviço.
 *
 * Quando o lançamento for feito, grava os dois lados:
 * - as mesmas tabelas do condicional: TB_PEDIDO_VENDA (GEN_TB_DAV_ID),
 *   TB_PED_VENDA_ITEM (GEN_TB_PED_VENDA_ITEM_ID), GESTOR_COND_TOTAL,
 *   e o UPDATE em TB_PEDIDO_VENDA que faz o Clipp preencher TB_PED_VENDA_NOME.
 *   A linha leva CHAVE, DT_LACTO, ID_SEQUENCIA_DAV, casas, ST e alíquota,
 *   no mesmo fechamento de server/condicionais.js.
 * - a OS do Clipp: TB_OS, TB_OS_ITEM (peça e serviço), TB_OS_OBJETO_OS
 *   (defeito e os seis identificadores) e TB_OS_CADASTRO.
 *
 * Serviço é ID_TIPOITEM '9' ou linha em TB_EST_SERVICO. O resto é peça.
 * O percentual copiado para TB_OS_ITEM.POR_COMISSAO sai de TB_OS_FUNC_COMISSAO:
 * POR_COMISSAO_P na peça e POR_COMISSAO_S no serviço, do funcionário técnico.
 * TB_FUNC_COMISSAO guarda à vista, a prazo e cartão, e não é coluna de TB_FUNCIONARIO.
 * A importação fiscal do Clipp usa QTD_IMPORT, TB_OS.IMPORTADO, TB_OS_NFVENDA
 * e TB_OS_ITEM_IMPORTADO. TB_OS_DAV só registra a impressão do DAV da OS.
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
