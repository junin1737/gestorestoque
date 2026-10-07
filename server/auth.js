'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  getAppDataDir,
  getUsersPath,
  loadAppConfig,
  loadUsersConfig,
  fullPermissoes,
  isMtEntradas,
  SUPERVISOR_SENHA_LEGADA,
} = require('./config');
const { conferirHashSenha } = require('./senha');
const { isServidorLocal, clientIp } = require('./origem');
const licenca = require('./licenca');

const COOKIE = 'gestor_sessao';
const VALIDADE_MS = 16 * 60 * 60 * 1000;
const MAX_FALHAS_USUARIO = 5;
const MAX_FALHAS_IP = 20;
const JANELA_FALHAS_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;

/** Rotas usadas antes do login (tela de login, bloqueio de licença, detecção do servidor pelo APK). */
const ROTAS_PUBLICAS = [
  /^\/health$/,
  /^\/network$/,
  /^\/qrcode$/,
  /^\/config$/,
  /^\/emitente$/,
  /^\/funcionarios$/,
  /^\/login$/,
  /^\/logout$/,
  /^\/sessao$/,
  /^\/licenca$/,
  /^\/licenca\/verificar$/,
  /^\/mt\/grupo$/,
];

/** Tela de serviço (sem login de usuário): só no próprio computador servidor. */
const ROTAS_SERVIDOR_LOCAL = [
  /^\/config$/,
  /^\/connect$/,
  /^\/shutdown$/,
  /^\/licenca\/aplicar$/,
  /^\/licenca\/solicitar$/,
  /^\/database\//,
  /^\/fiscal\//,
  /^\/dispositivos/,
];

let chave = null;
function chaveSessao() {
  if (chave) return chave;
  const arq = path.join(getAppDataDir(), '.session-key');
  try {
    const buf = Buffer.from(fs.readFileSync(arq, 'utf8').trim(), 'base64');
    if (buf.length >= 32) chave = buf;
  } catch { /* gera abaixo */ }
  if (!chave) {
    chave = crypto.randomBytes(32);
    fs.writeFileSync(arq, chave.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  }
  return chave;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function assinar(corpo) {
  return b64url(crypto.createHmac('sha256', chaveSessao()).update(corpo).digest());
}

/** Escopo da base: trocar o .FDB configurado invalida todas as sessões. */
function escopoBase() {
  return crypto.createHash('sha256').update(getUsersPath(loadAppConfig())).digest('hex').slice(0, 16);
}

function versaoCredencial(user) {
  return user.supervisor ? `s:${licenca.versaoSupervisor()}` : `u:${Number(user.senhaVer || 0)}`;
}

function emitirToken(user) {
  const agora = Date.now();
  const dados = {
    u: Number(user.id),
    b: escopoBase(),
    c: versaoCredencial(user),
    iat: agora,
    exp: agora + VALIDADE_MS,
    n: b64url(crypto.randomBytes(9)),
  };
  const corpo = b64url(JSON.stringify(dados));
  return { token: `${corpo}.${assinar(corpo)}`, dados };
}

const revogados = new Map();
function limparRevogados() {
  const agora = Date.now();
  for (const [n, exp] of revogados) if (exp < agora) revogados.delete(n);
  for (const [n, t] of tokensMt) if (t.exp < agora) tokensMt.delete(n);
}

/**
 * Token do servidor de licenças do login MT Entradas, por sessão. Só em memória: reiniciar o Gestor
 * (ou o token vencer) encerra a sessão MT e pede a senha de novo.
 */
const tokensMt = new Map();

function tokenMtDaSessao(u) {
  const t = u?.sessao?.nonce ? tokensMt.get(u.sessao.nonce) : null;
  return t && t.exp > Date.now() ? t.token : null;
}

function lerToken(token) {
  const [corpo, sig] = String(token || '').split('.');
  if (!corpo || !sig) return null;
  const esperado = assinar(corpo);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let dados;
  try {
    dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!dados || Number(dados.exp) < Date.now() || revogados.has(dados.n)) return null;
  return dados;
}

function lerCookie(req, nome) {
  const raw = String(req.headers.cookie || '');
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return '';
}

function definirCookie(res, valor, maxAgeS) {
  const partes = [`${COOKIE}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeS != null) partes.push(`Max-Age=${maxAgeS}`);
  res.setHeader('Set-Cookie', partes.join('; '));
}

function tokenDaRequisicao(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return lerCookie(req, COOKIE);
}

/** Usuário atual a partir do token (permissões sempre relidas do arquivo de usuários). */
function usuarioDaSessao(req) {
  const dados = lerToken(tokenDaRequisicao(req));
  if (!dados) return null;
  if (dados.b !== escopoBase()) return null;
  const cfg = loadUsersConfig(loadAppConfig());
  const user = cfg.usuarios.find((u) => Number(u.id) === Number(dados.u));
  if (!user) return null;
  if (dados.c !== versaoCredencial(user)) return null;
  const mt = isMtEntradas(user);
  if (mt) {
    const t = tokensMt.get(dados.n);
    if (!t || t.exp <= Date.now()) return null;
  }
  return {
    id: Number(user.id),
    nome: user.nome,
    supervisor: !!user.supervisor,
    mtEntradas: mt,
    permissoes: user.supervisor ? fullPermissoes() : user.permissoes,
    sessao: { nonce: dados.n, exp: dados.exp },
  };
}

// ─── Tentativas de login ──────────────────────────────────────────────────────

const falhas = new Map();

function registroFalhas(chaveF) {
  const agora = Date.now();
  let r = falhas.get(chaveF);
  if (!r || (agora - r.inicio > JANELA_FALHAS_MS && !(r.ate > agora))) {
    r = { n: 0, inicio: agora, ate: 0 };
    falhas.set(chaveF, r);
  }
  return r;
}

function bloqueadoAte(req, id) {
  const agora = Date.now();
  const ru = falhas.get(`u:${id}`);
  const ri = falhas.get(`ip:${clientIp(req)}`);
  return Math.max(ru?.ate > agora ? ru.ate : 0, ri?.ate > agora ? ri.ate : 0);
}

function anotarFalha(req, id) {
  const ru = registroFalhas(`u:${id}`);
  ru.n += 1;
  if (ru.n >= MAX_FALHAS_USUARIO) ru.ate = Date.now() + BLOQUEIO_MS;
  const ri = registroFalhas(`ip:${clientIp(req)}`);
  ri.n += 1;
  if (ri.n >= MAX_FALHAS_IP) ri.ate = Date.now() + BLOQUEIO_MS;
  return MAX_FALHAS_USUARIO - ru.n;
}

function limparFalhas(req, id) {
  falhas.delete(`u:${id}`);
  falhas.delete(`ip:${clientIp(req)}`);
}

async function conferirSenhaUsuario(user, senha) {
  if (user.supervisor) return licenca.conferirSenhaSupervisor(senha, SUPERVISOR_SENHA_LEGADA);
  if (isMtEntradas(user)) return false;
  return conferirHashSenha(senha, user.senhaHash);
}

async function falhaLogin(req, res, id) {
  const restam = anotarFalha(req, id);
  await new Promise((r) => setTimeout(r, 400));
  return res.json({
    ok: false,
    error: restam > 0 && restam <= 2
      ? `Senha incorreta. Mais ${restam} tentativa(s) antes de bloquear por 15 minutos.`
      : 'Senha incorreta.',
  });
}

/** POST /login { id, senha } */
async function login(req, res) {
  const id = Number(req.body?.id);
  const senha = String(req.body?.senha ?? '');
  const ate = bloqueadoAte(req, id);
  if (ate) {
    const min = Math.max(1, Math.ceil((ate - Date.now()) / 60000));
    return res.status(429).json({ ok: false, error: `Muitas tentativas erradas. Tente de novo em ${min} minuto(s).` });
  }
  const cfg = loadUsersConfig(loadAppConfig());
  const user = Number.isFinite(id) ? cfg.usuarios.find((u) => Number(u.id) === id) : null;
  if (!user) return res.json({ ok: false, error: 'Usuário não encontrado.' });
  const mt = isMtEntradas(user);
  let tokenMt = null;
  if (mt) {
    const r = await require('./mt-empresas').loginMt(senha);
    if (r.ok === false && r.status === 401) return falhaLogin(req, res, id);
    if (r.ok === false || !r.token) {
      return res.json({ ok: false, error: `Não foi possível conferir a senha MT: ${r.error || 'servidor de licenças indisponível.'}` });
    }
    tokenMt = { token: r.token, horas: Number(r.horas) || 12 };
  } else {
    if (!user.supervisor && !user.senhaHash) {
      return res.json({ ok: false, error: 'Defina a senha deste usuário em Usuários.' });
    }
    if (!(await conferirSenhaUsuario(user, senha))) return falhaLogin(req, res, id);
  }
  limparFalhas(req, id);
  const { token, dados } = emitirToken(user);
  if (tokenMt) {
    // Um pouco antes do token do servidor de licenças vencer, para a sessão não ficar sem ele.
    const exp = Math.min(dados.exp, Date.now() + tokenMt.horas * 3600000 - 5 * 60000);
    tokensMt.set(dados.n, { token: tokenMt.token, exp });
    limparRevogados();
  }
  definirCookie(res, token);
  res.json({
    ok: true,
    expira_em: new Date(dados.exp).toISOString(),
    usuario: {
      id: Number(user.id),
      nome: user.nome,
      supervisor: !!user.supervisor,
      mtEntradas: mt,
      permissoes: user.supervisor ? fullPermissoes() : user.permissoes,
      temSenha: true,
    },
  });
}

function logout(req, res) {
  const dados = lerToken(tokenDaRequisicao(req));
  if (dados) {
    revogados.set(dados.n, Number(dados.exp));
    tokensMt.delete(dados.n);
    limparRevogados();
  }
  definirCookie(res, '', 0);
  res.json({ ok: true });
}

function sessao(req, res) {
  const u = usuarioDaSessao(req);
  if (!u) return res.json({ ok: false, code: 'AUTH' });
  const { sessao: s, ...usuario } = u;
  res.json({ ok: true, usuario: { ...usuario, temSenha: true }, expira_em: new Date(s.exp).toISOString() });
}

/** Bloqueia requisição de outro site usando o cookie do navegador (CSRF). */
function origemConfiavel(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function exigirSessao(req, res, next) {
  if (!origemConfiavel(req)) {
    return res.status(403).json({ ok: false, error: 'Origem da requisição não permitida.' });
  }
  if (ROTAS_PUBLICAS.some((re) => re.test(req.path))) return next();
  if (ROTAS_SERVIDOR_LOCAL.some((re) => re.test(req.path)) && isServidorLocal(req)) return next();
  const u = usuarioDaSessao(req);
  if (!u) {
    return res.status(401).json({ ok: false, code: 'AUTH', error: 'Sessão expirada. Entre novamente.' });
  }
  const esperado = req.headers['x-gestor-usuario'];
  if (esperado != null && esperado !== '' && Number(esperado) !== u.id) {
    return res.status(401).json({
      ok: false,
      code: 'SESSAO_TROCADA',
      error: 'Outro usuário entrou neste navegador. Entre novamente.',
    });
  }
  req.usuario = u;
  const deviceId = String(req.headers['x-device-id'] || '').trim();
  if (deviceId) {
    const r = require('./dispositivos').registrar(deviceId, {
      userAgent: req.headers['user-agent'],
    });
    if (r.vencido) {
      return res.status(403).json({
        ok: false,
        code: 'DISPOSITIVO',
        error: 'O prazo deste dispositivo acabou. Renove o tempo na aba Dispositivos do servidor.',
      });
    }
  }
  next();
}

function nivel(u, modulo, acao) {
  if (!u) return 'nenhum';
  if (u.supervisor) return acao === 'precos' ? 'total' : 'editar';
  const p = u.permissoes?.[modulo] || {};
  if (!p.acesso) return 'nenhum';
  return p[acao] || 'nenhum';
}

function temAcesso(u, ...modulos) {
  if (!u) return false;
  if (u.supervisor) return true;
  return modulos.some((m) => !!u.permissoes?.[m]?.acesso);
}

/** Middleware: exige acesso a pelo menos um dos módulos. */
function exigirModulo(...modulos) {
  return (req, res, next) => {
    if (temAcesso(req.usuario, ...modulos)) return next();
    res.status(403).json({ ok: false, code: 'SEM_PERMISSAO', error: 'Sem permissão para esta operação.' });
  };
}

function podeVerCusto(u) {
  return nivel(u, 'estoque', 'precos') === 'total' || temAcesso(u, 'importacao');
}

module.exports = {
  login,
  logout,
  sessao,
  exigirSessao,
  exigirModulo,
  temAcesso,
  nivel,
  podeVerCusto,
  conferirSenhaUsuario,
  tokenMtDaSessao,
};
