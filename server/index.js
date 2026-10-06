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
function paginaOnline(titulo, texto, extra = '') {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title>
<link rel="icon" href="/icons/favicon.ico"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f9;color:#1a1f26;display:grid;place-items:center;min-height:100vh}
main{max-width:420px;padding:28px;text-align:center}h1{color:#1e3a5f;font-size:22px}p{color:#5a6577;line-height:1.5}
.logo{display:block;width:88px;height:88px;margin:0 auto 16px}
.pedido{margin:22px 0 8px;padding:18px;border-radius:14px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.pedido input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #c9d1dc;border-radius:8px;font-size:15px;margin:6px 0 12px}
.pedido button{width:100%;padding:11px;border:0;border-radius:8px;background:#1e3a5f;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.pedido button:disabled{opacity:.6;cursor:default}.codigo{font:700 34px ui-monospace,Consolas,monospace;letter-spacing:3px;color:#1e3a5f;margin:6px 0}
.pedido label{display:block;text-align:left;font-size:13px;color:#5a6577}.erro{color:#b42318}</style>
</head><body><main><img class="logo" src="/icons/icon-192.png" alt="MT Automações"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p>${extra}<p style="font-size:13px">MT Automações · (34) 3674-1937</p></main></body></html>`;
}

const PEDIDO_HTML = `<div class="pedido" id="pedido">
<div id="pd-form"><label for="pd-nome">Sem câmera? Peça a autorização no computador da loja.<br>Nome deste aparelho</label>
<input id="pd-nome" maxlength="40" placeholder="Ex.: Notebook do João">
<button id="pd-btn" type="button">Solicitar acesso</button></div>
<div id="pd-espera" hidden><div>Código do pedido</div><div class="codigo" id="pd-codigo"></div>
<div>No computador da loja, abra o Gestor Estoque Online (tela de serviço) e clique em <b>Autorizar</b> no pedido com este código.</div></div>
<p class="erro" id="pd-erro" hidden></p></div>
<script>
(function(){
  var $=function(id){return document.getElementById(id)};
  var timer=null;
  function erro(t){var e=$('pd-erro');e.textContent=t||'';e.hidden=!t}
  function esperando(codigo){$('pd-form').hidden=true;$('pd-espera').hidden=false;$('pd-codigo').textContent=codigo;
    if(!timer)timer=setInterval(verificar,3000)}
  function formulario(){$('pd-form').hidden=false;$('pd-espera').hidden=true;$('pd-btn').disabled=false;
    if(timer){clearInterval(timer);timer=null}}
  function verificar(){fetch('/parear/status',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(d){
    if(d.status==='aprovado'){location.replace('/');return}
    if(d.status==='pendente'){esperando(d.codigo);return}
    if(d.status==='recusado'){formulario();erro('O pedido foi recusado no computador da loja.');return}
    if(timer){formulario();erro('O pedido expirou. Solicite de novo.')}
  }).catch(function(){})}
  $('pd-btn').addEventListener('click',function(){erro('');$('pd-btn').disabled=true;
    fetch('/parear/solicitar',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:$('pd-nome').value})})
    .then(function(r){return r.json()}).then(function(d){if(d.ok)esperando(d.codigo);else{formulario();erro(d.error||'Não foi possível solicitar.')}})
    .catch(function(){formulario();erro('Sem conexão com a loja. Tente de novo.')})});
  verificar();
})();
</script>`;

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
  if (req.path === '/parear/solicitar') {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método inválido.' });
    if (ap) return res.json({ ok: false, error: 'Este aparelho já está autorizado.' });
    return express.json({ limit: '2kb' })(req, res, (err) => {
      if (err) return res.status(400).json({ ok: false, error: 'Pedido inválido.' });
      const r = aparelhos.solicitar(req, req.body?.nome);
      if (r.erro) return res.status(429).json({ ok: false, error: r.erro });
      if (r.token) res.setHeader('Set-Cookie', aparelhos.cookiePedido(r.token));
      return res.json({ ok: true, codigo: r.codigo });
    });
  }
  if (req.path === '/parear/status') {
    if (ap) return res.json({ status: 'aprovado' });
    const s = aparelhos.situacaoPedido(req);
    if (s.status === 'aprovado') {
      res.setHeader('Set-Cookie', [aparelhos.cookieAparelho(s.token), aparelhos.cookiePedido('', 0)]);
      return res.json({ status: 'aprovado' });
    }
    if (s.status === 'recusado') res.setHeader('Set-Cookie', aparelhos.cookiePedido('', 0));
    return res.json({ status: s.status, codigo: s.codigo, expira_em: s.expira_em });
  }
  if (ap) {
    req.aparelho = ap;
    return next();
  }
  // Ícones são públicos: aparecem na tela de pareamento e ao salvar na tela inicial.
  if (req.method === 'GET' && /^\/(icons\/[a-z0-9-]+\.(png|ico)|favicon\.ico|manifest\.webmanifest)$/.test(req.path)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ ok: false, code: 'APARELHO', error: 'Este aparelho não está autorizado para o acesso online.' });
  }
  return res.status(403).type('html').send(paginaOnline('Aparelho não autorizado',
    'Para usar o Gestor Estoque fora da loja, leia o QR Code de acesso online na tela do Gestor Estoque, no computador da loja. Se este aparelho foi removido ou a autorização venceu, é preciso ler o QR Code de novo (ou solicitar acesso abaixo).',
    PEDIDO_HTML));
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
  // Servidor só do túnel online: escuta apenas no loopback, em porta aleatória.
  const servidorTunel = http.createServer(app);
  servidorTunel.listen(0, '127.0.0.1', () => {
    const { port } = servidorTunel.address();
    definirPortaTunel(port);
    tunel.iniciar({ porta: port });
  });
  try {
    require('./compras-dfe').iniciar();
  } catch (err) {
    console.warn('Consultar compras:', err.message);
  }
  setTimeout(() => {
    require('./importacao-gravar').corrigirTransportadoresNf()
      .then((n) => { if (n) console.log(`Transportador corrigido em ${n} nota(s) de compra importada(s).`); })
      .catch((err) => console.warn('Correção de transportadores:', err.message));
  }, 15000).unref();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Porta ${PORT} em uso — assumindo instância já ativa.`);
  } else {
    console.error(err);
  }
});

module.exports = { app, PORT, lanAddresses };
