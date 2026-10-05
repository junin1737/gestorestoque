import ADMIN_HTML from './admin.html';

const TOLERANCIA_OFFLINE_DIAS = 7;
const SESSAO_HORAS = 12;
const STATUS_VALIDOS = ['pendente', 'liberado', 'bloqueado'];
const MSG_PENDENTE = 'Cadastro recebido. Aguardando liberação da MT Automações — (34) 3674-1937.';
const MSG_BLOQUEADO = 'Acesso bloqueado. Entre em contato com a MT Automações — (34) 3674-1937.';
/** Gestor até 1.2.59 não envia o nome da aplicação. */
const APP_PADRAO = 'GestorEstoque';
const APP_RE = /^[A-Za-z][A-Za-z0-9_.-]{1,39}$/;
const APP_ROTA = '[A-Za-z][A-Za-z0-9_.-]{1,39}';

const enc = new TextEncoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function agoraIso() {
  return new Date().toISOString();
}

function soDigitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function texto(v, max = 200) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

/** Gestor consulta a cada 2 min; "último contato" só é regravado depois disso (poupa escritas no D1). */
const GRAVAR_CONTATO_MS = 10 * 60 * 1000;
function contatoAntigo(iso) {
  const t = new Date(iso || 0).getTime();
  return !Number.isFinite(t) || Date.now() - t > GRAVAR_CONTATO_MS;
}

function nomeApp(v) {
  const s = String(v ?? '').trim();
  return APP_RE.test(s) ? s : null;
}

function dataValida(v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function b64(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function b64url(buf) {
  return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemParaDer(pem) {
  const corpo = String(pem || '').replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(corpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let chaveAssinatura = null;
async function getChaveAssinatura(env) {
  if (!chaveAssinatura) {
    chaveAssinatura = await crypto.subtle.importKey(
      'pkcs8', pemParaDer(env.LICENCA_PRIVATE_KEY), { name: 'Ed25519' }, false, ['sign']
    );
  }
  return chaveAssinatura;
}

/** Assina o JSON exato enviado ao Gestor; ele verifica com a chave pública embutida. */
async function assinarLicenca(env, licenca) {
  const payload = JSON.stringify({ v: 1, ...licenca });
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, await getChaveAssinatura(env), enc.encode(payload));
  return { payload, sig: b64(sig) };
}

/** Fim do dia de pago_ate no horário de Brasília (UTC-3). */
function fimDoDiaBrasilia(dataYmd) {
  return new Date(`${dataYmd}T23:59:59-03:00`);
}

function situacaoCliente(cli, agora = new Date()) {
  if (cli.status === 'pendente') return { status: 'pendente', mensagem: cli.mensagem || MSG_PENDENTE };
  if (cli.status !== 'liberado') return { status: 'bloqueado', mensagem: cli.mensagem || MSG_BLOQUEADO };
  if (cli.pago_ate && fimDoDiaBrasilia(cli.pago_ate) < agora) {
    const [a, m, d] = cli.pago_ate.split('-');
    return { status: 'vencido', mensagem: cli.mensagem || `Licença vencida em ${d}/${m}/${a}. Contate a MT Automações — (34) 3674-1937.` };
  }
  return { status: 'liberado', mensagem: cli.mensagem || null };
}

/** Valida o hash gerado pelo painel: { alg, iter, salt, hash } (base64). */
function supHashValido(v) {
  if (!v || typeof v !== 'object') return null;
  const iter = Number(v.iter);
  const b64ok = (s, min, max) => typeof s === 'string' && /^[A-Za-z0-9+/]+=*$/.test(s) && s.length >= min && s.length <= max;
  if (v.alg !== 'pbkdf2-sha256' || !Number.isInteger(iter) || iter < 100000 || iter > 2000000) return null;
  if (!b64ok(v.salt, 20, 64) || !b64ok(v.hash, 40, 64)) return null;
  return { alg: v.alg, iter, salt: v.salt, hash: v.hash };
}

async function lerConfig(env, chave) {
  const r = await env.DB.prepare('SELECT valor, atualizado_em FROM config WHERE chave = ?').bind(chave).first();
  return r || null;
}

async function supDoCliente(env, cli) {
  if (cli?.sup_hash) {
    try { return supHashValido(JSON.parse(cli.sup_hash)); } catch { /* cai na padrão */ }
  }
  const padrao = await lerConfig(env, 'sup_padrao');
  if (!padrao?.valor) return null;
  try { return supHashValido(JSON.parse(padrao.valor)); } catch { return null; }
}

async function registrarEvento(env, cnpj, app, tipo, detalhe) {
  await env.DB.prepare('INSERT INTO eventos (cnpj, aplicacao, tipo, detalhe, criado_em) VALUES (?, ?, ?, ?, ?)')
    .bind(cnpj, app, tipo, detalhe ? String(detalhe).slice(0, 500) : null, agoraIso())
    .run();
}

function buscarCliente(env, cnpj, app) {
  return env.DB.prepare('SELECT * FROM clientes WHERE cnpj = ? AND aplicacao = ?').bind(cnpj, app).first();
}

// ─── Rota pública: consulta do Gestor ─────────────────────────────────────────

async function check(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'JSON inválido.' }, 400);
  }
  const cnpj = soDigitos(body.cnpj);
  if (cnpj.length !== 14 && cnpj.length !== 11) return json({ ok: false, error: 'CNPJ/CPF inválido.' }, 400);
  const app = body.aplicacao === undefined ? APP_PADRAO : nomeApp(body.aplicacao);
  if (!app) return json({ ok: false, error: 'Nome da aplicação inválido.' }, 400);
  const nse = texto(body.nse, 40) || '';
  const agora = agoraIso();
  const ip = request.headers.get('CF-Connecting-IP') || '';

  let cli = await buscarCliente(env, cnpj, app);
  if (!cli) {
    await env.DB.prepare(
      `INSERT INTO clientes (cnpj, aplicacao, razao, fantasia, status, criado_em, atualizado_em, ultimo_contato)
       VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?)`
    ).bind(cnpj, app, texto(body.razao, 120), texto(body.fantasia, 120), agora, agora, agora).run();
    await registrarEvento(env, cnpj, app, 'novo_cliente',
      `${texto(body.fantasia, 120) || ''} — NSE ${nse || '—'} — ${texto(body.maquina, 80) || ''}`);
    cli = await buscarCliente(env, cnpj, app);
  } else {
    const razao = texto(body.razao, 120);
    const fantasia = texto(body.fantasia, 120);
    if (contatoAntigo(cli.ultimo_contato) || (razao && razao !== cli.razao) || (fantasia && fantasia !== cli.fantasia)) {
      await env.DB.prepare(
        `UPDATE clientes SET ultimo_contato = ?,
           razao = COALESCE(?, razao), fantasia = COALESCE(?, fantasia)
         WHERE cnpj = ? AND aplicacao = ?`
      ).bind(agora, razao, fantasia, cnpj, app).run();
    }
  }

  const inst = await env.DB.prepare('SELECT * FROM instalacoes WHERE cnpj = ? AND aplicacao = ? AND nse = ?')
    .bind(cnpj, app, nse).first();
  const versao = texto(body.versao_gestor, 20);
  const dadosInst = {
    maquina: texto(body.maquina, 80),
    versao_gestor: versao,
    versao_clipp: texto(body.versao_clipp, 20),
    sistema: texto(body.sistema, 20),
    ip,
  };
  const mudouInst = !inst || contatoAntigo(inst.ultimo_contato)
    || Object.keys(dadosInst).some((k) => (dadosInst[k] ?? null) !== (inst[k] ?? null));
  if (mudouInst) {
    await env.DB.prepare(
      `INSERT INTO instalacoes (cnpj, aplicacao, nse, maquina, versao_gestor, versao_clipp, sistema, ip, primeiro_contato, ultimo_contato)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (cnpj, aplicacao, nse) DO UPDATE SET
         maquina = excluded.maquina, versao_gestor = excluded.versao_gestor, versao_clipp = excluded.versao_clipp,
         sistema = excluded.sistema, ip = excluded.ip, ultimo_contato = excluded.ultimo_contato`
    ).bind(cnpj, app, nse, dadosInst.maquina, versao, dadosInst.versao_clipp, dadosInst.sistema, ip, agora, agora).run();
  }
  if (!inst) {
    await registrarEvento(env, cnpj, app, 'nova_instalacao', `NSE ${nse || '—'} · ${texto(body.maquina, 80) || ''} · v${versao || '?'}`);
  } else if (inst.versao_gestor && versao && inst.versao_gestor !== versao) {
    await registrarEvento(env, cnpj, app, 'versao', `${texto(body.maquina, 80) || nse}: ${inst.versao_gestor} → ${versao}`);
  }

  const sit = situacaoCliente(cli);
  const emitido = new Date();
  let validoAte = new Date(emitido.getTime() + TOLERANCIA_OFFLINE_DIAS * 86400000);
  if (sit.status === 'liberado' && cli.pago_ate) {
    const fim = fimDoDiaBrasilia(cli.pago_ate);
    if (fim < validoAte) validoAte = fim;
  }
  const licenca = await assinarLicenca(env, {
    tipo: 'online',
    app,
    cnpj,
    nse,
    status: sit.status,
    mensagem: sit.mensagem,
    pago_ate: cli.pago_ate || null,
    emitido_em: emitido.toISOString(),
    valido_ate: validoAte.toISOString(),
    sup: sit.status === 'liberado' ? await supDoCliente(env, cli) : null,
  });
  return json({ ok: true, licenca, solicitado_em: cli.status === 'pendente' ? cli.criado_em : null });
}

// ─── Admin ────────────────────────────────────────────────────────────────────

async function chaveSessao(env) {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`${env.ADMIN_PASSWORD}::${env.LICENCA_PRIVATE_KEY}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function emitirToken(env) {
  const corpo = b64url(enc.encode(JSON.stringify({ exp: Date.now() + SESSAO_HORAS * 3600000 })));
  const sig = await crypto.subtle.sign('HMAC', await chaveSessao(env), enc.encode(corpo));
  return `${corpo}.${b64url(sig)}`;
}

async function tokenValido(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [corpo, sig] = token.split('.');
  if (!corpo || !sig) return false;
  const esperado = b64url(await crypto.subtle.sign('HMAC', await chaveSessao(env), enc.encode(corpo)));
  if (esperado.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= esperado.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const dados = JSON.parse(atob(corpo.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(dados.exp) > Date.now();
  } catch {
    return false;
  }
}

async function login(request, env) {
  let body = {};
  try { body = await request.json(); } catch { /* vazio */ }
  const senha = String(body.senha || '');
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(senha)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(env.ADMIN_PASSWORD || ''))));
  let diff = env.ADMIN_PASSWORD ? 0 : 1;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ ok: false, error: 'Senha incorreta.' }, 401);
  }
  return json({ ok: true, token: await emitirToken(env), horas: SESSAO_HORAS });
}

async function listarClientes(url, env) {
  const q = String(url.searchParams.get('q') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim();
  const app = nomeApp(url.searchParams.get('app'));
  const where = [];
  const params = [];
  if (STATUS_VALIDOS.includes(status)) {
    where.push('c.status = ?');
    params.push(status);
  }
  if (app) {
    where.push('c.aplicacao = ?');
    params.push(app);
  }
  if (q) {
    where.push(`(c.cnpj LIKE ? OR c.razao LIKE ? OR c.fantasia LIKE ? OR c.aplicacao LIKE ? OR EXISTS (
      SELECT 1 FROM instalacoes i2 WHERE i2.cnpj = c.cnpj AND i2.aplicacao = c.aplicacao AND (i2.nse LIKE ? OR i2.maquina LIKE ?)))`);
    const like = `%${q}%`;
    const likeCnpj = `%${soDigitos(q) || q}%`;
    params.push(likeCnpj, like, like, like, like, like);
  }
  const ultimaInst = (col) => `(SELECT i.${col} FROM instalacoes i WHERE i.cnpj = c.cnpj AND i.aplicacao = c.aplicacao
    ORDER BY i.ultimo_contato DESC LIMIT 1) AS ${col}`;
  const sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM instalacoes i WHERE i.cnpj = c.cnpj AND i.aplicacao = c.aplicacao) AS instalacoes,
      ${ultimaInst('versao_gestor')}, ${ultimaInst('maquina')}, ${ultimaInst('nse')}
    FROM clientes c
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE c.status WHEN 'pendente' THEN 0 ELSE 1 END, COALESCE(c.ultimo_contato, c.criado_em) DESC`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  const totais = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM clientes GROUP BY status').all();
  const apps = await env.DB.prepare('SELECT DISTINCT aplicacao FROM clientes ORDER BY aplicacao').all();
  const agora = new Date();
  return json({
    ok: true,
    clientes: results.map((c) => clientePublico(c, agora)),
    totais: Object.fromEntries(totais.results.map((r) => [r.status, r.n])),
    aplicacoes: [...new Set([APP_PADRAO, ...apps.results.map((r) => r.aplicacao)])],
  });
}

/** Nunca devolve o hash da senha do supervisor ao painel. */
function clientePublico(c, agora = new Date()) {
  const { sup_hash: supHash, ...resto } = c;
  return { ...resto, sup_propria: !!supHash, situacao: situacaoCliente(c, agora).status };
}

async function detalheCliente(cnpj, app, env) {
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const inst = await env.DB.prepare('SELECT * FROM instalacoes WHERE cnpj = ? AND aplicacao = ? ORDER BY ultimo_contato DESC')
    .bind(cnpj, app).all();
  const ev = await env.DB.prepare('SELECT * FROM eventos WHERE cnpj = ? AND aplicacao = ? ORDER BY id DESC LIMIT 100')
    .bind(cnpj, app).all();
  return json({
    ok: true,
    cliente: clientePublico(cli),
    instalacoes: inst.results,
    eventos: ev.results,
  });
}

async function obterConfig(env) {
  const padrao = await lerConfig(env, 'sup_padrao');
  return json({ ok: true, sup_padrao: { definida: !!padrao?.valor, atualizado_em: padrao?.atualizado_em || null } });
}

async function definirSupPadrao(request, env) {
  const body = await request.json().catch(() => ({}));
  const sup = supHashValido(body.sup);
  if (!sup) return json({ ok: false, error: 'Hash da senha inválido.' }, 400);
  const agora = agoraIso();
  await env.DB.prepare(
    `INSERT INTO config (chave, valor, atualizado_em) VALUES ('sup_padrao', ?, ?)
     ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`
  ).bind(JSON.stringify(sup), agora).run();
  await registrarEvento(env, '*', null, 'senha_supervisor', 'Senha padrão do supervisor alterada');
  return obterConfig(env);
}

/** body.sup = hash novo | null (volta a usar a senha padrão). */
async function definirSupCliente(cnpj, app, request, env) {
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  let valor = null;
  if (body.sup !== null) {
    const sup = supHashValido(body.sup);
    if (!sup) return json({ ok: false, error: 'Hash da senha inválido.' }, 400);
    valor = JSON.stringify(sup);
  }
  const agora = agoraIso();
  await env.DB.prepare('UPDATE clientes SET sup_hash = ?, sup_atualizado_em = ?, atualizado_em = ? WHERE cnpj = ? AND aplicacao = ?')
    .bind(valor, agora, agora, cnpj, app).run();
  await registrarEvento(env, cnpj, app, 'senha_supervisor', valor ? 'Senha própria do supervisor definida' : 'Voltou a usar a senha padrão');
  return detalheCliente(cnpj, app, env);
}

function camposEditaveis(body) {
  const out = {};
  if (body.status !== undefined) {
    if (!STATUS_VALIDOS.includes(body.status)) throw new Error('Status inválido.');
    out.status = body.status;
  }
  if (body.pago_ate !== undefined) {
    const d = dataValida(body.pago_ate);
    if (body.pago_ate && !d) throw new Error('Data "pago até" inválida (AAAA-MM-DD).');
    out.pago_ate = d;
  }
  if (body.mensagem !== undefined) out.mensagem = texto(body.mensagem, 300);
  if (body.observacao !== undefined) out.observacao = texto(body.observacao, 1000);
  if (body.razao !== undefined) out.razao = texto(body.razao, 120);
  if (body.fantasia !== undefined) out.fantasia = texto(body.fantasia, 120);
  return out;
}

async function criarCliente(request, env) {
  const body = await request.json().catch(() => ({}));
  const cnpj = soDigitos(body.cnpj);
  if (cnpj.length !== 14 && cnpj.length !== 11) return json({ ok: false, error: 'CNPJ/CPF inválido.' }, 400);
  const app = body.aplicacao === undefined || body.aplicacao === '' ? APP_PADRAO : nomeApp(body.aplicacao);
  if (!app) return json({ ok: false, error: 'Nome da aplicação inválido.' }, 400);
  if (await buscarCliente(env, cnpj, app)) return json({ ok: false, error: `Cliente já cadastrado no ${app}.` }, 409);
  let campos;
  try {
    campos = camposEditaveis({ status: 'liberado', ...body });
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }
  const agora = agoraIso();
  await env.DB.prepare(
    `INSERT INTO clientes (cnpj, aplicacao, razao, fantasia, status, pago_ate, mensagem, observacao, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(cnpj, app, campos.razao ?? null, campos.fantasia ?? null, campos.status, campos.pago_ate ?? null,
    campos.mensagem ?? null, campos.observacao ?? null, agora, agora).run();
  await registrarEvento(env, cnpj, app, 'cadastro_manual', `status ${campos.status}`);
  return detalheCliente(cnpj, app, env);
}

async function atualizarCliente(cnpj, app, request, env) {
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  let campos;
  try {
    campos = camposEditaveis(body);
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }
  const chaves = Object.keys(campos);
  if (!chaves.length) return detalheCliente(cnpj, app, env);
  await env.DB.prepare(
    `UPDATE clientes SET ${chaves.map((k) => `${k} = ?`).join(', ')}, atualizado_em = ? WHERE cnpj = ? AND aplicacao = ?`
  ).bind(...chaves.map((k) => campos[k]), agoraIso(), cnpj, app).run();
  if (campos.status && campos.status !== cli.status) {
    await registrarEvento(env, cnpj, app, 'status', `${cli.status} → ${campos.status}`);
  }
  const outros = chaves.filter((k) => k !== 'status' && (campos[k] ?? null) !== (cli[k] ?? null));
  if (outros.length) {
    await registrarEvento(env, cnpj, app, 'edicao', outros.map((k) => `${k}: ${campos[k] ?? '—'}`).join(' · '));
  }
  return detalheCliente(cnpj, app, env);
}

async function excluirCliente(cnpj, app, env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM eventos WHERE cnpj = ? AND aplicacao = ?').bind(cnpj, app),
    env.DB.prepare('DELETE FROM instalacoes WHERE cnpj = ? AND aplicacao = ?').bind(cnpj, app),
    env.DB.prepare('DELETE FROM clientes WHERE cnpj = ? AND aplicacao = ?').bind(cnpj, app),
  ]);
  return json({ ok: true });
}

/** Código para colar na tela de serviço quando o cliente está sem internet. */
async function licencaOffline(cnpj, app, request, env) {
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  const dias = Math.min(Math.max(parseInt(body.dias, 10) || 30, 1), 365);
  const nse = texto(body.nse, 40) || '';
  const emitido = new Date();
  const validoAte = new Date(emitido.getTime() + dias * 86400000);
  const licenca = await assinarLicenca(env, {
    tipo: 'offline',
    app,
    cnpj,
    nse,
    status: 'liberado',
    mensagem: null,
    pago_ate: cli.pago_ate || null,
    emitido_em: emitido.toISOString(),
    valido_ate: validoAte.toISOString(),
    sup: await supDoCliente(env, cli),
  });
  await registrarEvento(env, cnpj, app, 'licenca_offline', `${dias} dia(s)${nse ? ` · NSE ${nse}` : ''}`);
  const codigo = `MTL1.${b64url(enc.encode(JSON.stringify(licenca)))}`;
  return json({ ok: true, codigo, valido_ate: validoAte.toISOString() });
}

const ROTA_CLIENTE = new RegExp(`^/api/admin/clientes/(${APP_ROTA})/(\\d{11,14})(/licenca-offline|/supervisor)?$`);

async function rotaAdmin(request, env, url) {
  if (url.pathname === '/api/admin/login' && request.method === 'POST') return login(request, env);
  if (!(await tokenValido(env, request))) return json({ ok: false, error: 'Sessão expirada. Entre novamente.', code: 'AUTH' }, 401);

  if (url.pathname === '/api/admin/config' && request.method === 'GET') return obterConfig(env);
  if (url.pathname === '/api/admin/config/supervisor' && request.method === 'PUT') return definirSupPadrao(request, env);
  if (url.pathname === '/api/admin/clientes') {
    if (request.method === 'GET') return listarClientes(url, env);
    if (request.method === 'POST') return criarCliente(request, env);
  }
  const m = url.pathname.match(ROTA_CLIENTE);
  if (m) {
    const [, app, cnpj, sub] = m;
    if (sub === '/licenca-offline' && request.method === 'POST') return licencaOffline(cnpj, app, request, env);
    if (sub === '/supervisor' && request.method === 'PUT') return definirSupCliente(cnpj, app, request, env);
    if (!sub && request.method === 'GET') return detalheCliente(cnpj, app, env);
    if (!sub && request.method === 'PUT') return atualizarCliente(cnpj, app, request, env);
    if (!sub && request.method === 'DELETE') return excluirCliente(cnpj, app, env);
  }
  return json({ ok: false, error: 'Rota não encontrada.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/check' && request.method === 'POST') return await check(request, env);
      if (url.pathname.startsWith('/api/admin/')) return await rotaAdmin(request, env, url);
      if (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/') {
        return new Response(ADMIN_HTML, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Frame-Options': 'DENY',
          },
        });
      }
      return json({ ok: false, error: 'Rota não encontrada.' }, 404);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: 'Erro interno no servidor de licenças.' }, 500);
    }
  },
};
