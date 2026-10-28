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
  return [
    { coluna: 'OBSERVACAO', rotulo: 'Observação' },
    { coluna: 'ID_IDENTIFICADOR', rotulo: 'Identificador' },
    { coluna: 'COD_BARRA', rotulo: 'Código de barras' },
  ];
}

function comTextos(p) {
  return {
    ...p,
    textos: {
      OBSERVACAO: String(p.observacao || ''),
      ID_IDENTIFICADOR: String(p.id || ''),
      COD_BARRA: String(p.ean || ''),
    },
  };
}

function criarErpSimulado() {
  return {
    modo: 'simulado',
    async listarProdutos(filtros = {}) {
      let lista = catalogoSimulado();
      const q = String(filtros.q || '').trim().toLowerCase();
      if (q) {
        lista = lista.filter((p) => [p.descricao, p.codigo, p.ean, p.id].some((v) => String(v || '').toLowerCase().includes(q)));
      }
      if (filtros.grupo) lista = lista.filter((p) => p.categoria === filtros.grupo);
      if (filtros.com) {
        const ignora = new Set((filtros.ignorar || []).map(String));
        lista = lista.filter((p) => Number(p.estoque) > 0 || ignora.has(String(p.id)));
      }
      if (filtros.promo) lista = lista.filter((p) => Number(p.preco_promocional) > 0 && p.promocao_inicio && p.promocao_fim);
      return lista.map(comTextos);
    },
    async grupos() {
      return [...new Set(catalogoSimulado().map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
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
    async vendidos30() {
      return {};
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
  return {
    id: String(r.ID),
    codigo: String(r.CODIGO ?? r.ID),
    descricao: String(r.DESCRICAO || '').trim(),
    ean: String(r.EAN || '').replace(/\D/g, ''),
    preco: Number(r.PRECO || 0),
    preco_promocional: promo > 0 ? promo : null,
    promocao_inicio: inicio,
    promocao_fim: fim,
    estoque: Number(r.ESTOQUE || 0),
    vendido_30d: r.VENDIDO == null ? undefined : Number(r.VENDIDO || 0),
    custo: Number(r.CUSTO || 0),
    categoria: String(r.CATEGORIA || '').trim(),
    observacao: String(r.OBSERVACAO || r[texto] || '').trim(),
    referencia: String(r.REFERENCIA || '').trim(),
    textos: {
      OBSERVACAO: String(r.OBSERVACAO || '').trim(),
      DESC_CMPL: String(r.DESC_CMPL || '').trim(),
      INFCOMPLEMENTAR: String(r.INFCOMPLEMENTAR || '').trim(),
      ADICIONAL1: String(r.ADICIONAL1 || '').trim(),
      ADICIONAL2: String(r.ADICIONAL2 || '').trim(),
      ID_IDENTIFICADOR: String(r.ID ?? ''),
      COD_BARRA: String(r.EAN || '').replace(/\D/g, ''),
    },
    foto: false,
    ignorar_estoque: false,
  };
}

function diaAtras(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sqlVendas(fontes) {
  const partes = (fontes || []).map((f) => `
    SELECT I.${ident(f.produto_id)} AS VID, COALESCE(I.${ident(f.quantidade)}, 0) AS QTD
    FROM ${ident(f.item)} I
    JOIN ${ident(f.nota)} N ON N.${ident(f.nota_id)} = I.${ident(f.nota_id)}
    WHERE N.${ident(f.status)} = 'E' AND N.${ident(f.data)} >= ?`);
  return `LEFT JOIN (
    SELECT VID, SUM(QTD) AS VENDIDO FROM (${partes.join(' UNION ALL ')}) U GROUP BY VID
  ) S ON S.VID = V.ID_IDENTIFICADOR`;
}

function sqlLista(mapa, comPromo, filtros = {}, mapaPromo, fontesVenda = null) {
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
  ];
  const rapido = filtros.rapido === true;
  if (!rapido) {
    if (mapa.observacao === 'OBS') cols.push(`${ident('OBS')} AS OBSERVACAO`);
    else cols.push(`(SELECT FIRST 1 OBSERVACAO FROM TB_ESTOQUE WHERE ID_ESTOQUE = V.ID_ESTOQUE) AS OBSERVACAO`);
    for (const campo of mapa.campos_texto || []) {
      const coluna = typeof campo === 'string' ? campo : campo.coluna;
      if (!coluna || ['OBSERVACAO', 'ID_IDENTIFICADOR', 'COD_BARRA'].includes(coluna)) continue;
      cols.push(`${ident(coluna)} AS ${ident(coluna)}`);
    }
  }
  if (comPromo) {
    cols.push(`${ident(mapa.preco_promocional)} AS PROMO`);
    cols.push(`${ident(mapa.promocao_inicio)} AS PROMO_INI`);
    cols.push(`${ident(mapa.promocao_fim)} AS PROMO_FIM`);
  }
  if (fontesVenda?.length) cols.push('COALESCE(S.VENDIDO, 0) AS VENDIDO');
  const where = [`COALESCE(${ident(mapa.status)}, 'A') = 'A'`];
  const params = [];
  const q = String(filtros.q || '').trim();
  if (q) {
    where.push(`(
      UPPER(${ident(mapa.descricao)}) CONTAINING UPPER(?)
      OR UPPER(COALESCE(${ident(mapa.ean)}, '')) CONTAINING UPPER(?)
      OR CAST(${ident(mapa.codigo)} AS VARCHAR(20)) CONTAINING ?
      OR CAST(${ident(mapa.id)} AS VARCHAR(20)) CONTAINING ?
    )`);
    params.push(q, q, q, q);
  }
  if (filtros.grupo) {
    where.push(`${ident(mapa.categoria)} = ?`);
    params.push(String(filtros.grupo));
  }
  if (filtros.com) {
    const ids = (filtros.ignorar || []).map(Number).filter((n) => Number.isInteger(n)).slice(0, 300);
    if (ids.length) where.push(`(COALESCE(${ident(mapa.estoque)}, 0) > 0 OR ${ident(mapa.id)} IN (${ids.join(',')}))`);
    else where.push(`COALESCE(${ident(mapa.estoque)}, 0) > 0`);
  }
  if (filtros.promo && comPromo) {
    where.push(`COALESCE(${ident(mapa.preco_promocional)}, 0) > 0`);
    where.push(`${ident(mapa.promocao_inicio)} IS NOT NULL`);
    where.push(`${ident(mapa.promocao_fim)} IS NOT NULL`);
  } else if (filtros.promo && mapaPromo) {
    where.push(`${ident(mapa.id)} IN (
      SELECT ${ident(mapaPromo.id)} FROM ${ident(mapaPromo.view)}
      WHERE COALESCE(${ident(mapaPromo.preco_promocional)}, 0) > 0
        AND ${ident(mapaPromo.promocao_inicio)} IS NOT NULL
        AND ${ident(mapaPromo.promocao_fim)} IS NOT NULL
    )`);
  }
  const join = fontesVenda?.length ? sqlVendas(fontesVenda) : '';
  if (fontesVenda?.length) params.unshift(...fontesVenda.map(() => diaAtras(30)));
  if (filtros.id) {
    where.push(`${ident(mapa.id)} = ?`);
    params.push(Number(filtros.id));
  }
  const limite = filtros.id ? 1 : (rapido ? 40 : (fontesVenda?.length ? 300 : 8000));
  let ordem = '';
  if (!rapido && !filtros.id) {
    ordem = fontesVenda?.length
      ? ' ORDER BY COALESCE(S.VENDIDO, 0), V.PROD_SERV'
      : ` ORDER BY ${ident(mapa.codigo)} DESC`;
  }
  const sql = `SELECT FIRST ${limite} ${cols.join(', ')} FROM ${ident(mapa.view)} V ${join} WHERE ${where.join(' AND ')}${ordem}`;
  return { sql, params };
}

function criarErpReal(deps) {
  let cacheVendas = null;
  let cacheVendasEm = 0;
  return {
    modo: 'real',
    async listarProdutos(filtros = {}) {
      const { withDb, query, activeTargets } = deps;
      let totaisMenor = null;
      if (filtros.rapido && filtros.menos) {
        if (!cacheVendas || Date.now() - cacheVendasEm > 10 * 60 * 1000) {
          cacheVendas = await this.vendidos30();
          cacheVendasEm = Date.now();
        }
        totaisMenor = cacheVendas;
      }
      return withDb(async (db, cfg) => {
        const alvos = activeTargets(cfg);
        const soManage = alvos.length === 1 && alvos[0].manage;
        const mapa = soManage ? mapeamento.manage : mapeamento.clipp;
        const temManage = alvos.some((a) => a.manage);
        const fontes = filtros.menos && !filtros.rapido
          ? (soManage ? [mapeamento.vendidos.manage] : (temManage ? [mapeamento.vendidos.clipp, mapeamento.vendidos.manage] : [mapeamento.vendidos.clipp]))
          : null;
        const consulta = sqlLista(mapa, soManage, filtros, temManage && !soManage ? mapeamento.manage : null, fontes);
        const rows = await query(db, consulta.sql, consulta.params);
        let produtos = rows.map((r) => linhaProduto(r, soManage ? 'DESC_CMPL' : 'DESC_CMPL'));
        if (filtros.rapido && filtros.menos) {
          const totais = totaisMenor || {};
          produtos.sort((a, b) => Number(totais[a.id] || 0) - Number(totais[b.id] || 0)
            || a.descricao.localeCompare(b.descricao, 'pt'));
          produtos = produtos.slice(0, 12);
          if (!filtros.promo) return produtos;
        } else if (filtros.rapido && !filtros.promo) return produtos.slice(0, 12);
        produtos = produtos.slice(0, filtros.rapido ? 12 : produtos.length);
        if (soManage || !alvos.some((a) => a.manage) || !produtos.length) return produtos;
        const m = mapeamento.manage;
        const ids = produtos.map((p) => Number(p.id)).filter((n) => Number.isInteger(n));
        if (!ids.length) return produtos;
        const promo = [];
        for (let i = 0; i < ids.length; i += 300) {
          const pedaco = ids.slice(i, i + 300);
          const promoSql = `SELECT ${ident(m.id)} AS ID, ${ident(m.preco_promocional)} AS PROMO, ${ident(m.promocao_inicio)} AS PROMO_INI, ${ident(m.promocao_fim)} AS PROMO_FIM FROM ${ident(m.view)} WHERE ${ident(m.id)} IN (${pedaco.map(() => '?').join(',')})`;
          const parte = await query(db, promoSql, pedaco).catch(() => []);
          promo.push(...parte);
        }
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
    async grupos() {
      const { withDb, query, activeTargets } = deps;
      return withDb(async (db, cfg) => {
        const alvos = activeTargets(cfg);
        const mapa = alvos.length === 1 && alvos[0].manage ? mapeamento.manage : mapeamento.clipp;
        const rows = await query(
          db,
          `SELECT DISTINCT ${ident(mapa.categoria)} AS G FROM ${ident(mapa.view)}
           WHERE COALESCE(${ident(mapa.status)}, 'A') = 'A' AND ${ident(mapa.categoria)} IS NOT NULL`
        );
        return rows.map((r) => String(r.G || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt'));
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
    async vendidos30() {
      const inicio = new Date();
      inicio.setDate(inicio.getDate() - 30);
      const dia = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-${String(inicio.getDate()).padStart(2, '0')}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return {};
      const { withDb, query, activeTargets } = deps;
      return withDb(async (db, cfg) => {
        const fontes = [mapeamento.vendidos.clipp];
        if (activeTargets(cfg).some((a) => a.manage)) fontes.push(mapeamento.vendidos.manage);
        const totais = {};
        for (const f of fontes) {
          const sql = `SELECT I.${ident(f.produto_id)} AS ID, SUM(COALESCE(I.${ident(f.quantidade)}, 0)) AS QTD
            FROM ${ident(f.item)} I
            JOIN ${ident(f.nota)} N ON N.${ident(f.nota_id)} = I.${ident(f.nota_id)}
            WHERE N.${ident(f.status)} = 'E' AND N.${ident(f.data)} >= '${dia}'
            GROUP BY I.${ident(f.produto_id)}`;
          const rows = await query(db, sql).catch(() => []);
          for (const r of rows || []) {
            const id = String(r.ID);
            totais[id] = (totais[id] || 0) + Number(r.QTD || 0);
          }
        }
        return totais;
      });
    },
  };
}

module.exports = { catalogoSimulado, criarErpSimulado, criarErpReal };
