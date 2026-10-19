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
  clientes: {
    label: 'Clientes',
    default: { acesso: true },
  },
  massa: {
    label: 'Alteração em massa',
    default: { acesso: false },
  },
  dashboard_padrao: {
    label: 'Dashboard padrão',
    default: { acesso: false },
  },
  dashboard_contador: {
    label: 'Dashboard do contador',
    default: { acesso: false },
  },
  dashboard_entradas: {
    label: 'Dashboard de entradas',
    default: { acesso: false },
  },
};

const CHAVES_DASHBOARD = ['dashboard_entradas', 'dashboard_contador', 'dashboard_padrao'];
const PERFIL_DASHBOARD = {
  dashboard_entradas: 'MT_ENTRADAS',
  dashboard_contador: 'CONTADOR_ACESSA',
  dashboard_padrao: 'PADRAO',
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
    usa_manage: 0, // 1 inclui TB_NFVENDA_2/_3 e TB_NFCOMPRA_2 nos dashboards
    ignorar_receber_cartao: 0, // 1 tira do dashboard a conta a receber com cartão no histórico
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
    if (key === 'clientes') out[key] = { acesso: true };
    if (key === 'massa') out[key] = { acesso: true };
    if (key === 'online') out[key] = { acesso: true };
    if (key === 'dashboard_padrao') out[key] = { acesso: true };
    else if (CHAVES_DASHBOARD.includes(key)) out[key] = { acesso: false };
  }
  return out;
}

function comDashboards(base, origem) {
  const out = { ...base };
  for (const k of CHAVES_DASHBOARD) {
    const acesso = origem?.permissoes?.[k]?.acesso;
    out[k] = { acesso: acesso === true || acesso === 'true' || acesso === 1 };
  }
  return out;
}

function acessoDashboard(v) {
  return v === true || v === 'true' || v === 1;
}

function acessoRecusado(v) {
  return v === false || v === 'false' || v === 0 || v === '0';
}

function perfisDashboard(u) {
  return CHAVES_DASHBOARD
    .filter((k) => acessoDashboard(u?.permissoes?.[k]?.acesso))
    .map((k) => PERFIL_DASHBOARD[k]);
}

/** Supervisor entra com acesso total, inclusive pela internet. No MT Entradas o acesso online continua opcional. */
function comAcessoOnline(u, permissoes) {
  if (!MODULOS.online) return permissoes;
  const acesso = u.supervisor ? true : u.acessoOnline === true;
  return { ...permissoes, online: { acesso } };
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
      const permissoes = comDashboards(comAcessoOnline(u, fullPermissoes()), u);
      permissoes.dashboard_padrao = { acesso: true };
      if (acessoRecusado(u.permissoes?.condicionais?.acesso)) permissoes.condicionais = { acesso: false };
      if (acessoRecusado(u.permissoes?.clientes?.acesso)) permissoes.clientes = { acesso: false };
      return {
        ...u,
        id: 0,
        nome: u.nome || 'SUPERVISOR',
        permissoes,
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
    if (atual.permissoes?.dashboard_entradas?.acesso !== true) mudou = true;
    atual.permissoes = permissoesMtEntradas(atual);
    return mudou;
  }
  cfg.usuarios.push({
    id: MT_ENTRADAS_ID,
    nome: 'MT Entradas',
    mtEntradas: true,
    senhaVer: 1,
    acessoOnline: false,
    permissoes: permissoesMtEntradas({}),
  });
  return true;
}

function permissoesMtEntradas(u) {
  const base = ensureModulos({
    importacao: { acesso: true },
    compras: { acesso: true },
    estoque: { acesso: true, ficha: 'editar', precos: 'total', quantidades: 'visualizar' },
    dashboard_entradas: { acesso: true },
  });
  const out = comAcessoOnline(u, comDashboards(base, { permissoes: base }));
  if (acessoRecusado(u?.permissoes?.condicionais?.acesso)) out.condicionais = { acesso: false };
  if (acessoRecusado(u?.permissoes?.clientes?.acesso)) out.clientes = { acesso: false };
  return out;
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

/** Único ponto que lê o parâmetro de servidor usa_manage (0 ou 1). */
function lerUsaManage(cfg) {
  return Number(cfg && cfg.usa_manage) === 1 ? 1 : 0;
}

function lerIgnorarReceberCartao(cfg) {
  return Number(cfg && cfg.ignorar_receber_cartao) === 1 ? 1 : 0;
}

function lerSomenteComEstoque(cfg) {
  return Number(cfg && cfg.somente_com_estoque) === 1 ? 1 : 0;
}

const MENSAGEM_ANIVERSARIO_PADRAO = 'Olá {apelido}, feliz aniversário! A loja deseja um dia especial.';

function lerMensagemAniversario(cfg) {
  const texto = String(cfg?.mensagem_aniversario || '').trim();
  return (texto || MENSAGEM_ANIVERSARIO_PADRAO).slice(0, 500);
}

function usaManageDoPedido(current, body) {
  if (!body || body.usa_manage === undefined) return lerUsaManage(current);
  return body.usa_manage === true || Number(body.usa_manage) === 1 ? 1 : 0;
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
  lerUsaManage,
  lerIgnorarReceberCartao,
  lerSomenteComEstoque,
  lerMensagemAniversario,
  MENSAGEM_ANIVERSARIO_PADRAO,
  usaManageDoPedido,
  CHAVES_DASHBOARD,
  PERFIL_DASHBOARD,
  comDashboards,
  perfisDashboard,
  ensureModulos,
  acessoRecusado,
  fullPermissoes,
  addModulo,
};
