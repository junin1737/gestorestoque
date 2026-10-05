'use strict';
/**
 * Aparelhos autorizados no acesso online.
 * O QR Code da tela de serviço leva um código de pareamento de uso único (expira em 10 min);
 * o aparelho que o lê recebe um cookie próprio. Pela internet, sem aparelho autorizado não se vê
 * nem a tela de login. Revogar um aparelho bloqueia na hora todas as requisições dele.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./config');

const COOKIE = 'gestor_aparelho';
const CODIGO_MS = 10 * 60 * 1000;
const VALIDADE_S = 365 * 24 * 60 * 60;
const GRAVAR_USO_MS = 60 * 1000;
const MAX_APARELHOS = 50;

let lista = null;
let codigo = null;
let gravacaoPendente = null;

function arquivo() {
  return path.join(getAppDataDir(), 'online-aparelhos.json');
}

function hash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function carregar() {
  if (lista) return lista;
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    lista = Array.isArray(dados.aparelhos) ? dados.aparelhos : [];
  } catch {
    lista = [];
  }
  return lista;
}

function salvar() {
  if (gravacaoPendente) {
    clearTimeout(gravacaoPendente);
    gravacaoPendente = null;
  }
  const tmp = `${arquivo()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ aparelhos: carregar() }, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, arquivo());
}

function nomePeloNavegador(ua) {
  const s = String(ua || '');
  if (/iPhone/i.test(s)) return 'iPhone';
  if (/iPad/i.test(s)) return 'iPad';
  if (/Android/i.test(s)) return /; wv\)/.test(s) ? 'App Android' : 'Android (navegador)';
  if (/Windows/i.test(s)) return 'Computador Windows';
  if (/Macintosh|Mac OS X/i.test(s)) return 'Mac';
  return 'Navegador';
}

/** Código de pareamento vigente (renova ao expirar ou depois de usado). */
function codigoAtual() {
  if (!codigo || Date.now() > codigo.expira) {
    codigo = { valor: crypto.randomBytes(18).toString('base64url'), expira: Date.now() + CODIGO_MS };
  }
  return { codigo: codigo.valor, expira_em: new Date(codigo.expira).toISOString() };
}

function lerCookie(req) {
  const raw = String(req.headers.cookie || '');
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === COOKIE) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return '';
}

function ipRemoto(req) {
  return String(req.headers['x-gestor-ip-remoto'] || '').slice(0, 64);
}

/** Troca o código do QR por um aparelho autorizado; devolve o token do cookie ou null. */
function parear(valor, req) {
  const v = String(valor || '');
  if (!codigo || Date.now() > codigo.expira || v.length !== codigo.valor.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(v), Buffer.from(codigo.valor))) return null;
  codigo = null;
  const token = crypto.randomBytes(32).toString('base64url');
  const agora = new Date().toISOString();
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const itens = carregar();
  itens.push({
    id: crypto.randomBytes(8).toString('hex'),
    nome: nomePeloNavegador(ua),
    hash: hash(token),
    criado_em: agora,
    ultimo_uso: agora,
    ip: ipRemoto(req),
    navegador: ua,
  });
  while (itens.length > MAX_APARELHOS) itens.shift();
  salvar();
  return token;
}

function aparelhoDaRequisicao(req) {
  const token = lerCookie(req);
  if (!token || token.length < 32) return null;
  const h = hash(token);
  const ap = carregar().find((a) => a.hash === h);
  if (!ap) return null;
  const agora = Date.now();
  if (agora - new Date(ap.ultimo_uso).getTime() > GRAVAR_USO_MS) {
    ap.ultimo_uso = new Date(agora).toISOString();
    ap.ip = ipRemoto(req) || ap.ip;
    if (!gravacaoPendente) {
      gravacaoPendente = setTimeout(() => {
        gravacaoPendente = null;
        try { salvar(); } catch { /* tenta na próxima */ }
      }, 2000);
      gravacaoPendente.unref?.();
    }
  }
  return ap;
}

function cookieAparelho(token, maxAgeS = VALIDADE_S) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeS}; HttpOnly; Secure; SameSite=Lax`;
}

function listar() {
  return carregar()
    .map(({ id, nome, criado_em, ultimo_uso, ip }) => ({ id, nome, criado_em, ultimo_uso, ip }))
    .sort((a, b) => String(b.ultimo_uso).localeCompare(String(a.ultimo_uso)));
}

function revogar(id) {
  const antes = carregar().length;
  lista = carregar().filter((a) => a.id !== String(id));
  if (lista.length !== antes) salvar();
  return lista.length !== antes;
}

function renomear(id, nome) {
  const ap = carregar().find((a) => a.id === String(id));
  const n = String(nome || '').trim().slice(0, 40);
  if (!ap || !n) return false;
  ap.nome = n;
  salvar();
  return true;
}

function revogarTodos() {
  lista = [];
  codigo = null;
  salvar();
}

module.exports = {
  COOKIE,
  codigoAtual,
  parear,
  aparelhoDaRequisicao,
  cookieAparelho,
  listar,
  revogar,
  renomear,
  revogarTodos,
};
