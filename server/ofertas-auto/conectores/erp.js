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

function dia(v) {
  if (!v) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const bruto = new Date(v.getTime() + 3 * 3600000);
    return bruto.toISOString().slice(0, 10);
  }
  const s = String(v);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return '';
}

function linhaProduto(r, texto) {
  const promo = Number(r.PROMO);
  const inicio = dia(r.PROMO_INI);
  const fim = dia(r.PROMO_FIM);
  const temPromo = promo > 0 && inicio && fim;
  return {
    id: String(r.ID),
    codigo: String(r.CODIGO ?? r.ID),
    descricao: String(r.DESCRICAO || '').trim(),
    ean: String(r.EAN || '').replace(/\D/g, ''),
    preco: Number(r.PRECO || 0),
    preco_promocional: temPromo ? promo : null,
    promocao_inicio: temPromo ? inicio : '',
    promocao_fim: temPromo ? fim : '',
    estoque: Number(r.ESTOQUE || 0),
    custo: Number(r.CUSTO || 0),
    categoria: String(r.CATEGORIA || '').trim(),
    observacao: String(r[texto] || r.DESC_CMPL || '').trim(),
    referencia: String(r.REFERENCIA || '').trim(),
    foto: false,
    ignorar_estoque: false,
  };
}

function sqlLista(mapa, comPromo) {
  const cols = [
    `${ident(mapa.id)} AS ID`,
    `${ident(mapa.codigo)} AS CODIGO`,
    `${ident(mapa.descricao)} AS DESCRICAO`,
    `${ident(mapa.ean)} AS EAN`,
    `${ident(mapa.preco)} AS PRECO`,
    `${ident(mapa.estoque)} AS ESTOQUE`,
    `${ident(mapa.custo)} AS CUSTO`,
    `${ident(mapa.categoria)} AS CATEGORIA`,
    `${ident(mapa.referencia)} AS REFERENCIA`,
    `${ident(mapa.campos_texto[0])} AS DESC_CMPL`,
  ];
  if (comPromo) {
    cols.push(`${ident(mapa.preco_promocional)} AS PROMO`);
    cols.push(`${ident(mapa.promocao_inicio)} AS PROMO_INI`);
    cols.push(`${ident(mapa.promocao_fim)} AS PROMO_FIM`);
  }
  return `SELECT FIRST 400 ${cols.join(', ')} FROM ${ident(mapa.view)} WHERE COALESCE(${ident(mapa.status)}, 'A') = 'A' ORDER BY ${ident(mapa.codigo)} DESC`;
}

function criarErpReal(deps) {
  return {
    modo: 'real',
    async listarProdutos() {
      const { withDb, query, activeTargets } = deps;
      return withDb(async (db, cfg) => {
        const alvos = activeTargets(cfg);
        const soManage = alvos.length === 1 && alvos[0].manage;
        const mapa = soManage ? mapeamento.manage : mapeamento.clipp;
        const rows = await query(db, sqlLista(mapa, soManage));
        const produtos = rows.map((r) => linhaProduto(r, soManage ? 'DESC_CMPL' : 'DESC_CMPL'));
        if (soManage || !alvos.some((a) => a.manage) || !produtos.length) return produtos;
        const m = mapeamento.manage;
        const ids = produtos.map((p) => Number(p.id)).filter((n) => Number.isInteger(n));
        if (!ids.length) return produtos;
        const promoSql = `SELECT ${ident(m.id)} AS ID, ${ident(m.preco_promocional)} AS PROMO, ${ident(m.promocao_inicio)} AS PROMO_INI, ${ident(m.promocao_fim)} AS PROMO_FIM FROM ${ident(m.view)} WHERE ${ident(m.id)} IN (${ids.map(() => '?').join(',')})`;
        const promo = await query(db, promoSql, ids).catch(() => []);
        const porId = new Map(promo.map((r) => [String(r.ID), linhaProduto(r, 'DESC_CMPL')]));
        return produtos.map((p) => {
          const extra = porId.get(p.id);
          if (!extra?.preco_promocional) return p;
          return {
            ...p,
            preco_promocional: extra.preco_promocional,
            promocao_inicio: extra.promocao_inicio,
            promocao_fim: extra.promocao_fim,
          };
        });
      });
    },
    async lerProduto(id) {
      const lista = await this.listarProdutos();
      return lista.find((p) => p.id === String(id)) || null;
    },
    async camposTexto() {
      const { withDb, activeTargets } = deps;
      return withDb(async (_db, cfg) => {
        const alvos = activeTargets(cfg);
        const mapa = alvos.length === 1 && alvos[0].manage ? mapeamento.manage : mapeamento.clipp;
        return mapa.campos_texto;
      });
    },
    async gravar() {
      throw new Error('A gravação no ERP passa pela fila na nuvem. O agente da loja ainda não aplica o item.');
    },
  };
}

module.exports = { catalogoSimulado, criarErpSimulado, criarErpReal };
