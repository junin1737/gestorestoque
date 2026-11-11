'use strict';

const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./config');

const DIAS_PADRAO = 30;

function arquivo() {
  return path.join(getAppDataDir(), 'dispositivos.json');
}

function ler() {
  try {
    const data = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    return Array.isArray(data.itens) ? data : { itens: [] };
  } catch {
    return { itens: [] };
  }
}

function gravar(data) {
  const p = arquivo();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function agora() {
  return new Date().toISOString();
}

function expiraEm(dias, desde = new Date()) {
  const n = Math.max(1, Math.min(3650, Number(dias) || DIAS_PADRAO));
  return new Date(desde.getTime() + n * 86400000).toISOString();
}

function nomeLimpo(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
}

function nomePadrao(nome) {
  return !nomeLimpo(nome) || /^dispositivo$/i.test(nomeLimpo(nome));
}

function lerNome(v) {
  const bruto = String(v || '').trim();
  if (!bruto) return '';
  try { return nomeLimpo(decodeURIComponent(bruto)); } catch { return nomeLimpo(bruto); }
}

function origemNavegador(ua) {
  const s = String(ua || '');
  if (/iPhone/i.test(s)) return 'iPhone';
  if (/iPad/i.test(s)) return 'iPad';
  if (/Android/i.test(s)) return /; wv\)/.test(s) ? 'App Android' : 'Android';
  let app = 'Navegador';
  if (/Cursor/i.test(s)) app = 'Cursor';
  else if (/Edg\//i.test(s)) app = 'Edge';
  else if (/Firefox/i.test(s)) app = 'Firefox';
  else if (/Chrome\//i.test(s)) app = 'Chrome';
  else if (/Safari/i.test(s)) app = 'Safari';
  if (/Windows/i.test(s)) return `${app} no Windows`;
  if (/Macintosh|Mac OS X/i.test(s)) return `${app} no Mac`;
  return app;
}

function publico(d) {
  const exp = d.expira_em ? new Date(d.expira_em).getTime() : 0;
  const vencido = !!(exp && exp < Date.now());
  return {
    id: d.id,
    nome: nomeLimpo(d.nome) || 'Dispositivo',
    dias: Number(d.dias || DIAS_PADRAO),
    liberado_em: d.liberado_em || null,
    expira_em: d.expira_em || null,
    ultimo_acesso: d.ultimo_acesso || null,
    user_agent: d.user_agent || '',
    origem: origemNavegador(d.user_agent),
    vencido,
  };
}

function listar() {
  return ler().itens.map(publico).sort((a, b) => String(b.ultimo_acesso || '').localeCompare(String(a.ultimo_acesso || '')));
}

function registrar(id, extra = {}) {
  const key = String(id || '').trim().slice(0, 80);
  if (!key) return { ok: true, ignorado: true };
  const data = ler();
  let item = data.itens.find((d) => d.id === key);
  const informado = lerNome(extra.nome);
  if (!item) {
    item = {
      id: key,
      nome: informado || 'Dispositivo',
      dias: DIAS_PADRAO,
      liberado_em: agora(),
      expira_em: expiraEm(DIAS_PADRAO),
      user_agent: String(extra.userAgent || '').slice(0, 180),
    };
    data.itens.push(item);
  } else if (informado && !nomePadrao(informado) && nomePadrao(item.nome)) {
    item.nome = informado;
  }
  item.ultimo_acesso = agora();
  if (extra.userAgent) item.user_agent = String(extra.userAgent).slice(0, 180);
  gravar(data);
  const pub = publico(item);
  return { ok: !pub.vencido, dispositivo: pub, vencido: pub.vencido };
}

function renomear(id, nome) {
  const data = ler();
  const item = data.itens.find((d) => d.id === String(id || ''));
  if (!item) return null;
  item.nome = nomeLimpo(nome) || item.nome;
  gravar(data);
  return publico(item);
}

function definirDias(id, dias) {
  const data = ler();
  const item = data.itens.find((d) => d.id === String(id || ''));
  if (!item) return null;
  item.dias = Math.max(1, Math.min(3650, Number(dias) || DIAS_PADRAO));
  item.liberado_em = agora();
  item.expira_em = expiraEm(item.dias);
  gravar(data);
  return publico(item);
}

module.exports = {
  listar,
  registrar,
  renomear,
  definirDias,
};
