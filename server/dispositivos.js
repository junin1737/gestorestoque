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

function publico(d) {
  const exp = d.expira_em ? new Date(d.expira_em).getTime() : 0;
  const vencido = !!(exp && exp < Date.now());
  return {
    id: d.id,
    nome: d.nome || 'Dispositivo',
    dias: Number(d.dias || DIAS_PADRAO),
    liberado_em: d.liberado_em || null,
    expira_em: d.expira_em || null,
    ultimo_acesso: d.ultimo_acesso || null,
    user_agent: d.user_agent || '',
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
  if (!item) {
    item = {
      id: key,
      nome: String(extra.nome || 'Dispositivo').trim().slice(0, 60) || 'Dispositivo',
      dias: DIAS_PADRAO,
      liberado_em: agora(),
      expira_em: expiraEm(DIAS_PADRAO),
      user_agent: String(extra.userAgent || '').slice(0, 180),
    };
    data.itens.push(item);
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
  item.nome = String(nome || '').trim().slice(0, 60) || item.nome;
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
