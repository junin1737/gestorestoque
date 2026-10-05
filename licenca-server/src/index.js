import ADMIN_HTML from './admin.html';

const TOLERANCIA_OFFLINE_DIAS = 7;
const SESSAO_HORAS = 12;
const STATUS_VALIDOS = ['pendente', 'liberado', 'bloqueado'];
const MSG_PENDENTE = 'Cadastro recebido. Aguardando liberação da MT Automações — (34) 3674-1937.';
const MSG_BLOQUEADO = 'Acesso bloqueado. Entre em contato com a MT Automações — (34) 3674-1937.';

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

async function registrarEvento(env, cnpj, tipo, detalhe) {
  await env.DB.prepare('INSERT INTO eventos (cnpj, tipo, detalhe, criado_em) VALUES (?, ?, ?, ?)')
    .bind(cnpj, tipo, detalhe ? String(detalhe).slice(0, 500) : null, agoraIso())
    .run();
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
  const nse = texto(body.nse, 40) || '';
  const agora = agoraIso();
  const ip = request.headers.get('CF-Connecting-IP') || '';

  let cli = await env.DB.prepare('SELECT * FROM clientes WHERE cnpj = ?').bind(cnpj).first();
  if (!cli) {
    await env.DB.prepare(
      `INSERT INTO clientes (cnpj, razao, fantasia, status, criado_em, atualizado_em, ultimo_contato)
       VALUES (?, ?, ?, 'pendente', ?, ?, ?)`
    ).bind(cnpj, texto(body.razao, 120), texto(body.fantasia, 120), agora, agora, agora).run();
    await registrarEvento(env, cnpj, 'novo_cliente', `${texto(body.fantasia, 120) || ''} — ${texto(body.maquina, 80) || ''}`);
    cli = await env.DB.prepare('SELECT * FROM clientes WHERE cnpj = ?').bind(cnpj).first();
  } else {
    await env.DB.prepare(
      `UPDATE clientes SET ultimo_contato = ?,
         razao = COALESCE(?, razao), fantasia = COALESCE(?, fantasia)
       WHERE cnpj = ?`
    ).bind(agora, texto(body.razao, 120), texto(body.fantasia, 120), cnpj).run();
  }

  const inst = await env.DB.prepare('SELECT versao_gestor FROM instalacoes WHERE cnpj = ? AND nse = ?')
    .bind(cnpj, nse).first();
  const versao = texto(body.versao_gestor, 20);
  await env.DB.prepare(
    `INSERT INTO instalacoes (cnpj, nse, maquina, versao_gestor, versao_clipp, sistema, ip, primeiro_contato, ultimo_contato)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (cnpj, nse) DO UPDATE SET
       maquina = excluded.maquina, versao_gestor = excluded.versao_gestor, versao_clipp = excluded.versao_clipp,
       sistema = excluded.sistema, ip = excluded.ip, ultimo_contato = excluded.ultimo_contato`
  ).bind(cnpj, nse, texto(body.maquina, 80), versao, texto(body.versao_clipp, 20), texto(body.sistema, 20), ip, agora, agora).run();
  if (!inst) {
    await registrarEvento(env, cnpj, 'nova_instalacao', `NSE ${nse || '—'} · ${texto(body.maquina, 80) || ''} · v${versao || '?'}`);
  } else if (inst.versao_gestor && versao && inst.versao_gestor !== versao) {
    await registrarEvento(env, cnpj, 'versao', `${texto(body.maquina, 80) || nse}: ${inst.versao_gestor} → ${versao}`);
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
    cnpj,
    nse,
    status: sit.status,
    mensagem: sit.mensagem,
    pago_ate: cli.pago_ate || null,
    emitido_em: emitido.toISOString(),
    valido_ate: validoAte.toISOString(),
  });
  return json({ ok: true, licenca });
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
  const where = [];
  const params = [];
  if (STATUS_VALIDOS.includes(status)) {
    where.push('c.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(c.cnpj LIKE ? OR c.razao LIKE ? OR c.fantasia LIKE ? OR EXISTS (SELECT 1 FROM instalacoes i2 WHERE i2.cnpj = c.cnpj AND (i2.nse LIKE ? OR i2.maquina LIKE ?)))');
    const like = `%${q}%`;
    const likeCnpj = `%${soDigitos(q) || q}%`;
    params.push(likeCnpj, like, like, like, like);
  }
  const sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM instalacoes i WHERE i.cnpj = c.cnpj) AS instalacoes,
      (SELECT i.versao_gestor FROM instalacoes i WHERE i.cnpj = c.cnpj ORDER BY i.ultimo_contato DESC LIMIT 1) AS versao_gestor,
      (SELECT i.maquina FROM instalacoes i WHERE i.cnpj = c.cnpj ORDER BY i.ultimo_contato DESC LIMIT 1) AS maquina
    FROM clientes c
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE c.status WHEN 'pendente' THEN 0 ELSE 1 END, COALESCE(c.ultimo_contato, c.criado_em) DESC`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  const totais = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM clientes GROUP BY status').all();
  const agora = new Date();
  return json({
    ok: true,
    clientes: results.map((c) => ({ ...c, situacao: situacaoCliente(c, agora).status })),
    totais: Object.fromEntries(totais.results.map((r) => [r.status, r.n])),
  });
}

async function detalheCliente(cnpj, env) {
  const cli = await env.DB.prepare('SELECT * FROM clientes WHERE cnpj = ?').bind(cnpj).first();
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const inst = await env.DB.prepare('SELECT * FROM instalacoes WHERE cnpj = ? ORDER BY ultimo_contato DESC').bind(cnpj).all();
  const ev = await env.DB.prepare('SELECT * FROM eventos WHERE cnpj = ? ORDER BY id DESC LIMIT 100').bind(cnpj).all();
  return json({
    ok: true,
    cliente: { ...cli, situacao: situacaoCliente(cli).status },
    instalacoes: inst.results,
    eventos: ev.results,
  });
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
  const existe = await env.DB.prepare('SELECT cnpj FROM clientes WHERE cnpj = ?').bind(cnpj).first();
  if (existe) return json({ ok: false, error: 'Cliente já cadastrado.' }, 409);
  let campos;
  try {
    campos = camposEditaveis({ status: 'liberado', ...body });
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }
  const agora = agoraIso();
  await env.DB.prepare(
    `INSERT INTO clientes (cnpj, razao, fantasia, status, pago_ate, mensagem, observacao, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(cnpj, campos.razao ?? null, campos.fantasia ?? null, campos.status, campos.pago_ate ?? null,
    campos.mensagem ?? null, campos.observacao ?? null, agora, agora).run();
  await registrarEvento(env, cnpj, 'cadastro_manual', `status ${campos.status}`);
  return detalheCliente(cnpj, env);
}

async function atualizarCliente(cnpj, request, env) {
  const cli = await env.DB.prepare('SELECT * FROM clientes WHERE cnpj = ?').bind(cnpj).first();
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  let campos;
  try {
    campos = camposEditaveis(body);
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }
  const chaves = Object.keys(campos);
  if (!chaves.length) return detalheCliente(cnpj, env);
  await env.DB.prepare(
    `UPDATE clientes SET ${chaves.map((k) => `${k} = ?`).join(', ')}, atualizado_em = ? WHERE cnpj = ?`
  ).bind(...chaves.map((k) => campos[k]), agoraIso(), cnpj).run();
  if (campos.status && campos.status !== cli.status) {
    await registrarEvento(env, cnpj, 'status', `${cli.status} → ${campos.status}`);
  }
  const outros = chaves.filter((k) => k !== 'status' && (campos[k] ?? null) !== (cli[k] ?? null));
  if (outros.length) {
    await registrarEvento(env, cnpj, 'edicao', outros.map((k) => `${k}: ${campos[k] ?? '—'}`).join(' · '));
  }
  return detalheCliente(cnpj, env);
}

async function excluirCliente(cnpj, env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM eventos WHERE cnpj = ?').bind(cnpj),
    env.DB.prepare('DELETE FROM instalacoes WHERE cnpj = ?').bind(cnpj),
    env.DB.prepare('DELETE FROM clientes WHERE cnpj = ?').bind(cnpj),
  ]);
  return json({ ok: true });
}

/** Código para colar na tela de serviço quando o cliente está sem internet. */
async function licencaOffline(cnpj, request, env) {
  const cli = await env.DB.prepare('SELECT * FROM clientes WHERE cnpj = ?').bind(cnpj).first();
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  const dias = Math.min(Math.max(parseInt(body.dias, 10) || 30, 1), 365);
  const nse = texto(body.nse, 40) || '';
  const emitido = new Date();
  const validoAte = new Date(emitido.getTime() + dias * 86400000);
  const licenca = await assinarLicenca(env, {
    tipo: 'offline',
    cnpj,
    nse,
    status: 'liberado',
    mensagem: null,
    pago_ate: cli.pago_ate || null,
    emitido_em: emitido.toISOString(),
    valido_ate: validoAte.toISOString(),
  });
  await registrarEvento(env, cnpj, 'licenca_offline', `${dias} dia(s)${nse ? ` · NSE ${nse}` : ''}`);
  const codigo = `MTL1.${b64url(enc.encode(JSON.stringify(licenca)))}`;
  return json({ ok: true, codigo, valido_ate: validoAte.toISOString() });
}

async function rotaAdmin(request, env, url) {
  if (url.pathname === '/api/admin/login' && request.method === 'POST') return login(request, env);
  if (!(await tokenValido(env, request))) return json({ ok: false, error: 'Sessão expirada. Entre novamente.', code: 'AUTH' }, 401);

  if (url.pathname === '/api/admin/clientes') {
    if (request.method === 'GET') return listarClientes(url, env);
    if (request.method === 'POST') return criarCliente(request, env);
  }
  const m = url.pathname.match(/^\/api\/admin\/clientes\/(\d{11,14})(\/licenca-offline)?$/);
  if (m) {
    const cnpj = m[1];
    if (m[2] && request.method === 'POST') return licencaOffline(cnpj, request, env);
    if (!m[2] && request.method === 'GET') return detalheCliente(cnpj, env);
    if (!m[2] && request.method === 'PUT') return atualizarCliente(cnpj, request, env);
    if (!m[2] && request.method === 'DELETE') return excluirCliente(cnpj, env);
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
