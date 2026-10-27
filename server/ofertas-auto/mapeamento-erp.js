'use strict';

/**
 * Colunas lidas nas views do Clipp. O ManagePro repete o cadastro em V_ESTOQUE_2
 * e é lá que existem PRC_PROMO, INPROMO (início) e FIMPROMO (fim).
 *
 * A view só lê. O estoque é gravado em TB_ESTOQUE, TB_EST_IDENTIFICADOR e
 * TB_EST_PRODUTO (no ManagePro, as mesmas com sufixo _2). O item vendido fica
 * em TB_NFV_ITEM, ligado ao produto por ID_IDENTIFICADOR e à nota TB_NFVENDA
 * por ID_NFVENDA. Nota válida: STATUS = 'E'. Data: DT_EMISSAO.
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
    clipp: {
      item: 'TB_NFV_ITEM',
      nota: 'TB_NFVENDA',
      nota_id: 'ID_NFVENDA',
      produto_id: 'ID_IDENTIFICADOR',
      quantidade: 'QTD_ITEM',
      valor: 'VLR_TOTAL',
      unitario: 'VLR_UNIT',
      data: 'DT_EMISSAO',
      status: 'STATUS',
    },
    manage: {
      item: 'TB_NFV_ITEM_2',
      nota: 'TB_NFVENDA_2',
      nota_id: 'ID_NFVENDA',
      produto_id: 'ID_IDENTIFICADOR',
      quantidade: 'QTD_ITEM',
      valor: 'VLR_TOTAL',
      unitario: 'VLR_UNIT',
      data: 'DT_EMISSAO',
      status: 'STATUS',
    },
  },
};
