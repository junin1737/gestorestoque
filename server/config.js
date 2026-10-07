'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { gerarHashSenha } = require('./senha');

/** Senha pré-cadastrada do supervisor no painel. Também é aceita quando a licença tem outro hash. */
const SUPERVISOR_SENHA_LEGADA = 'Supervisor Gold1020**';
/** Senha pré-cadastrada do usuário MT Entradas no painel. */
const SENHA_MT_ENTRADAS = '18321937';
const edicao = require('./edicao');

const PORT = Number(process.env.GESTOR_PORT) || edicao.PORTA_PADRAO;

const MODULOS = {
  estoque: {
    label: 'Estoque',
    default: {
      acesso: true,
      ficha: 'editar',
      precos: 'total',
      quantidades: 'editar',
    },
  },
  alteracoes: {
    label: 'Alterações',
    default: { acesso: false },
  },
  usuarios: {
    label: 'Usuários',
    default: { acesso: false },
  },
  importacao: {
    label: 'Notas de entrada',
    default: { acesso: false },
  },
  compras: {
    label: 'Consultar Compras',
    default: { acesso: false },
  },
  condicionais: {
    label: 'Condicionais',
    default: { acesso: true },
  },
};
if (edicao.ONLINE) {
  MODULOS.online = { label: 'Acesso online', default: { acesso: false } };
}

/** Arquivos trazidos do Gestor Estoque normal na primeira abertura da edição online. */
const ARQUIVOS_HERDADOS = /^(app-config\.json|licenca\.json|importacao-cfop-params\.json|\.fiscal-key|usuarios_[0-9a-f]+\.json)$/;

function herdarDoGestorNormal(raiz, dir) {
  const origem = path.join(raiz, 'GestorEstoque');
  try {
    for (const nome of fs.readdirSync(origem)) {
      if (ARQUIVOS_HERDADOS.test(nome)) fs.copyFileSync(path.join(origem, nome), path.join(dir, nome));
    }
  } catch { /* Gestor normal não instalado: começa do zero */ }
}

function getAppDataDir() {
  const raiz = process.env.APPDATA || path.join(os.homedir(), '.config');
  const dir = path.join(raiz, edicao.PASTA_DADOS);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    if (edicao.ONLINE) herdarDoGestorNormal(raiz, dir);
  }
  return dir;
}

function getAppConfigPath() {
  return path.join(getAppDataDir(), 'app-config.json');
}

function defaultAppConfig() {
  return {
    host: '127.0.0.1',
    port: 3050,
    database: 'C:\\Work\\MT\\Cheff\\Clipp\\Base\\CLIPP.FDB',
    user: 'SYSDBA',
    password: 'masterkey',
    sistema: 'clipp', // clipp | managepro | ambos
    tema: 'claro', // claro | escuro | empresa
    fiscal: {
      tipo: 'a1',
      arquivoPfx: '',
      senhaEnc: '',
      thumbprint: '',
      certStore: 'CurrentUser\\My',
      ambiente: 'homologacao',
    },
  };
}

function loadAppConfig() {
  const p = getAppConfigPath();
  if (!fs.existsSync(p)) {
    const cfg = defaultAppConfig();
    saveAppConfig(cfg);
    return cfg;
  }
  try {
    return { ...defaultAppConfig(), ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    return defaultAppConfig();
  }
}

function saveAppConfig(cfg) {
  fs.writeFileSync(getAppConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function scopeKey(appCfg) {
  return `${appCfg.host}:${appCfg.port}:${appCfg.database}`.toLowerCase();
}

function getUsersPath(appCfg) {
  const hash = crypto.createHash('md5').update(scopeKey(appCfg)).digest('hex').slice(0, 12);
  return path.join(getAppDataDir(), `usuarios_${hash}.json`);
}

function fullPermissoes() {
  const out = {};
  for (const [key, mod] of Object.entries(MODULOS)) {
    out[key] = { ...mod.default, acesso: true };
    if (key === 'estoque') {
      out[key] = { acesso: true, ficha: 'editar', precos: 'total', quantidades: 'editar' };
    }
    if (key === 'alteracoes') out[key] = { acesso: true };
    if (key === 'usuarios') out[key] = { acesso: true };
    if (key === 'importacao') out[key] = { acesso: true };
    if (key === 'compras') out[key] = { acesso: true };
    if (key === 'condicionais') out[key] = { acesso: true };
    if (key === 'online') out[key] = { acesso: false };
  }
  return out;
}

/** Supervisor e MT Entradas têm permissões fixas; só o acesso online é liberado (ou não) em Usuários. */
function comAcessoOnline(u, permissoes) {
  if (!MODULOS.online) return permissoes;
  return { ...permissoes, online: { acesso: u.acessoOnline === true } };
}

function ensureModulos(permissoes) {
  const p = { ...(permissoes || {}) };
  for (const [key, mod] of Object.entries(MODULOS)) {
    if (!p[key]) p[key] = { ...mod.default };
    else p[key] = { ...mod.default, ...p[key] };
  }
  return p;
}

function defaultUsersConfig() {
  return {
    usuarios: [
      {
        id: 0,
        nome: 'SUPERVISOR',
        supervisor: true,
        permissoes: fullPermissoes(),
      },
    ],
  };
}

/** Converte senhas antigas em texto para hash scrypt (uma vez) e remove a do supervisor. */
function migrarSenhas(cfg) {
  let mudou = false;
  for (const u of cfg.usuarios || []) {
    if (u.supervisor) {
      if ('senha' in u) { delete u.senha; mudou = true; }
      continue;
    }
    if (typeof u.senha === 'string') {
      if (u.senha.length && !u.senhaHash) {
        u.senhaHash = gerarHashSenha(u.senha);
        u.senhaVer = Number(u.senhaVer || 0) + 1;
      }
      delete u.senha;
      mudou = true;
    }
  }
  return mudou;
}

function loadUsersConfig(appCfg) {
  const p = getUsersPath(appCfg);
  let cfg;
  if (!fs.existsSync(p)) {
    cfg = defaultUsersConfig();
    saveUsersConfig(appCfg, cfg);
  } else {
    try {
      cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      cfg = defaultUsersConfig();
    }
    if (migrarSenhas(cfg)) saveUsersConfig(appCfg, cfg);
  }
  cfg.usuarios = (cfg.usuarios || []).map((u) => {
    if (u.supervisor) {
      return {
        ...u,
        id: 0,
        nome: u.nome || 'SUPERVISOR',
        permissoes: comAcessoOnline(u, fullPermissoes()),
      };
    }
    return { ...u, permissoes: ensureModulos(u.permissoes) };
  });
  if (!cfg.usuarios.some((u) => u.supervisor)) {
    cfg.usuarios.unshift(defaultUsersConfig().usuarios[0]);
  }
  if (ensureUsuarioMtEntradas(cfg)) saveUsersConfig(appCfg, cfg);
  return cfg;
}

/** A senha do MT Entradas é conferida no servidor de licenças; o Gestor não guarda nenhuma. */
const MT_ENTRADAS_ID = 900001;

function ensureUsuarioMtEntradas(cfg) {
  const atual = (cfg.usuarios || []).find((u) => u.mtEntradas || Number(u.id) === MT_ENTRADAS_ID);
  if (atual) {
    let mudou = false;
    if (!atual.mtEntradas) { atual.mtEntradas = true; mudou = true; }
    if (atual.nome !== 'MT Entradas') { atual.nome = 'MT Entradas'; mudou = true; }
    if (Number(atual.id) !== MT_ENTRADAS_ID) { atual.id = MT_ENTRADAS_ID; mudou = true; }
    if (atual.senhaHash || atual.senha) { delete atual.senhaHash; delete atual.senha; mudou = true; }
    atual.permissoes = comAcessoOnline(atual, ensureModulos({
      importacao: { acesso: true },
      compras: { acesso: true },
      estoque: { acesso: true, ficha: 'editar', precos: 'total', quantidades: 'visualizar' },
    }));
    return mudou;
  }
  cfg.usuarios.push({
    id: MT_ENTRADAS_ID,
    nome: 'MT Entradas',
    mtEntradas: true,
    senhaVer: 1,
    acessoOnline: false,
    permissoes: comAcessoOnline({}, ensureModulos({
      importacao: { acesso: true },
      compras: { acesso: true },
      estoque: { acesso: true, ficha: 'editar', precos: 'total', quantidades: 'visualizar' },
    })),
  });
  return true;
}

function isMtEntradas(u) {
  return !!(u && (u.mtEntradas || Number(u.id) === MT_ENTRADAS_ID));
}

function saveUsersConfig(appCfg, cfg) {
  migrarSenhas(cfg);
  const p = getUsersPath(appCfg);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function addModulo(key, definition) {
  if (MODULOS[key]) return false;
  MODULOS[key] = definition;
  return true;
}

module.exports = {
  PORT,
  SUPERVISOR_SENHA_LEGADA,
  SENHA_MT_ENTRADAS,
  MODULOS,
  getAppDataDir,
  getUsersPath,
  loadAppConfig,
  saveAppConfig,
  loadUsersConfig,
  saveUsersConfig,
  isMtEntradas,
  ensureModulos,
  fullPermissoes,
  addModulo,
};
