'use strict';

/**
 * Nomes das tabelas e dos campos do ERP.
 * Enquanto `pronto` for false, o conector real não consulta a base.
 * Preencha e mude `pronto` para true. Veja CONEXOES.md.
 */
module.exports = {
  pronto: false,
  produto: {
    tabela: 'TODO',
    id: 'TODO',
    codigo: 'TODO',
    descricao: 'TODO',
    ean: 'TODO',
    preco: 'TODO',
    preco_promocional: 'TODO',
    promocao_inicio: 'TODO',
    promocao_fim: 'TODO',
    estoque: 'TODO',
    custo: 'TODO',
    categoria: 'TODO',
    campos_texto: ['TODO'],
  },
  vendidos: {
    tabela: 'TODO',
    produto_id: 'TODO',
    quantidade: 'TODO',
    valor: 'TODO',
    data: 'TODO',
  },
};
