'use strict';
/**
 * Acesso online: conexão de SAÍDA (WebSocket) do computador servidor até o servidor de passagem.
 * Cada requisição recebida é repassada ao servidor HTTP interno do túnel (127.0.0.1:porta aleatória),
 * que o origem.js reconhece como remoto — nada que chega pela internet conta como computador servidor.
 */
const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const WebSocket = require('ws');
const { getAppDataDir } = require('./config');
const licenca = require('./licenca');
const aparelhos = require('./aparelhos');

const RELAY_URL = (process.env.GESTOR_RELAY_URL || 'wss://acesso.smsjrdeveloper.com.br').replace(/\/+$/, '');
const LINK_BASE = RELAY_URL.replace(/^ws/i, 'http');
const PEDACO = 256 * 1024;
const MAX_CORPO = 12 * 1024 * 1024;
const PING_MS = 25 * 1000;
const SEM_PONG_MS = 70 * 1000;
const ESPERA_MIN_MS = 2000;
const ESPERA_MAX_MS = 60 * 1000;
const TIMEOUT_REQ_MS = 85 * 1000;
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'proxy-authorization', 'proxy-authenticate', 'content-length']);

let porta = 0;
let ws = null;
let timerReconexao = null;
let timerPing = null;
let ultimoPong = 0;
let espera = ESPERA_MIN_MS;
const recebendo = new Map();
const emAndamento = new Map();
const estado = { conectado: false, desde: null, ultimo_erro: null };

function arquivoConfig() {
  return path.join(getAppDataDir(), 'online.json');
}

function novoId() {
  const alfabeto = 'abcdefghijklmnopqrstuvwxyz234567';
  return [...crypto.randomBytes(20)].map((b) => alfabeto[b & 31]).join('');
}

let cfgCache = null;
function carregarConfig() {
  if (cfgCache) return cfgCache;
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(arquivoConfig(), 'utf8'));
  } catch { /* primeira vez */ }
  if (!/^[a-z2-7]{20,32}$/.test(String(cfg.tunelId || '')) || String(cfg.segredo || '').length < 32) {
    cfg = { ativo: false, tunelId: novoId(), segredo: crypto.randomBytes(32).toString('base64url') };
    salvarConfig(cfg);
  }
  cfgCache = cfg;
  return cfg;
}

function salvarConfig(cfg) {
  const tmp = `${arquivoConfig()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, arquivoConfig());
  cfgCache = cfg;
}

function status() {
  const cfg = carregarConfig();
  const link = `${LINK_BASE}/t/${cfg.tunelId}`;
  const out = {
    ativo: !!cfg.ativo,
    conectado: estado.conectado,
    desde: estado.desde,
    ultimo_erro: cfg.ativo ? estado.ultimo_erro : null,
    link,
    servidor: LINK_BASE,
    aparelhos: aparelhos.listar(),
    validade: aparelhos.validade(),
  };
  if (cfg.ativo) {
    const p = aparelhos.codigoAtual();
    out.pareamento = { link: `${link}?p=${p.codigo}`, expira_em: p.expira_em };
    out.pedidos = aparelhos.listarPedidos();
  }
  return out;
}

function agendarReconexao() {
  if (timerReconexao || !carregarConfig().ativo) return;
  const ms = espera;
  espera = Math.min(espera * 2, ESPERA_MAX_MS);
  timerReconexao = setTimeout(() => {
    timerReconexao = null;
    conectar();
  }, ms);
  timerReconexao.unref?.();
}

function encerrarConexao() {
  if (timerPing) clearInterval(timerPing);
  timerPing = null;
  if (ws) {
    const w = ws;
    ws = null;
    try { w.terminate(); } catch { /* já fechado */ }
  }
  for (const req of emAndamento.values()) {
    try { req.destroy(); } catch { /* já encerrado */ }
  }
  emAndamento.clear();
  recebendo.clear();
  estado.conectado = false;
  estado.desde = null;
}

const resolverPublico = new dns.Resolver({ timeout: 4000, tries: 1 });
resolverPublico.setServers(['1.1.1.1', '8.8.8.8']);

/** DNS-over-HTTPS na Cloudflare (pelo IP): funciona mesmo com a porta 53 bloqueada para fora. */
function resolverDoh(host) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      host: '1.1.1.1',
      path: `/dns-query?name=${encodeURIComponent(host)}&type=A`,
      headers: { Accept: 'application/dns-json' },
      timeout: 5000,
    }, (res) => {
      let txt = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { txt += c; });
      res.on('end', () => {
        try {
          const ips = (JSON.parse(txt).Answer || []).filter((a) => a.type === 1).map((a) => a.data);
          if (ips.length) resolve(ips);
          else reject(new Error('sem resposta DoH'));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout DoH')));
    req.on('error', reject);
  });
}

/**
 * DNS do Windows/roteador primeiro; se não achar (cache negativo, DNS do provedor instável),
 * resolve o servidor online pelo 1.1.1.1/8.8.8.8 e, por último, por HTTPS.
 */
function lookupResiliente(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  const o = typeof opts === 'number' ? { family: opts } : (opts || {});
  dns.lookup(host, o, (err, address, family) => {
    if (!err) return cb(null, address, family);
    const entregar = (ips) => {
      if (o.all) return cb(null, ips.map((ip) => ({ address: ip, family: 4 })));
      return cb(null, ips[0], 4);
    };
    resolverPublico.resolve4(host, (err2, ips) => {
      if (!err2 && ips && ips.length) return entregar(ips);
      resolverDoh(host).then(entregar, () => cb(err));
    });
  });
}

function enviar(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function conectar() {
  const cfg = carregarConfig();
  if (!cfg.ativo || !porta || ws) return;
  const lic = licenca.licencaAssinada();
  if (!lic) {
    estado.ultimo_erro = 'Licença não liberada neste computador.';
    agendarReconexao();
    return;
  }
  const sock = new WebSocket(`${RELAY_URL}/tunel/conectar`, {
    headers: {
      'X-Tunel-Id': cfg.tunelId,
      Authorization: `Bearer ${cfg.segredo}`,
      'X-Licenca': Buffer.from(JSON.stringify(lic), 'utf8').toString('base64'),
    },
    handshakeTimeout: 15000,
    lookup: lookupResiliente,
    maxPayload: 2 * 1024 * 1024,
    perMessageDeflate: false,
  });
  ws = sock;

  sock.on('unexpected-response', (_req, res) => {
    let txt = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { if (txt.length < 300) txt += c; });
    res.on('end', () => {
      estado.ultimo_erro = `Servidor online recusou a conexão (${res.statusCode}${txt ? `: ${txt.trim()}` : ''}).`;
    });
    if (ws === sock) {
      ws = null;
      agendarReconexao();
    }
    try { sock.terminate(); } catch { /* ignorado */ }
  });

  sock.on('open', () => {
    if (ws !== sock) return;
    estado.conectado = true;
    estado.desde = new Date().toISOString();
    estado.ultimo_erro = null;
    espera = ESPERA_MIN_MS;
    ultimoPong = Date.now();
    timerPing = setInterval(() => {
      if (!licenca.licencaAssinada()) {
        estado.ultimo_erro = 'Licença não liberada neste computador.';
        encerrarConexao();
        agendarReconexao();
        return;
      }
      if (Date.now() - ultimoPong > SEM_PONG_MS) {
        estado.ultimo_erro = 'Conexão com o servidor online parou de responder.';
        encerrarConexao();
        agendarReconexao();
        return;
      }
      try { sock.send('ping'); } catch { /* close cuida */ }
    }, PING_MS);
    timerPing.unref?.();
  });

  sock.on('message', (data, binario) => {
    if (ws !== sock || binario) return;
    const txt = data.toString('utf8');
    if (txt === 'pong') {
      ultimoPong = Date.now();
      return;
    }
    let f;
    try {
      f = JSON.parse(txt);
    } catch {
      return;
    }
    tratarQuadro(f);
  });

  sock.on('close', (code, motivo) => {
    if (ws !== sock) return;
    if (code === 4000) estado.ultimo_erro = 'Outra instalação assumiu este acesso online.';
    else if (estado.conectado) estado.ultimo_erro = `Conexão online caiu (${code}${motivo?.length ? ` ${motivo}` : ''}). Reconectando…`;
    encerrarConexao();
    agendarReconexao();
  });

  sock.on('error', (err) => {
    if (ws !== sock) return;
    estado.ultimo_erro = `Sem conexão com o servidor online (${err.code || err.message}).`;
  });
}

function tratarQuadro(f) {
  const id = String(f?.id || '');
  if (!id) return;
  if (f.t === 'req') {
    const u = String(f.u || '');
    if (!u.startsWith('/') || u.startsWith('//')) {
      enviar({ t: 'res', id, s: 400, h: [], fim: true });
      return;
    }
    const r = { m: String(f.m || 'GET').toUpperCase(), u, h: Array.isArray(f.h) ? f.h : [], partes: [], tamanho: 0 };
    if (f.fim) despachar(id, r);
    else recebendo.set(id, r);
  } else if (f.t === 'req-parte') {
    const r = recebendo.get(id);
    if (!r) return;
    const b = Buffer.from(String(f.d || ''), 'base64');
    r.tamanho += b.length;
    if (r.tamanho > MAX_CORPO) {
      recebendo.delete(id);
      enviar({ t: 'res', id, s: 413, h: [], fim: true });
      return;
    }
    r.partes.push(b);
    if (f.fim) {
      recebendo.delete(id);
      despachar(id, r);
    }
  }
}

function despachar(id, r) {
  const headers = {};
  for (const par of r.h) {
    if (!Array.isArray(par) || par.length < 2) continue;
    const k = String(par[0]).toLowerCase();
    const v = String(par[1]);
    if (HOP.has(k)) continue;
    if (k === 'x-gestor-ip-remoto') headers[k] = v;
    else if (headers[k] != null) headers[k] += k === 'cookie' ? `; ${v}` : `, ${v}`;
    else headers[k] = v;
  }
  const corpo = Buffer.concat(r.partes);
  if (corpo.length || !['GET', 'HEAD'].includes(r.m)) headers['content-length'] = String(corpo.length);

  const req = http.request({ host: '127.0.0.1', port: porta, method: r.m, path: r.u, headers, timeout: TIMEOUT_REQ_MS }, (res) => {
    const h = [];
    for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
      if (!HOP.has(res.rawHeaders[i].toLowerCase())) h.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
    }
    enviar({ t: 'res', id, s: res.statusCode, h, fim: false });
    let buf = [];
    let tam = 0;
    const descarregar = (fim) => {
      const b = Buffer.concat(buf);
      buf = [];
      tam = 0;
      enviar({ t: 'res-parte', id, d: b.toString('base64'), fim });
    };
    res.on('data', (c) => {
      buf.push(c);
      tam += c.length;
      while (tam >= PEDACO) {
        const b = Buffer.concat(buf);
        enviar({ t: 'res-parte', id, d: b.subarray(0, PEDACO).toString('base64'), fim: false });
        const resto = b.subarray(PEDACO);
        buf = resto.length ? [resto] : [];
        tam = resto.length;
      }
    });
    res.on('end', () => {
      emAndamento.delete(id);
      descarregar(true);
    });
    res.on('error', () => {
      emAndamento.delete(id);
      descarregar(true);
    });
  });
  emAndamento.set(id, req);
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', () => {
    if (!emAndamento.has(id)) return;
    emAndamento.delete(id);
    enviar({ t: 'res', id, s: 502, h: [['content-type', 'text/plain; charset=utf-8']], fim: false });
    enviar({ t: 'res-parte', id, d: Buffer.from('Falha ao processar no computador da loja.').toString('base64'), fim: true });
  });
  req.end(corpo.length ? corpo : undefined);
}

/** Liga ou desliga o acesso online (só pela tela de serviço do computador servidor). */
function definirAtivo(ativo) {
  const cfg = { ...carregarConfig(), ativo: !!ativo };
  salvarConfig(cfg);
  if (timerReconexao) clearTimeout(timerReconexao);
  timerReconexao = null;
  espera = ESPERA_MIN_MS;
  encerrarConexao();
  estado.ultimo_erro = null;
  if (cfg.ativo) conectar();
  return status();
}

/** Gera novo endereço/segredo: link, QR Codes e aparelhos autorizados antigos deixam de funcionar. */
function novoEndereco() {
  const atual = carregarConfig();
  aparelhos.revogarTodos();
  salvarConfig({ ativo: atual.ativo, tunelId: novoId(), segredo: crypto.randomBytes(32).toString('base64url') });
  return definirAtivo(atual.ativo);
}

function iniciar({ porta: p }) {
  porta = Number(p) || 0;
  if (carregarConfig().ativo) conectar();
}

module.exports = {
  RELAY_URL,
  iniciar,
  status,
  definirAtivo,
  novoEndereco,
};
