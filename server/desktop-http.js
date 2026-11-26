'use strict';

/**
 * Baixar aplicativo desktop (O.S). O serviço entrega o instalador que veio junto com ele.
 * Quem está logado baixa pelo acesso online ou pela rede da loja. O arquivo já sai com o
 * endereço da loja, para o aplicativo falar com o servidor na rede local.
 * /desktop/versao e /desktop/instalador continuam livres (o app se atualiza sem sessão) e só
 * na rede da loja.
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

/** Endereço que os computadores da loja usam para falar com o serviço. Pelo túnel, o host é o
 * domínio público; o instalador precisa do IP da loja. */
function enderecoServidor(req) {
  const host = String(req.headers.host || '');
  const portaLocal = String(require('./index').PORT || 5077);
  const lan = require('./index').lanAddresses?.()[0]?.address;
  if (viaTunel(req)) return lan ? `${lan}:${portaLocal}` : host;
  const nome = host.split(':')[0];
  if (nome && !/^(localhost|127\.)/i.test(nome)) return host;
  const porta = host.includes(':') ? host.split(':').pop() : portaLocal;
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
  res.json({
    ok: true,
    ...desktop.info(ipDe(req)),
    servidor: enderecoServidor(req),
    acesso: viaTunel(req) ? 'online' : 'local',
  });
});

router.get('/desktop/baixar', (req, res) => {
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
