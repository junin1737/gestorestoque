'use strict';

const mapeamento = require('../mapeamento-erp');

/** Casos pedidos: saldo positivo, zero, negativo, com e sem promoção, sem foto, sem EAN e produção própria. */
function catalogoSimulado() {
  return [
    {
      id: '1001', codigo: '1001', descricao: 'Arroz tipo 1 5kg', ean: '7891000100103',
      preco: 22.9, preco_promocional: null, promocao_inicio: '', promocao_fim: '',
      estoque: 20, custo: 16.4, categoria: 'Mercearia', observacao: 'Fardo',
      foto: true, ignorar_estoque: false,
    },
    {
      id: '1002', codigo: '1002', descricao: 'Feijão carioca 1kg', ean: '7891000100202',
      preco: 8.5, preco_promocional: 6.9, promocao_inicio: '2026-01-01', promocao_fim: '2026-12-31',
      estoque: 0, custo: 5.1, categoria: 'Mercearia', observacao: '',
      foto: true, ignorar_estoque: false,
    },
    {
      id: '1003', codigo: '1003', descricao: 'Leite integral 1L', ean: '7891000100301',
      preco: 4.8, preco_promocional: null, promocao_inicio: '', promocao_fim: '',
      estoque: -3, custo: 3.6, categoria: 'Laticínios', observacao: '',
      foto: false, ignorar_estoque: false,
    },
    {
      id: '1004', codigo: '1004', descricao: 'Bolo de cenoura', ean: '7891000100400',
      preco: 35, preco_promocional: 28, promocao_inicio: '2026-10-01', promocao_fim: '2026-10-31',
      estoque: 4, custo: 14, categoria: 'Confeitaria', observacao: 'Coberto com chocolate',
      foto: true, ignorar_estoque: false,
    },
    {
      id: '1005', codigo: '1005', descricao: 'Pão francês', ean: '',
      preco: 0.8, preco_promocional: null, promocao_inicio: '', promocao_fim: '',
      estoque: 0, custo: 0.25, categoria: 'Padaria', observacao: 'Produção própria',
      foto: false, ignorar_estoque: true,
    },
    {
      id: '1006', codigo: '1006', descricao: 'Refrigerante cola 2L', ean: '7891000100608',
      preco: 9, preco_promocional: 7.5, promocao_inicio: '2025-01-01', promocao_fim: '2025-12-31',
      estoque: 12, custo: 6.2, categoria: 'Bebidas', observacao: '',
      foto: true, ignorar_estoque: false,
    },
    {
      id: '1007', codigo: '1007', descricao: 'Sabão em barra', ean: '',
      preco: 3.5, preco_promocional: null, promocao_inicio: '', promocao_fim: '',
      estoque: 2, custo: 1.8, categoria: 'Limpeza', observacao: '',
      foto: false, ignorar_estoque: false,
    },
    {
      id: '1008', codigo: '1008', descricao: 'Café torrado 500g', ean: '7891000100806',
      preco: 18, preco_promocional: 15, promocao_inicio: '2026-12-01', promocao_fim: '2026-12-31',
      estoque: 1, custo: 11, categoria: 'Mercearia', observacao: '',
      foto: true, ignorar_estoque: false,
    },
  ];
}

function camposTextoSimulado() {
  return ['observacao'];
}

function criarErpSimulado() {
  return {
    modo: 'simulado',
    async listarProdutos() {
      return catalogoSimulado();
    },
    async lerProduto(id) {
      return catalogoSimulado().find((p) => String(p.id) === String(id)) || null;
    },
    async camposTexto() {
      return camposTextoSimulado();
    },
    async gravar() {
      return { ok: false, error: 'No modo simulado a gravação no ERP fica na fila e não altera uma base real.' };
    },
  };
}

function ident(nome) {
  const s = String(nome || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    throw new Error(`Nome inválido no mapeamento do ERP: ${s || '(vazio)'}`);
  }
  return s;
}

function criarErpReal(deps) {
  return {
    modo: 'real',
    async listarProdutos() {
      if (!mapeamento.pronto) {
        throw new Error('Mapeamento do ERP ainda não preenchido. Veja CONEXOES.md e server/ofertas-auto/mapeamento-erp.js.');
      }
      const { withDb, query } = deps;
      const m = mapeamento.produto;
      const sql = `SELECT FIRST 400 ${ident(m.id)} AS ID, ${ident(m.codigo)} AS CODIGO, ${ident(m.descricao)} AS DESCRICAO, ${ident(m.ean)} AS EAN, ${ident(m.preco)} AS PRECO, ${ident(m.preco_promocional)} AS PROMO, ${ident(m.promocao_inicio)} AS PROMO_INI, ${ident(m.promocao_fim)} AS PROMO_FIM, ${ident(m.estoque)} AS ESTOQUE, ${ident(m.custo)} AS CUSTO, ${ident(m.categoria)} AS CATEGORIA FROM ${ident(m.tabela)}`;
      const rows = await withDb((db) => query(db, sql));
      return rows.map((r) => ({
        id: String(r.ID),
        codigo: String(r.CODIGO ?? r.ID),
        descricao: String(r.DESCRICAO || '').trim(),
        ean: String(r.EAN || '').replace(/\D/g, ''),
        preco: Number(r.PRECO || 0),
        preco_promocional: r.PROMO == null ? null : Number(r.PROMO),
        promocao_inicio: String(r.PROMO_INI || '').slice(0, 10),
        promocao_fim: String(r.PROMO_FIM || '').slice(0, 10),
        estoque: Number(r.ESTOQUE || 0),
        custo: Number(r.CUSTO || 0),
        categoria: String(r.CATEGORIA || '').trim(),
        observacao: '',
        foto: false,
        ignorar_estoque: false,
      }));
    },
    async lerProduto(id) {
      const lista = await this.listarProdutos();
      return lista.find((p) => p.id === String(id)) || null;
    },
    async camposTexto() {
      return (mapeamento.produto.campos_texto || []).filter((c) => c && c !== 'TODO');
    },
    async gravar() {
      throw new Error('TODO: gravar pelo ErpConnector real usando a mesma camada do gestor (server/db.js), depois que o mapeamento estiver preenchido.');
    },
  };
}

module.exports = { catalogoSimulado, criarErpSimulado, criarErpReal };
