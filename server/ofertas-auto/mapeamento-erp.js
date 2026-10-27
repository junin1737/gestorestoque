'use strict';

/**
 * Colunas lidas nas views do Clipp. O ManagePro repete o cadastro em V_ESTOQUE_2
 * e é lá que existem PRC_PROMO, INPROMO (início) e FIMPROMO (fim).
 * Itens vendidos não estão nessas views.
 */
module.exports = {
  pronto: true,
  clipp: {
    view: 'V_ESTOQUE',
    id: 'ID_IDENTIFICADOR',
    codigo: 'ID_ESTOQUE',
    descricao: 'PROD_SERV',
    ean: 'COD_BARRA',
    preco: 'PRC_VENDA',
    estoque: 'QTD_ATUAL',
    custo: 'PRC_CUSTO',
    categoria: 'GRUPO',
    referencia: 'REFERENCIA',
    status: 'STATUS',
    campos_texto: ['DESC_CMPL', 'INFCOMPLEMENTAR', 'ADICIONAL1', 'ADICIONAL2'],
  },
  manage: {
    view: 'V_ESTOQUE_2',
    id: 'ID_IDENTIFICADOR',
    codigo: 'ID_ESTOQUE',
    descricao: 'PROD_SERV',
    ean: 'COD_BARRA',
    preco: 'PRC_VENDA',
    preco_promocional: 'PRC_PROMO',
    promocao_inicio: 'INPROMO',
    promocao_fim: 'FIMPROMO',
    estoque: 'QTD_ATUAL',
    custo: 'PRC_CUSTO',
    categoria: 'GRUPO',
    referencia: 'REFERENCIA',
    status: 'STATUS',
    campos_texto: ['DESC_CMPL', 'OBS'],
  },
  vendidos: {
    tabela: 'TODO',
    produto_id: 'TODO',
    quantidade: 'TODO',
    valor: 'TODO',
    data: 'TODO',
  },
};
