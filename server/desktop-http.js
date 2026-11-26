'use strict';

/**
 * Baixar aplicativo desktop (O.S). O serviço entrega o instalador que veio junto com ele.
 * /desktop/versao e /desktop/instalador são livres (o app se atualiza sem sessão), mas só na rede
 * da loja: pelo túnel (acesso de fora) não saem.
 */

const fs = require('fs');
const express = require('express');
const desktop = require('./os-desktop');
const { viaTunel } = require('./origem');

const router = express.Router();

function ipDe(req) {
  return String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function soRedeLocal(req, res) {
  if (!viaTunel(req)) return true;
  res.status(403).json({ ok: false, error: 'O aplicativo desktop só é baixado na rede da loja.' });
  return false;
}

/** Endereço que os computadores da loja usam para falar com o serviço. */
function enderecoServidor(req) {
  const host = String(req.headers.host || '');
  if (host && !/^(localhost|127\.)/i.test(host)) return host;
  const porta = host.includes(':') ? host.split(':').pop() : String(require('./index').PORT || 5077);
  const lan = require('./index').lanAddresses?.()[0]?.address;
  return lan ? `${lan}:${porta}` : host;
}

function enviarInstalador(res, nome) {
  const v = desktop.versaoInstalador();
  if (!v) {
    res.status(404).json({ ok: false, error: 'O instalador do aplicativo desktop não veio nesta versão do Gestor.' });
    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(v.tamanho));
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(v.arquivo).pipe(res);
}

router.get('/desktop/info', (req, res) => {
  if (!soRedeLocal(req, res)) return;
  res.json({ ok: true, ...desktop.info(ipDe(req)), servidor: enderecoServidor(req) });
});

router.get('/desktop/baixar', (req, res) => {
  if (!soRedeLocal(req, res)) return;
  enviarInstalador(res, desktop.nomeComServidor(enderecoServidor(req)));
});

router.post('/desktop/presenca', (req, res) => {
  desktop.registrarPresenca(ipDe(req), req.body || {});
  res.json({ ok: true });
});

router.get('/desktop/versao', (req, res) => {
  if (!soRedeLocal(req, res)) return;
  const v = desktop.versaoInstalador();
  res.json({ ok: true, disponivel: !!v, versao: v?.versao || '', data: v?.data || '', tamanho: v?.tamanho || 0 });
});

router.get('/desktop/instalador', (req, res) => {
  if (!soRedeLocal(req, res)) return;
  enviarInstalador(res, 'GestorOS-Setup.exe');
});

module.exports = router;
