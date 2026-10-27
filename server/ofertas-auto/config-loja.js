'use strict';

const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('../config');
const { capacidadeJanela } = require('./regras-publicacao');

const DIAS = [0, 1, 2, 3, 4, 5, 6];
const TIPOS_FDS = ['receita', 'pergunta', 'bastidores'];
const ONDE = ['banner', 'legenda', 'ambos'];

function padrao() {
  return {
    publicacao: {
      posts_por_dia: 4,
      intervalo_minutos: 90,
      hora_inicio: '08:00',
      hora_fim: '20:00',
      dias_semana: [1, 2, 3, 4, 5],
    },
    fim_de_semana: {
      ativo: false,
      quantidade_por_dia: 1,
      tipos: ['receita', 'pergunta', 'bastidores'],
      encarte_sabado_manha: false,
    },
    detalhes_item: {
      ativo: false,
      campo_origem: '',
      onde: 'legenda',
      limite_banner: 40,
    },
    estoque: {
      exigir_estoque_positivo: false,
      estoque_minimo_anuncio: 1,
    },
    instagram: {
      conectada: false,
      usuario: '',
      token_expira_em: null,
      status: 'desconectada',
    },
    usuarios: [],
  };
}

function hora(v, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : fallback;
}

function inteiro(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function sanitizar(body, camposTexto) {
  const base = padrao();
  const pub = body?.publicacao || {};
  const fds = body?.fim_de_semana || {};
  const det = body?.detalhes_item || {};
  const est = body?.estoque || {};
  const ig = body?.instagram || {};
  const dias = Array.isArray(pub.dias_semana)
    ? [...new Set(pub.dias_semana.map(Number).filter((n) => DIAS.includes(n)))]
    : base.publicacao.dias_semana;
  const tipos = Array.isArray(fds.tipos)
    ? [...new Set(fds.tipos.map(String).filter((t) => TIPOS_FDS.includes(t)))]
    : base.fim_de_semana.tipos;
  const campo = String(det.campo_origem || '').trim().slice(0, 40);
  const nomes = (Array.isArray(camposTexto) ? camposTexto : []).map((c) => (typeof c === 'string' ? c : String(c?.coluna || '')));
  const campoOk = !campo || nomes.includes(campo);
  const config = {
    publicacao: {
      posts_por_dia: inteiro(pub.posts_por_dia, base.publicacao.posts_por_dia, 1, 50),
      intervalo_minutos: inteiro(pub.intervalo_minutos, base.publicacao.intervalo_minutos, 1, 1440),
      hora_inicio: hora(pub.hora_inicio, base.publicacao.hora_inicio),
      hora_fim: hora(pub.hora_fim, base.publicacao.hora_fim),
      dias_semana: dias.length ? dias : base.publicacao.dias_semana,
    },
    fim_de_semana: {
      ativo: bool(fds.ativo),
      quantidade_por_dia: inteiro(fds.quantidade_por_dia, 1, 0, 10),
      tipos: tipos.length ? tipos : base.fim_de_semana.tipos,
      encarte_sabado_manha: bool(fds.encarte_sabado_manha),
    },
    detalhes_item: {
      ativo: bool(det.ativo),
      campo_origem: campoOk ? campo : '',
      onde: ONDE.includes(det.onde) ? det.onde : 'legenda',
      limite_banner: inteiro(det.limite_banner, 40, 10, 120),
    },
    estoque: {
      exigir_estoque_positivo: bool(est.exigir_estoque_positivo),
      estoque_minimo_anuncio: inteiro(est.estoque_minimo_anuncio, 1, 0, 999999),
    },
    instagram: {
      conectada: bool(ig.conectada),
      usuario: String(ig.usuario || '').trim().slice(0, 80),
      token_expira_em: ig.token_expira_em ? String(ig.token_expira_em).slice(0, 40) : null,
      status: ['desconectada', 'conectada', 'expirada'].includes(ig.status) ? ig.status : 'desconectada',
    },
    usuarios: Array.isArray(body?.usuarios)
      ? body.usuarios.slice(0, 500).map((u) => ({
        id: Number(u.id),
        papel: u.papel === 'preco' ? 'preco' : 'agenda',
      })).filter((u) => Number.isInteger(u.id))
      : [],
  };
  return { config, janela: capacidadeJanela(config.publicacao) };
}

function arquivo() {
  return path.join(getAppDataDir(), 'ofertas-auto.json');
}

function lerArquivo() {
  try {
    return JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
  } catch {
    return { loja_id: '', configuracao: padrao(), produtos: {}, fila: [], catalogo_em: null };
  }
}

function gravarArquivo(dados) {
  const p = arquivo();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function lerConfig() {
  const salvo = lerArquivo().configuracao || {};
  const base = padrao();
  const out = {};
  for (const chave of Object.keys(base)) {
    out[chave] = { ...base[chave], ...(salvo[chave] && typeof salvo[chave] === 'object' ? salvo[chave] : {}) };
  }
  if (Array.isArray(salvo.usuarios)) out.usuarios = salvo.usuarios;
  return out;
}

module.exports = {
  padrao,
  sanitizar,
  lerArquivo,
  gravarArquivo,
  lerConfig,
};
