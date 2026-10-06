'use strict';
const express = require('express');
const path = require('path');
const os = require('os');
const routes = require('./routes');
const { PORT } = require('./config');
const { ensureFirebirdClientPath } = require('./nativePath');
const { somenteServidorLocal } = require('./origem');
const licenca = require('./licenca');
const auth = require('./auth');
const idempotencia = require('./idempotencia');

ensureFirebirdClientPath();

try {
  require('./importacao-params').ensureImportacaoParamsDefaults();
} catch (err) {
  console.warn('Defaults parâmetros NF-e:', err.message);
}

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(['/servico.html', '/servico.js', '/servico.css'], somenteServidorLocal);
app.use(express.static(path.join(__dirname, '..', 'Painel'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (/\.(html|css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Painel', 'icons', 'favicon.ico'));
});
app.use('/api', licenca.guardLicenca, auth.exigirSessao, idempotencia.middleware, routes);

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'Painel', 'index.html'));
});

function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      out.push({ interface: name, address: net.address });
    }
  }
  return out;
}

function printListenInfo() {
  const host = os.hostname();
  console.log(`Gestor Estoque API`);
  console.log(`  Local:   http://127.0.0.1:${PORT}`);
  console.log(`  Host:    http://${host}:${PORT}`);
  for (const n of lanAddresses()) {
    console.log(`  Rede:    http://${n.address}:${PORT}  (${n.interface})`);
  }
  console.log('Mantenha esta janela aberta. No celular use o IP/hostname da rede + porta.');
}

const server = app.listen(PORT, '0.0.0.0', () => {
  printListenInfo();
  licenca.iniciar();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Porta ${PORT} em uso — assumindo instância já ativa.`);
  } else {
    console.error(err);
  }
});

module.exports = { app, PORT, lanAddresses };
