'use strict';
const express = require('express');
const path = require('path');
const os = require('os');
const routes = require('./routes');
const { PORT } = require('./config');
const { ensureFirebirdClientPath } = require('./nativePath');
const http = require('http');
const { somenteServidorLocal, viaTunel, definirPortaTunel } = require('./origem');
const licenca = require('./licenca');
const tunel = require('./tunel');
const aparelhos = require('./aparelhos');
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
function paginaOnline(titulo, texto) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f9;color:#1a1f26;display:grid;place-items:center;min-height:100vh}
main{max-width:420px;padding:28px;text-align:center}h1{color:#1e3a5f;font-size:22px}p{color:#5a6577;line-height:1.5}
.logo{width:72px;height:72px;border-radius:18px;background:#1e3a5f;color:#fff;font:700 28px system-ui;display:grid;place-items:center;margin:0 auto 16px}</style>
</head><body><main><div class="logo">MT</div><h1>${esc(titulo)}</h1><p>${esc(texto)}</p><p style="font-size:13px">MT Automações · (34) 3674-1937</p></main></body></html>`;
}

/** Pela internet só entram aparelhos pareados pelo QR Code da tela de serviço. */
app.use((req, res, next) => {
  if (!viaTunel(req)) return next();
  res.setHeader('Cache-Control', 'no-store');
  const ap = aparelhos.aparelhoDaRequisicao(req);
  if (req.path === '/parear') {
    if (ap) return res.redirect(302, '/');
    const token = aparelhos.parear(req.query.c, req);
    if (!token) {
      return res.status(403).type('html').send(paginaOnline('QR Code expirado',
        'Este QR Code já foi usado ou expirou. Leia o QR Code atualizado na tela do Gestor Estoque, no computador da loja.'));
    }
    res.setHeader('Set-Cookie', aparelhos.cookieAparelho(token));
    return res.redirect(302, '/');
  }
  if (ap) {
    req.aparelho = ap;
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ ok: false, code: 'APARELHO', error: 'Este aparelho não está autorizado para o acesso online.' });
  }
  return res.status(403).type('html').send(paginaOnline('Aparelho não autorizado',
    'Para usar o Gestor Estoque fora da loja, leia o QR Code de acesso online na tela do Gestor Estoque, no computador da loja. Se este aparelho foi removido, é preciso ler o QR Code de novo.'));
});

app.use(express.json({ limit: '10mb' }));
/** Pela internet não se vê a rede da loja nem se controla o serviço/acesso online. */
const ROTAS_FORA_DO_TUNEL = /^\/api\/(network|qrcode|shutdown|online)(\/|$)/;
app.use((req, res, next) => {
  if (viaTunel(req) && ROTAS_FORA_DO_TUNEL.test(req.path)) {
    return res.status(403).json({ ok: false, error: 'Disponível somente na rede da loja.' });
  }
  next();
});
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
  // Servidor só do túnel online: escuta apenas no loopback, em porta aleatória.
  const servidorTunel = http.createServer(app);
  servidorTunel.listen(0, '127.0.0.1', () => {
    const { port } = servidorTunel.address();
    definirPortaTunel(port);
    tunel.iniciar({ porta: port });
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Porta ${PORT} em uso — assumindo instância já ativa.`);
  } else {
    console.error(err);
  }
});

module.exports = { app, PORT, lanAddresses };
