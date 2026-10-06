'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { gerarHashSenha } = require('./senha');

/** Só vale enquanto o painel de licenças não definir a senha do supervisor (ou com licença desligada). */
const SUPERVISOR_SENHA_LEGADA = '1020';
const PORT = Number(process.env.GESTOR_PORT) || 5077;

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
};

function getAppDataDir() {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'GestorEstoque');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
  }
  return out;
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
        permissoes: fullPermissoes(),
      };
    }
    return { ...u, permissoes: ensureModulos(u.permissoes) };
  });
  if (!cfg.usuarios.some((u) => u.supervisor)) {
    cfg.usuarios.unshift(defaultUsersConfig().usuarios[0]);
  }
  return cfg;
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
  MODULOS,
  getAppDataDir,
  getUsersPath,
  loadAppConfig,
  saveAppConfig,
  loadUsersConfig,
  saveUsersConfig,
  ensureModulos,
  fullPermissoes,
  addModulo,
};
