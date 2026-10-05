'use strict';
const os = require('os');
const dns = require('dns');

const MSG_SOMENTE_SERVIDOR = 'Configuração de banco e certificado só pode ser feita no computador servidor.';

function clientIp(req) {
  const raw = String(req.socket?.remoteAddress || req.ip || '').trim();
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function serverAddresses() {
  const out = new Set(['127.0.0.1', '::1']);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) out.add(net.address);
  }
  return out;
}

/** Requisição feita no próprio computador do serviço (loopback ou IP de uma das placas dele). */
function isServidorLocal(req) {
  const ip = clientIp(req);
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) return true;
  return serverAddresses().has(ip);
}

function somenteServidorLocal(req, res, next) {
  if (isServidorLocal(req)) return next();
  if (req.method === 'GET' && /\.(html|js|css)$/i.test(req.path)) {
    return res.status(403).type('text/plain; charset=utf-8').send(MSG_SOMENTE_SERVIDOR);
  }
  return res.status(403).json({ ok: false, error: MSG_SOMENTE_SERVIDOR });
}

const hostCache = new Map();
const HOST_TTL_MS = 10 * 60 * 1000;

function lookupHostname(ip) {
  const hit = hostCache.get(ip);
  if (hit && Date.now() - hit.at < HOST_TTL_MS) return Promise.resolve(hit.nome);
  return new Promise((resolve) => {
    let done = false;
    const finish = (nome) => {
      if (done) return;
      done = true;
      hostCache.set(ip, { nome, at: Date.now() });
      resolve(nome);
    };
    const timer = setTimeout(() => finish(''), 1500);
    try {
      dns.lookupService(ip, 0, (err, hostname) => {
        clearTimeout(timer);
        const nome = !err && hostname && hostname !== ip ? String(hostname).split('.')[0] : '';
        finish(nome);
      });
    } catch {
      clearTimeout(timer);
      finish('');
    }
  });
}

/**
 * Origem da alteração para o rótulo "Alterado {origem} dd/mm/aaaa hh:mm:ss":
 * APK / navegador de celular → "Celular"; PC → nome da máquina (fallback: IP).
 */
async function resolveOrigem(req, body = {}) {
  const tipo = String(body.origem || '').trim().toLowerCase();
  const ua = String(req.get?.('user-agent') || '');
  if (tipo === 'celular' || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'Celular';
  if (isServidorLocal(req)) return os.hostname().toUpperCase().slice(0, 40);
  const ip = clientIp(req);
  const nome = await lookupHostname(ip);
  return (nome || ip || 'Navegador').toUpperCase().slice(0, 40);
}

module.exports = {
  MSG_SOMENTE_SERVIDOR,
  clientIp,
  isServidorLocal,
  somenteServidorLocal,
  resolveOrigem,
};
