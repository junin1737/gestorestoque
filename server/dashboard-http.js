'use strict';

const express = require('express');
const { withDb, query } = require('./db');
const { lerUsaManage, perfisDashboard } = require('./config');
const { consultarDashboard, detalharDashboard } = require('./dashboard-dados');
const { excelContador, pdfContador } = require('./dashboard-export');

const router = express.Router();

function filtrosDe(req) {
  return {
    inicio: req.query.inicio || '',
    fim: req.query.fim || '',
    grupoId: req.query.grupoId || '',
    tipoItem: req.query.tipoItem || '',
    ncm: req.query.ncm || '',
    modelo: req.query.modelo || '',
    aba: req.query.aba || '',
  };
}

function acessoDashboard(req) {
  const permitidos = perfisDashboard(req.usuario);
  const pedido = String(req.query.perfil || '').trim().toUpperCase();
  if (!permitidos.length) return { status: 403, error: 'Sem permissão para o dashboard.' };
  if (pedido && !permitidos.includes(pedido)) return { status: 403, error: 'Sem permissão para este dashboard.' };
  return { perfil: pedido || permitidos[0], permitidos };
}

router.get('/dashboard', async (req, res) => {
  const acesso = acessoDashboard(req);
  if (acesso.status) return res.status(acesso.status).json({ ok: false, error: acesso.error });
  try {
    const dados = await withDb((db, appCfg) => consultarDashboard(db, {
      ...filtrosDe(req),
      perfil: acesso.perfil,
      usaManage: lerUsaManage(appCfg),
      appCfg,
    }));
    res.json({ ok: true, perfis: acesso.permitidos, ...dados });
  } catch (err) {
    const status = /inválid|anterior/i.test(err.message || '') ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message || 'Falha ao consultar o dashboard.' });
  }
});

router.get('/dashboard/exportar', async (req, res) => {
  const acesso = acessoDashboard(req);
  if (acesso.status) return res.status(acesso.status).json({ ok: false, error: acesso.error });
  if (acesso.perfil !== 'CONTADOR_ACESSA') {
    return res.status(403).json({ ok: false, error: 'Exportação disponível só no dashboard do contador.' });
  }
  const formato = String(req.query.formato || '').toLowerCase();
  if (formato !== 'pdf' && formato !== 'xlsx') {
    return res.status(400).json({ ok: false, error: 'Formato inválido.' });
  }
  try {
    const pack = await withDb(async (db, appCfg) => {
      const opcoes = {
        ...filtrosDe(req),
        perfil: 'CONTADOR_ACESSA',
        usaManage: lerUsaManage(appCfg),
        appCfg,
      };
      const dados = await consultarDashboard(db, opcoes);
      const detalhe = await detalharDashboard(db, opcoes);
      const emit = await query(db, 'SELECT FIRST 1 NOME_FANTA, NOME FROM TB_EMITENTE');
      const e = emit[0] || {};
      return { dados, detalhe, empresa: String(e.NOME_FANTA || e.NOME || '').trim() };
    });
    const meta = {
      empresa: pack.empresa,
      usuario: req.usuario?.nome || '',
      geradoEm: new Date().toLocaleString('pt-BR'),
      filtros: filtrosDe(req),
    };
    if (formato === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="contador.pdf"');
      return res.send(pdfContador(pack.dados, meta));
    }
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contador.xls"');
    return res.send(excelContador(pack.dados, pack.detalhe, meta));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Falha ao exportar.' });
  }
});

module.exports = router;
