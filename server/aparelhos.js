'use strict';
/**
 * Aparelhos autorizados no acesso online.
 * O QR Code da tela de serviço leva um código de pareamento de uso único (expira em 10 min);
 * o aparelho que o lê recebe um cookie próprio. Pela internet, sem aparelho autorizado não se vê
 * nem a tela de login. Revogar um aparelho bloqueia na hora todas as requisições dele.
 * Cada aparelho vale até expira_em (validade escolhida na tela de serviço); vencido é removido.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./config');

const COOKIE = 'gestor_aparelho';
const CODIGO_MS = 10 * 60 * 1000;
/** O cookie dura o máximo aceito pelos navegadores; quem manda no vencimento é o expira_em do servidor. */
const COOKIE_S = 400 * 24 * 60 * 60;
const DIA_MS = 24 * 60 * 60 * 1000;
const VALIDADES_DIAS = [1, 7, 15, 30, 60, 90, 180, 365];
const VALIDADE_PADRAO_DIAS = 30;
const GRAVAR_USO_MS = 60 * 1000;
const MAX_APARELHOS = 50;

let lista = null;
let validadeDias = VALIDADE_PADRAO_DIAS;
let codigo = null;
let gravacaoPendente = null;

function arquivo() {
  return path.join(getAppDataDir(), 'online-aparelhos.json');
}

function hash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function venceEm() {
  return new Date(Date.now() + validadeDias * DIA_MS).toISOString();
}

function vencido(ap, agora = Date.now()) {
  const t = new Date(ap.expira_em).getTime();
  return !Number.isFinite(t) || agora >= t;
}

function carregar() {
  if (lista) return lista;
  let migrou = false;
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    lista = Array.isArray(dados.aparelhos) ? dados.aparelhos : [];
    const d = Number(dados.validade_dias);
    validadeDias = VALIDADES_DIAS.includes(d) ? d : VALIDADE_PADRAO_DIAS;
  } catch {
    lista = [];
  }
  for (const ap of lista) {
    if (!ap.expira_em) {
      ap.expira_em = venceEm();
      migrou = true;
    }
  }
  if (migrou) {
    try { salvar(); } catch { /* grava na próxima alteração */ }
  }
  return lista;
}

function salvar() {
  if (gravacaoPendente) {
    clearTimeout(gravacaoPendente);
    gravacaoPendente = null;
  }
  const tmp = `${arquivo()}.tmp`;
  const dados = { validade_dias: validadeDias, aparelhos: carregar() };
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, arquivo());
}

/** Remove os vencidos; devolve true se removeu algum. */
function limparVencidos() {
  const agora = Date.now();
  const antes = carregar().length;
  lista = carregar().filter((a) => !vencido(a, agora));
  if (lista.length === antes) return false;
  salvar();
  return true;
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

function lerCookieNome(req, nomeCookie) {
  const raw = String(req.headers.cookie || '');
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i <= 0 || parte.slice(0, i).trim() !== nomeCookie) continue;
    try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch { return ''; }
  }
  return '';
}

function lerCookie(req) {
  return lerCookieNome(req, COOKIE);
}

function ipRemoto(req) {
  return String(req.headers['x-gestor-ip-remoto'] || '').slice(0, 64);
}

function criarAparelho({ nome, ip, navegador }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const agora = new Date().toISOString();
  const itens = carregar();
  itens.push({
    id: crypto.randomBytes(8).toString('hex'),
    nome: nome || nomePeloNavegador(navegador),
    hash: hash(token),
    criado_em: agora,
    ultimo_uso: agora,
    expira_em: venceEm(),
    ip,
    navegador,
  });
  while (itens.length > MAX_APARELHOS) itens.shift();
  salvar();
  return token;
}

/** Troca o código do QR por um aparelho autorizado; devolve o token do cookie ou null. */
function parear(valor, req) {
  const v = String(valor || '');
  if (!codigo || Date.now() > codigo.expira || v.length !== codigo.valor.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(v), Buffer.from(codigo.valor))) return null;
  codigo = null;
  return criarAparelho({
    ip: ipRemoto(req),
    navegador: String(req.headers['user-agent'] || '').slice(0, 300),
  });
}

/*
 * Pedidos de acesso (aparelho sem câmera): o aparelho pede pela internet e mostra um código curto;
 * quem está no computador da loja confere o código e autoriza na tela de serviço.
 * Ficam só em memória, expiram em 15 min e têm limite por IP e no total.
 */
const PEDIDO_COOKIE = 'gestor_pedido';
const PEDIDO_MS = 15 * 60 * 1000;
const MAX_PEDIDOS = 10;
const MAX_PEDIDOS_POR_IP = 3;
const pedidos = new Map();

function limparPedidos() {
  const agora = Date.now();
  for (const [h, p] of pedidos) {
    if (agora > p.expira) pedidos.delete(h);
  }
}

function pedidoDaRequisicao(req) {
  limparPedidos();
  const token = lerCookieNome(req, PEDIDO_COOKIE);
  if (!token || token.length < 32) return null;
  const h = hash(token);
  const p = pedidos.get(h);
  return p ? { h, p } : null;
}

function codigoCurto() {
  const n = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  return `${n.slice(0, 3)}-${n.slice(3)}`;
}

/** Cria um pedido de acesso; devolve { token, codigo } ou { erro }. */
function solicitar(req, nome) {
  limparPedidos();
  const nomeLimpo = String(nome || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  const atual = pedidoDaRequisicao(req);
  if (atual && atual.p.status === 'pendente') {
    if (nomeLimpo) atual.p.nome = nomeLimpo;
    return { token: null, codigo: atual.p.codigo };
  }
  const ip = ipRemoto(req);
  const doIp = [...pedidos.values()].filter((p) => p.ip === ip && p.status === 'pendente').length;
  if (doIp >= MAX_PEDIDOS_POR_IP) return { erro: 'Muitos pedidos deste endereço. Aguarde alguns minutos.' };
  if (pedidos.size >= MAX_PEDIDOS) return { erro: 'Muitos pedidos aguardando. Tente de novo mais tarde.' };
  const token = crypto.randomBytes(32).toString('base64url');
  const navegador = String(req.headers['user-agent'] || '').slice(0, 300);
  const p = {
    id: crypto.randomBytes(8).toString('hex'),
    codigo: codigoCurto(),
    nome: nomeLimpo || nomePeloNavegador(navegador),
    ip,
    navegador,
    criado_em: new Date().toISOString(),
    expira: Date.now() + PEDIDO_MS,
    status: 'pendente',
  };
  pedidos.set(hash(token), p);
  return { token, codigo: p.codigo };
}

/**
 * Situação do pedido deste aparelho. Se foi autorizado, cria o aparelho e devolve o token do
 * cookie (uma vez só; o pedido é apagado).
 */
function situacaoPedido(req) {
  const atual = pedidoDaRequisicao(req);
  if (!atual) return { status: 'nenhum' };
  const { h, p } = atual;
  if (p.status === 'aprovado') {
    pedidos.delete(h);
    return { status: 'aprovado', token: criarAparelho({ nome: p.nome, ip: ipRemoto(req) || p.ip, navegador: p.navegador }) };
  }
  if (p.status === 'recusado') {
    pedidos.delete(h);
    return { status: 'recusado' };
  }
  return { status: 'pendente', codigo: p.codigo, expira_em: new Date(p.expira).toISOString() };
}

function listarPedidos() {
  limparPedidos();
  return [...pedidos.values()]
    .filter((p) => p.status === 'pendente')
    .map(({ id, codigo: c, nome, ip, criado_em }) => ({ id, codigo: c, nome, ip, criado_em }))
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
}

function decidirPedido(id, aprovar) {
  limparPedidos();
  for (const p of pedidos.values()) {
    if (p.id === String(id) && p.status === 'pendente') {
      p.status = aprovar ? 'aprovado' : 'recusado';
      p.expira = Date.now() + PEDIDO_MS;
      return true;
    }
  }
  return false;
}

function cookiePedido(token, maxAgeS = PEDIDO_MS / 1000) {
  return `${PEDIDO_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeS}; HttpOnly; Secure; SameSite=Lax`;
}

function aparelhoDaRequisicao(req) {
  const token = lerCookie(req);
  if (!token || token.length < 32) return null;
  const h = hash(token);
  const ap = carregar().find((a) => a.hash === h);
  if (!ap) return null;
  const agora = Date.now();
  if (vencido(ap, agora)) {
    limparVencidos();
    return null;
  }
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

function cookieAparelho(token, maxAgeS = COOKIE_S) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeS}; HttpOnly; Secure; SameSite=Lax`;
}

function listar() {
  limparVencidos();
  return carregar()
    .map(({ id, nome, criado_em, ultimo_uso, expira_em, ip }) => ({ id, nome, criado_em, ultimo_uso, expira_em, ip }))
    .sort((a, b) => String(b.ultimo_uso).localeCompare(String(a.ultimo_uso)));
}

/** Validade aplicada a quem for autorizado ou renovado daqui em diante. */
function validade() {
  carregar();
  return { dias: validadeDias, opcoes: VALIDADES_DIAS };
}

function definirValidade(dias) {
  const d = Number(dias);
  if (!VALIDADES_DIAS.includes(d)) return false;
  carregar();
  validadeDias = d;
  salvar();
  return true;
}

function renovar(id) {
  const ap = carregar().find((a) => a.id === String(id));
  if (!ap || vencido(ap)) return false;
  ap.expira_em = venceEm();
  salvar();
  return true;
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
  pedidos.clear();
  salvar();
}

module.exports = {
  COOKIE,
  codigoAtual,
  parear,
  solicitar,
  situacaoPedido,
  listarPedidos,
  decidirPedido,
  cookiePedido,
  aparelhoDaRequisicao,
  cookieAparelho,
  listar,
  validade,
  definirValidade,
  renovar,
  revogar,
  renomear,
  revogarTodos,
};
