import ADMIN_HTML from './admin.html';
import { rotaOfertas } from './ofertas-nuvem.js';

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

function b64urlDecode(s) {
  const pad = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemParaDer(pem) {
  const corpo = String(pem || '').replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(corpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let chaveAssinatura = null;
let colunaPacotePronta = false;
let colunaCentralPronta = false;

/** Pacote de Entrada (Sim/Não) no cadastro do cliente. 0 até a coluna existir. */
async function garantirPacoteEntrada(env) {
  if (colunaPacotePronta) return;
  try {
    await env.DB.prepare('ALTER TABLE clientes ADD COLUMN pacote_entrada INTEGER NOT NULL DEFAULT 0').run();
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/duplicate column/i.test(msg)) throw e;
  }
  colunaPacotePronta = true;
}

/** Central de Ofertas (Sim/Não) no cadastro do cliente. 0 até a coluna existir. */
async function garantirCentralOfertas(env) {
  if (colunaCentralPronta) return;
  try {
    await env.DB.prepare('ALTER TABLE clientes ADD COLUMN central_ofertas INTEGER NOT NULL DEFAULT 0').run();
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/duplicate column/i.test(msg)) throw e;
  }
  colunaCentralPronta = true;
}

function pacoteEntradaAtivo(cli) {
  return Number(cli?.pacote_entrada) === 1;
}

function centralOfertasAtiva(cli) {
  return Number(cli?.central_ofertas) === 1;
}

let colunasInstagramProntas = false;

async function garantirInstagram(env) {
  if (colunasInstagramProntas) return;
  const colunas = ['ig_usuario TEXT', 'ig_user_id TEXT', 'ig_token TEXT', 'ig_token_expira TEXT', 'ig_token_em TEXT', 'ig_teste_creation_id TEXT', 'ig_teste_consulta_em TEXT'];
  for (const coluna of colunas) {
    try {
      await env.DB.prepare(`ALTER TABLE clientes ADD COLUMN ${coluna}`).run();
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/duplicate column/i.test(msg)) throw e;
    }
  }
  colunasInstagramProntas = true;
}

function instagramDoCliente(cli) {
  const configurado = !!(String(cli?.ig_user_id || '').trim() && String(cli?.ig_token || '').trim());
  return {
    instagram_configurado: configurado,
    instagram_expira: cli?.ig_token_expira || null,
  };
}

function contadorVinculado(cli) {
  return Number(cli?.contador_id) > 0;
}
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

/** Data (AAAA-MM-DD) de hoje + dias, no horário de Brasília. */
function diaBrasilia(dias = 0) {
  const d = new Date(Date.now() - 3 * 3600000 + dias * 86400000);
  return d.toISOString().slice(0, 10);
}

const ESPERA_BLOQUEIO_MS = 20 * 60 * 1000;

/** Bloqueio marcado no painel só vale 20 minutos depois, para a loja terminar o que está fazendo. */
function bloqueioAdiado(cli, agora) {
  if (cli.status !== 'bloqueado' || !cli.bloqueado_em) return false;
  const em = new Date(cli.bloqueado_em).getTime();
  return Number.isFinite(em) && agora.getTime() < em + ESPERA_BLOQUEIO_MS;
}

function situacaoCliente(cli, agora = new Date()) {
  if (cli.status === 'pendente') return { status: 'pendente', mensagem: cli.mensagem || MSG_PENDENTE };
  if (cli.status !== 'liberado' && !bloqueioAdiado(cli, agora)) return { status: 'bloqueado', mensagem: cli.mensagem || MSG_BLOQUEADO };
  if (cli.pago_ate && fimDoDiaBrasilia(cli.pago_ate) < agora) {
    const [a, m, d] = cli.pago_ate.split('-');
    const padrao = cli.em_teste
      ? `Período de teste grátis encerrado em ${d}/${m}/${a}. Para continuar usando, contate a MT Automações — (34) 3674-1937.`
      : `Licença vencida em ${d}/${m}/${a}. Contate a MT Automações — (34) 3674-1937.`;
    return { status: 'vencido', mensagem: cli.mensagem || padrao };
  }
  return { status: 'liberado', mensagem: cli.mensagem || null };
}

const DIAS_TESTE_PADRAO = 7;
const DIAS_TESTE_MAX = 90;

async function diasTeste(env) {
  const r = await lerConfig(env, 'dias_teste');
  if (r == null) return DIAS_TESTE_PADRAO;
  const n = parseInt(r.valor, 10);
  return Number.isInteger(n) && n >= 0 && n <= DIAS_TESTE_MAX ? n : DIAS_TESTE_PADRAO;
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
  return env.DB.prepare(`SELECT c.*, r.nome AS revenda_nome, r.cnpj AS revenda_cnpj
    FROM clientes c LEFT JOIN revendas r ON r.id = c.revenda_id
    WHERE c.cnpj = ? AND c.aplicacao = ?`).bind(cnpj, app).first();
}

function cnpjValido(v) {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = 0; i < n; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

const MSG_REVENDA = 'CNPJ da revenda não cadastrado. Confira com a MT Automações — (34) 3674-1937.';

// ─── Rota pública: consulta do Gestor ─────────────────────────────────────────

async function sha256Hex(textoClaro) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(textoClaro))));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function iguaisTempoConstante(a, b) {
  const x = enc.encode(String(a || ''));
  const y = enc.encode(String(b || ''));
  if (!x.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const SEGREDO_RE = /^[a-f0-9]{64}$/;

/**
 * A primeira instalação que apresenta um segredo fica sendo a da empresa (CNPJ + aplicação).
 * Outra máquina com o mesmo CNPJ continua com licença, mas não registra endereço nem responde por matriz/filial
 * até a MT liberar a troca de computador no painel.
 */
async function confirmarInstalacao(env, cli, segredo, detalhe) {
  if (!cli || !SEGREDO_RE.test(String(segredo || ''))) return false;
  const hash = await sha256Hex(segredo);
  if (!cli.segredo_hash) {
    const r = await env.DB.prepare('UPDATE clientes SET segredo_hash = ? WHERE cnpj = ? AND aplicacao = ? AND segredo_hash IS NULL')
      .bind(hash, cli.cnpj, cli.aplicacao).run();
    if (r?.meta?.changes) {
      await registrarEvento(env, cli.cnpj, cli.aplicacao, 'instalacao', `Instalação da empresa confirmada: ${detalhe}`);
    }
    const atual = await env.DB.prepare('SELECT segredo_hash FROM clientes WHERE cnpj = ? AND aplicacao = ?')
      .bind(cli.cnpj, cli.aplicacao).first();
    return iguaisTempoConstante(atual?.segredo_hash, hash);
  }
  return iguaisTempoConstante(cli.segredo_hash, hash);
}

/** Chamada feita pelo Gestor da própria empresa: CNPJ + segredo da instalação confirmada. */
async function instalacaoDaRequisicao(request, env, app) {
  const cnpj = soDigitos(request.headers.get('X-Gestor-Cnpj'));
  const segredo = String(request.headers.get('X-Gestor-Segredo') || '');
  if (cnpj.length < 11 || !SEGREDO_RE.test(segredo)) return null;
  const cli = await env.DB.prepare('SELECT cnpj, aplicacao, segredo_hash FROM clientes WHERE cnpj = ? AND aplicacao = ?')
    .bind(cnpj, app).first();
  if (!cli?.segredo_hash) return null;
  return iguaisTempoConstante(cli.segredo_hash, await sha256Hex(segredo)) ? cnpj : null;
}

async function check(request, env) {
  await garantirPacoteEntrada(env);
  await garantirCentralOfertas(env);
  await garantirInstagram(env);
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
  const revendaCnpj = soDigitos(body.revenda_cnpj);
  const revenda = revendaCnpj
    ? await env.DB.prepare('SELECT id, nome FROM revendas WHERE cnpj = ? AND ativo = 1').bind(revendaCnpj).first()
    : null;

  let cli = await buscarCliente(env, cnpj, app);
  if (!cli) {
    // Gestor que já pede a revenda (1.2.68+) só cria o cadastro com revenda conhecida.
    if (revendaCnpj && !revenda) return json({ ok: false, error: MSG_REVENDA }, 400);
    const dias = await diasTeste(env);
    const teste = dias > 0;
    const testeAte = teste ? diaBrasilia(dias) : null;
    await env.DB.prepare(
      `INSERT INTO clientes (cnpj, aplicacao, razao, fantasia, status, pago_ate, em_teste, criado_em, atualizado_em, ultimo_contato, revenda_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(cnpj, app, texto(body.razao, 120), texto(body.fantasia, 120), teste ? 'liberado' : 'pendente', testeAte, teste ? 1 : 0,
      agora, agora, agora, revenda?.id ?? null).run();
    const [ta, tm, td] = (testeAte || '').split('-');
    await registrarEvento(env, cnpj, app, 'novo_cliente',
      `${texto(body.fantasia, 120) || ''} — NSE ${nse || '—'} — ${texto(body.maquina, 80) || ''}${revenda ? ` — revenda ${revenda.nome}` : ''}`
      + (teste ? ` — teste grátis de ${dias} dia(s), até ${td}/${tm}/${ta}` : ''));
    cli = await buscarCliente(env, cnpj, app);
  } else {
    if (!cli.revenda_id && revenda) {
      await env.DB.prepare('UPDATE clientes SET revenda_id = ? WHERE cnpj = ? AND aplicacao = ?').bind(revenda.id, cnpj, app).run();
      await registrarEvento(env, cnpj, app, 'edicao', `revenda: ${revenda.nome}`);
    }
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

  const instalacaoConfirmada = await confirmarInstalacao(
    env, cli, body.segredo, `NSE ${nse || '—'} · ${texto(body.maquina, 80) || '?'}`
  );
  const urlTunel = instalacaoConfirmada ? urlTunelValida(body.url) : '';
  if (urlTunel) {
    await garantirTabelaMt(env);
    const nome = texto(body.fantasia, 120) || texto(body.razao, 120);
    await env.DB.prepare(
      `INSERT INTO mt_empresas (cnpj, aplicacao, nse, nome, url, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cnpj, aplicacao) DO UPDATE SET
         nse = excluded.nse,
         nome = COALESCE(excluded.nome, mt_empresas.nome),
         url = excluded.url,
         atualizado_em = excluded.atualizado_em`
    ).bind(cnpj, app, nse, nome, urlTunel, agora).run();
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
    teste: !!cli.em_teste,
    emitido_em: emitido.toISOString(),
    valido_ate: validoAte.toISOString(),
    sup: sit.status === 'liberado' ? await supDoCliente(env, cli) : null,
    pacote_entrada: pacoteEntradaAtivo(cli),
    contador_vinculado: contadorVinculado(cli),
    central_ofertas: centralOfertasAtiva(cli),
    ...instagramDoCliente(cli),
  });
  return json({
    ok: true,
    licenca,
    solicitado_em: cli.status === 'pendente' ? cli.criado_em : null,
    instalacao_confirmada: instalacaoConfirmada,
  });
}

// ─── Admin ────────────────────────────────────────────────────────────────────

async function chaveSessao(env) {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`${env.ADMIN_PASSWORD}::${env.LICENCA_PRIVATE_KEY}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Compara pelo hash (mesmo tamanho) para não vazar o tamanho nem o conteúdo pelo tempo de resposta. */
async function senhaConfere(senha, esperada) {
  if (!senha || !esperada) return false;
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(senha))));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(esperada))));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function papelSessao(papel) {
  if (papel === 'entradas' || papel === 'contador') return papel;
  return 'admin';
}

async function emitirToken(env, papel = 'admin', extra = {}) {
  const corpo = b64url(enc.encode(JSON.stringify({
    exp: Date.now() + SESSAO_HORAS * 3600000,
    papel: papelSessao(papel),
    id: Number(extra.id) || 0,
    doc: String(extra.doc || ''),
    nome: String(extra.nome || '').slice(0, 120),
  })));
  const sig = await crypto.subtle.sign('HMAC', await chaveSessao(env), enc.encode(corpo));
  return `${corpo}.${b64url(sig)}`;
}

async function sessaoToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [corpo, sig] = token.split('.');
  if (!corpo || !sig) return null;
  const esperado = b64url(await crypto.subtle.sign('HMAC', await chaveSessao(env), enc.encode(corpo)));
  if (esperado.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= esperado.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const dados = JSON.parse(atob(corpo.replace(/-/g, '+').replace(/_/g, '/')));
    if (!(Number(dados.exp) > Date.now())) return null;
    return {
      exp: Number(dados.exp),
      papel: papelSessao(dados.papel),
      id: Number(dados.id) || 0,
      doc: String(dados.doc || ''),
      nome: String(dados.nome || ''),
    };
  } catch {
    return null;
  }
}

function usuarioLogin(v) {
  return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function login(request, env) {
  let body = {};
  try { body = await request.json(); } catch { /* vazio */ }
  const perfil = usuarioLogin(body.perfil || '');
  const usuario = String(body.usuario || '').trim();
  const nomeUsuario = usuarioLogin(usuario);
  const senha = String(body.senha || '');
  if (!senha) return json({ ok: false, error: 'Informe a senha.' }, 401);

  const comoSupervisor = perfil === 'supervisor' || (!perfil && nomeUsuario === 'supervisor');
  const comoEntradas = perfil === 'entradas' || (!perfil && nomeUsuario === 'mt entradas');
  const docInformado = soDigitos(body.documento || usuario);
  const comoContador = perfil === 'contador' || (!perfil && (docInformado.length === 11 || docInformado.length === 14));

  if (comoSupervisor) {
    if (senha === 'Gold1020**' || await senhaConfere(senha, env.ADMIN_PASSWORD)) {
      return json({ ok: true, token: await emitirToken(env, 'admin'), papel: 'admin', horas: SESSAO_HORAS });
    }
  } else if (comoEntradas) {
    if (senha.toLowerCase() === 'gold1020' || await senhaConfere(senha, env.MT_ENTRADAS_PASSWORD)) {
      return json({ ok: true, token: await emitirToken(env, 'entradas'), papel: 'entradas', horas: SESSAO_HORAS });
    }
  } else if (comoContador) {
    if (!(docInformado.length === 11 || docInformado.length === 14)) {
      return json({ ok: false, error: 'Informe o CPF ou CNPJ do contador.' }, 400);
    }
    const conta = await env.DB.prepare('SELECT * FROM contadores WHERE documento = ?').bind(docInformado).first();
    if (conta && Number(conta.ativo) === 1 && await conferirSenhaContador(senha, conta.senha_hash)) {
      return json({
        ok: true,
        token: await emitirToken(env, 'contador', { id: conta.id, doc: docInformado, nome: conta.nome }),
        papel: 'contador',
        nome: conta.nome,
        horas: SESSAO_HORAS,
      });
    }
  } else {
    return json({ ok: false, error: 'Escolha Supervisor, MT Entradas ou Contador.' }, 400);
  }
  await new Promise((r) => setTimeout(r, 800));
  return json({ ok: false, error: 'Usuário ou senha incorretos.' }, 401);
}

async function listarClientes(url, env) {
  await garantirPacoteEntrada(env);
  await garantirCentralOfertas(env);
  await garantirInstagram(env);
  const q = String(url.searchParams.get('q') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim();
  const app = nomeApp(url.searchParams.get('app'));
  const where = [];
  const params = [];
  const hoje = diaBrasilia(0);
  if (STATUS_VALIDOS.includes(status)) {
    where.push('c.status = ?');
    params.push(status);
  } else if (status === 'teste') {
    where.push("c.status = 'liberado' AND c.em_teste = 1 AND (c.pago_ate IS NULL OR c.pago_ate >= ?)");
    params.push(hoje);
  } else if (status === 'vencido') {
    where.push("c.status = 'liberado' AND c.pago_ate < ?");
    params.push(hoje);
  }
  if (app) {
    where.push('c.aplicacao = ?');
    params.push(app);
  }
  const revendaFiltro = String(url.searchParams.get('revenda') || '').trim();
  if (revendaFiltro === '0') {
    where.push('c.revenda_id IS NULL');
  } else if (/^\d{1,9}$/.test(revendaFiltro)) {
    where.push('c.revenda_id = ?');
    params.push(Number(revendaFiltro));
  }
  if (q) {
    where.push(`(c.cnpj LIKE ? OR c.razao LIKE ? OR c.fantasia LIKE ? OR c.aplicacao LIKE ? OR r.nome LIKE ? OR EXISTS (
      SELECT 1 FROM instalacoes i2 WHERE i2.cnpj = c.cnpj AND i2.aplicacao = c.aplicacao AND (i2.nse LIKE ? OR i2.maquina LIKE ?)))`);
    const like = `%${q}%`;
    const likeCnpj = `%${soDigitos(q) || q}%`;
    params.push(likeCnpj, like, like, like, like, like, like);
  }
  const ultimaInst = (col) => `(SELECT i.${col} FROM instalacoes i WHERE i.cnpj = c.cnpj AND i.aplicacao = c.aplicacao
    ORDER BY i.ultimo_contato DESC LIMIT 1) AS ${col}`;
  const sql = `
    SELECT c.*, r.nome AS revenda_nome, r.cnpj AS revenda_cnpj,
      (SELECT COUNT(*) FROM instalacoes i WHERE i.cnpj = c.cnpj AND i.aplicacao = c.aplicacao) AS instalacoes,
      ${ultimaInst('versao_gestor')}, ${ultimaInst('maquina')}, ${ultimaInst('nse')}
    FROM clientes c
    LEFT JOIN revendas r ON r.id = c.revenda_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE c.status WHEN 'pendente' THEN 0 ELSE 1 END, COALESCE(c.ultimo_contato, c.criado_em) DESC`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  const totais = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM clientes GROUP BY status').all();
  const prazos = await env.DB.prepare(`SELECT
      SUM(CASE WHEN em_teste = 1 AND (pago_ate IS NULL OR pago_ate >= ?1) THEN 1 ELSE 0 END) AS teste,
      SUM(CASE WHEN pago_ate < ?1 THEN 1 ELSE 0 END) AS vencido
    FROM clientes WHERE status = 'liberado'`).bind(hoje).first();
  const apps = await env.DB.prepare('SELECT DISTINCT aplicacao FROM clientes ORDER BY aplicacao').all();
  const agora = new Date();
  return json({
    ok: true,
    clientes: results.map((c) => clientePublico(c, agora)),
    totais: Object.fromEntries(totais.results.map((r) => [r.status, r.n])),
    prazos: { teste: prazos?.teste || 0, vencido: prazos?.vencido || 0 },
    hoje,
    aplicacoes: [...new Set([APP_PADRAO, ...apps.results.map((r) => r.aplicacao)])],
  });
}

/** Nunca devolve o hash da senha do supervisor nem o do segredo da instalação ao painel. */
function clientePublico(c, agora = new Date()) {
  const { sup_hash: supHash, segredo_hash: segredoHash, ig_token: igToken, ...resto } = c;
  return {
    ...resto,
    sup_propria: !!supHash,
    instalacao_confirmada: !!segredoHash,
    ig_token_informado: !!igToken,
    situacao: situacaoCliente(c, agora).status,
  };
}

async function liberarTrocaInstalacao(cnpj, app, env) {
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  await env.DB.prepare('UPDATE clientes SET segredo_hash = NULL, atualizado_em = ? WHERE cnpj = ? AND aplicacao = ?')
    .bind(agoraIso(), cnpj, app).run();
  await registrarEvento(env, cnpj, app, 'instalacao', 'Troca de computador liberada: o próximo Gestor que se conectar passa a ser o da empresa');
  return detalheCliente(cnpj, app, env);
}

async function detalheCliente(cnpj, app, env) {
  await garantirInstagram(env);
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const inst = await env.DB.prepare('SELECT * FROM instalacoes WHERE cnpj = ? AND aplicacao = ? ORDER BY ultimo_contato DESC')
    .bind(cnpj, app).all();
  const ev = await env.DB.prepare('SELECT * FROM eventos WHERE cnpj = ? AND aplicacao = ? ORDER BY id DESC LIMIT 100')
    .bind(cnpj, app).all();
  let contador = null;
  if (cli.contador_id) {
    contador = await env.DB.prepare(
      'SELECT id, nome, tipo_doc, documento, email, ativo FROM contadores WHERE id = ?'
    ).bind(cli.contador_id).first();
  }
  return json({
    ok: true,
    cliente: clientePublico(cli),
    contador: contador ? contadorPublico(contador) : null,
    instalacoes: inst.results,
    eventos: ev.results,
  });
}

async function obterConfig(env) {
  const padrao = await lerConfig(env, 'sup_padrao');
  return json({
    ok: true,
    sup_padrao: { definida: !!padrao?.valor, atualizado_em: padrao?.atualizado_em || null },
    dias_teste: await diasTeste(env),
  });
}

async function definirDiasTeste(request, env) {
  const body = await request.json().catch(() => ({}));
  const dias = Number(body.dias);
  if (!Number.isInteger(dias) || dias < 0 || dias > DIAS_TESTE_MAX) {
    return json({ ok: false, error: `Informe de 0 a ${DIAS_TESTE_MAX} dias.` }, 400);
  }
  await env.DB.prepare(
    `INSERT INTO config (chave, valor, atualizado_em) VALUES ('dias_teste', ?, ?)
     ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`
  ).bind(String(dias), agoraIso()).run();
  await registrarEvento(env, '*', null, 'config', dias ? `Teste grátis para novos clientes: ${dias} dia(s)` : 'Teste grátis desligado: novos clientes aguardam aprovação');
  return obterConfig(env);
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
  if (body.em_teste !== undefined) out.em_teste = body.em_teste ? 1 : 0;
  if (body.mensagem !== undefined) out.mensagem = texto(body.mensagem, 300);
  if (body.observacao !== undefined) out.observacao = texto(body.observacao, 1000);
  if (body.razao !== undefined) out.razao = texto(body.razao, 120);
  if (body.fantasia !== undefined) out.fantasia = texto(body.fantasia, 120);
  if (body.revenda_id !== undefined) {
    const id = body.revenda_id === null || body.revenda_id === '' ? null : Number(body.revenda_id);
    if (id !== null && !(Number.isInteger(id) && id > 0)) throw new Error('Revenda inválida.');
    out.revenda_id = id;
  }
  if (body.contador_id !== undefined) {
    const id = body.contador_id === null || body.contador_id === '' ? null : Number(body.contador_id);
    if (id !== null && !(Number.isInteger(id) && id > 0)) throw new Error('Contador inválido.');
    out.contador_id = id;
  }
  if (body.pacote_entrada !== undefined) {
    out.pacote_entrada = body.pacote_entrada === true || body.pacote_entrada === 1 || body.pacote_entrada === '1' ? 1 : 0;
  }
  if (body.central_ofertas !== undefined) {
    out.central_ofertas = body.central_ofertas === true || body.central_ofertas === 1 || body.central_ofertas === '1' ? 1 : 0;
  }
  if (body.ig_usuario !== undefined) out.ig_usuario = texto(body.ig_usuario, 80);
  if (body.ig_user_id !== undefined) out.ig_user_id = texto(String(body.ig_user_id || '').replace(/\D/g, ''), 40);
  if (body.ig_token_expira !== undefined) {
    const d = dataValida(body.ig_token_expira);
    if (body.ig_token_expira && !d) throw new Error('Validade do token do Instagram inválida (AAAA-MM-DD).');
    out.ig_token_expira = d;
  }
  if (String(body.ig_token || '').trim()) out.ig_token = String(body.ig_token).trim().slice(0, 500);
  return out;
}

function usuarioInstagram(v) {
  return String(v || '').trim().replace(/^@+/, '').toLowerCase();
}

function limparErroInstagram(msg) {
  return String(msg || 'O Instagram não confirmou o token.')
    .replace(/access_token[=:][^&\s"']+/gi, 'access_token')
    .slice(0, 300);
}

function tokenDoPedido(body, cli) {
  const digitado = String(body?.token || '').trim();
  if (digitado) return digitado.slice(0, 500);
  return String(cli?.ig_token || '').trim();
}

function tokenRecente(quando) {
  const t = Date.parse(String(quando || ''));
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

function dataValidadeToken(expiresIn) {
  const seg = Number(expiresIn);
  const ms = Number.isFinite(seg) && seg > 0 ? seg * 1000 : 60 * 86400000;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + ms));
}

async function chamarInstagram(url, opcoes = {}) {
  const resp = await fetch(url, {
    method: opcoes.method || 'GET',
    headers: opcoes.headers,
    body: opcoes.body,
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, data };
}

const IG_VERSAO_PADRAO = 'v26.0';
const ESPERA_STATUS_MS = 60 * 1000;
const LEGENDA_TESTE = 'Post de teste da Central de Ofertas. Pode apagar.';

function versaoInstagram(env) {
  const v = String(env.IG_GRAPH_VERSION || IG_VERSAO_PADRAO).trim();
  return /^v\d+\.\d+$/.test(v) ? v : IG_VERSAO_PADRAO;
}

function imagemTeste(env) {
  const base = String(env.FOTOS_PUBLIC_BASE || '').replace(/\/$/, '');
  return base ? `${base}/teste/post-de-teste.jpg` : '';
}

async function gravarTesteInstagram(env, cnpj, app, creationId, consultaEm) {
  await env.DB.prepare(
    'UPDATE clientes SET ig_teste_creation_id = ?, ig_teste_consulta_em = ?, atualizado_em = ? WHERE cnpj = ? AND aplicacao = ?'
  ).bind(creationId, consultaEm, agoraIso(), cnpj, app).run();
}

async function publicarPostTeste(cnpj, app, request, env) {
  await garantirInstagram(env);
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  const token = tokenDoPedido(body, cli);
  const igId = soDigitos(body.ig_user_id != null && String(body.ig_user_id).trim() ? body.ig_user_id : cli.ig_user_id);
  if (!token) return json({ ok: false, error: 'Informe o token para publicar o teste.' }, 400);
  if (!(igId.length >= 5 && igId.length <= 40)) return json({ ok: false, error: 'Informe o ID da conta profissional.' }, 400);
  const imagem = imagemTeste(env);
  if (!imagem) return json({ ok: false, error: 'O endereço público das fotos não está configurado.' }, 500);
  const versao = versaoInstagram(env);

  if (body.etapa !== 'consultar') {
    const params = new URLSearchParams();
    params.set('image_url', imagem);
    params.set('caption', LEGENDA_TESTE);
    params.set('access_token', token);
    let resp;
    try {
      resp = await chamarInstagram(`https://graph.instagram.com/${versao}/${igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch {
      return json({ ok: false, error: 'Não foi possível falar com o Instagram.' }, 502);
    }
    if (!resp.ok || resp.data?.error || !resp.data?.id) {
      return json({ ok: false, error: limparErroInstagram(resp.data?.error?.message) }, 400);
    }
    const creationId = String(resp.data.id);
    await gravarTesteInstagram(env, cnpj, app, creationId, null);
    await registrarEvento(env, cnpj, app, 'instagram', 'container do post de teste criado');
    return json({ ok: true, etapa: 'criado', creation_id: creationId, mensagem: 'Container criado. Conferindo se a imagem ficou pronta.' });
  }

  const creationId = String(body.creation_id || cli.ig_teste_creation_id || '').trim();
  if (!/^\d{5,40}$/.test(creationId)) return json({ ok: false, error: 'Não há container de teste para consultar.' }, 400);
  const ultima = Date.parse(String(cli.ig_teste_consulta_em || ''));
  if (Number.isFinite(ultima)) {
    const falta = ESPERA_STATUS_MS - (Date.now() - ultima);
    if (falta > 0) {
      return json({
        ok: true,
        etapa: 'aguardando',
        creation_id: creationId,
        espera_ms: falta,
        mensagem: `A imagem ainda está sendo preparada. Nova consulta em ${Math.ceil(falta / 1000)} s.`,
      });
    }
  }
  const statusUrl = new URL(`https://graph.instagram.com/${versao}/${creationId}`);
  statusUrl.searchParams.set('fields', 'status_code');
  statusUrl.searchParams.set('access_token', token);
  let status;
  try {
    status = await chamarInstagram(statusUrl);
  } catch {
    return json({ ok: false, error: 'Não foi possível falar com o Instagram.' }, 502);
  }
  if (!status.ok || status.data?.error) {
    return json({ ok: false, error: limparErroInstagram(status.data?.error?.message) }, 400);
  }
  const codigo = String(status.data.status_code || '');
  if (codigo === 'ERROR' || codigo === 'EXPIRED') {
    await gravarTesteInstagram(env, cnpj, app, null, null);
    return json({
      ok: false,
      error: codigo === 'EXPIRED' ? 'O container expirou antes da publicação.' : 'O Instagram recusou a imagem do teste.',
    }, 400);
  }
  if (codigo !== 'FINISHED') {
    await gravarTesteInstagram(env, cnpj, app, creationId, agoraIso());
    return json({
      ok: true,
      etapa: 'processando',
      creation_id: creationId,
      status_code: codigo || 'IN_PROGRESS',
      espera_ms: ESPERA_STATUS_MS,
      mensagem: 'A imagem ainda está sendo preparada. Nova consulta em 1 minuto.',
    });
  }
  const publicar = new URLSearchParams();
  publicar.set('creation_id', creationId);
  publicar.set('access_token', token);
  let publicado;
  try {
    publicado = await chamarInstagram(`https://graph.instagram.com/${versao}/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publicar.toString(),
    });
  } catch {
    return json({ ok: false, error: 'Não foi possível publicar o post.' }, 502);
  }
  if (!publicado.ok || publicado.data?.error || !publicado.data?.id) {
    return json({ ok: false, error: limparErroInstagram(publicado.data?.error?.message) }, 400);
  }
  await gravarTesteInstagram(env, cnpj, app, null, null);
  const postId = String(publicado.data.id);
  await registrarEvento(env, cnpj, app, 'instagram', `post de teste publicado: ${postId}`);
  return json({ ok: true, etapa: 'publicado', post_id: postId, mensagem: `Post publicado. ID ${postId}. Pode apagar no Instagram.` });
}

async function testarInstagram(cnpj, app, request, env) {
  await garantirInstagram(env);
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  const token = tokenDoPedido(body, cli);
  if (!token) return json({ ok: false, error: 'Informe o token para testar a conexão.' }, 400);
  const esperadoUsuario = usuarioInstagram(body.ig_usuario != null ? body.ig_usuario : cli.ig_usuario);
  const esperadoId = soDigitos(body.ig_user_id != null ? body.ig_user_id : cli.ig_user_id);
  const url = new URL('https://graph.instagram.com/me');
  url.searchParams.set('fields', 'user_id,username');
  url.searchParams.set('access_token', token);
  let resp;
  try {
    resp = await chamarInstagram(url);
  } catch {
    return json({ ok: false, error: 'Não foi possível falar com o Instagram.' }, 502);
  }
  if (!resp.ok || resp.data?.error) {
    return json({ ok: false, error: limparErroInstagram(resp.data?.error?.message) }, 400);
  }
  const username = String(resp.data.username || '').trim();
  const userId = soDigitos(resp.data.user_id || resp.data.id || '');
  const usuarioConfere = !!esperadoUsuario && usuarioInstagram(username) === esperadoUsuario;
  const idConfere = !!esperadoId && userId === esperadoId;
  let mensagem;
  if (!esperadoUsuario || !esperadoId) {
    mensagem = `O Instagram respondeu @${username || '—'}${userId ? ` (ID ${userId})` : ''}. Preencha o usuário e o ID para confirmar.`;
  } else if (usuarioConfere && idConfere) {
    mensagem = `Conectado como @${username}. O usuário e o ID conferem.`;
  } else {
    const partes = [];
    if (!usuarioConfere) partes.push(`respondeu @${username || '—'}, e o cadastro está com @${esperadoUsuario}`);
    if (!idConfere) partes.push(`respondeu o ID ${userId || '—'}, e o cadastro está com ${esperadoId}`);
    mensagem = `O token funciona, mas o Instagram ${partes.join('; ')}.`;
  }
  if (usuarioConfere && idConfere) {
    await registrarEvento(env, cnpj, app, 'instagram', `conexão testada como @${username}`);
  }
  return json({
    ok: usuarioConfere && idConfere,
    username,
    user_id: userId,
    mensagem,
    error: usuarioConfere && idConfere ? undefined : mensagem,
  });
}

async function renovarInstagram(cnpj, app, request, env) {
  await garantirInstagram(env);
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  const digitado = String(body?.token || '').trim();
  const token = digitado ? digitado.slice(0, 500) : String(cli.ig_token || '').trim();
  if (!token) return json({ ok: false, error: 'Não há token para renovar.' }, 400);
  const mesmoGuardado = !digitado || digitado === String(cli.ig_token || '').trim();
  if (mesmoGuardado && tokenRecente(cli.ig_token_em)) {
    return json({ ok: false, error: 'A renovação só funciona com o token tendo mais de 24 horas.' }, 400);
  }
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  let resp;
  try {
    resp = await chamarInstagram(url);
  } catch {
    return json({ ok: false, error: 'Não foi possível falar com o Instagram.' }, 502);
  }
  if (!resp.ok || resp.data?.error || !resp.data?.access_token) {
    const bruto = limparErroInstagram(resp.data?.error?.message);
    const jovem = /24\s*hour|24\s*hora|not old enough|too new|recently/i.test(bruto);
    return json({
      ok: false,
      error: jovem ? 'A renovação só funciona com o token tendo mais de 24 horas.' : bruto,
    }, 400);
  }
  const novo = String(resp.data.access_token).trim().slice(0, 500);
  const expira = dataValidadeToken(resp.data.expires_in);
  const agora = agoraIso();
  await env.DB.prepare(
    `UPDATE clientes SET ig_token = ?, ig_token_expira = ?, ig_token_em = ?, atualizado_em = ? WHERE cnpj = ? AND aplicacao = ?`
  ).bind(novo, expira, agora, agora, cnpj, app).run();
  const validade = expira.split('-').reverse().join('/');
  await registrarEvento(env, cnpj, app, 'instagram', `token renovado, válido até ${validade}`);
  return json({
    ok: true,
    ig_token_expira: expira,
    ig_token_informado: true,
    mensagem: `Token renovado. Válido até ${validade}.`,
  });
}

async function conferirRevenda(env, campos) {
  if (campos.revenda_id == null) return null;
  const r = await env.DB.prepare('SELECT id, nome FROM revendas WHERE id = ?').bind(campos.revenda_id).first();
  if (!r) throw new Error('Revenda não encontrada.');
  return r;
}

// ─── Revendas ─────────────────────────────────────────────────────────────────

async function listarRevendas(env) {
  const { results } = await env.DB.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM clientes c WHERE c.revenda_id = r.id) AS clientes
    FROM revendas r ORDER BY r.id`).all();
  const semRevenda = await env.DB.prepare('SELECT COUNT(*) AS n FROM clientes WHERE revenda_id IS NULL').first();
  return json({ ok: true, revendas: results, sem_revenda: semRevenda?.n || 0 });
}

function camposRevenda(body, parcial) {
  const out = {};
  if (!parcial || body.nome !== undefined) {
    const nome = texto(body.nome, 120);
    if (!nome) throw new Error('Informe o nome da revenda.');
    out.nome = nome;
  }
  if (body.contato !== undefined) out.contato = texto(body.contato, 120);
  if (body.ativo !== undefined) out.ativo = body.ativo ? 1 : 0;
  return out;
}

async function criarRevenda(request, env) {
  const body = await request.json().catch(() => ({}));
  const cnpj = soDigitos(body.cnpj);
  if (!cnpjValido(cnpj)) return json({ ok: false, error: 'CNPJ da revenda inválido.' }, 400);
  let campos;
  try {
    campos = camposRevenda(body, false);
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }
  if (await env.DB.prepare('SELECT 1 FROM revendas WHERE cnpj = ?').bind(cnpj).first()) {
    return json({ ok: false, error: 'Revenda já cadastrada com este CNPJ.' }, 409);
  }
  const agora = agoraIso();
  await env.DB.prepare('INSERT INTO revendas (cnpj, nome, contato, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(cnpj, campos.nome, campos.contato ?? null, campos.ativo ?? 1, agora, agora).run();
  await registrarEvento(env, '*', null, 'revenda', `Revenda cadastrada: ${campos.nome} (${cnpj})`);
  return listarRevendas(env);
}

async function atualizarRevenda(id, request, env) {
  const atual = await env.DB.prepare('SELECT * FROM revendas WHERE id = ?').bind(id).first();
  if (!atual) return json({ ok: false, error: 'Revenda não encontrada.' }, 404);
  const body = await request.json().catch(() => ({}));
  let campos;
  try {
    campos = camposRevenda(body, true);
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }
  const chaves = Object.keys(campos);
  if (chaves.length) {
    await env.DB.prepare(`UPDATE revendas SET ${chaves.map((k) => `${k} = ?`).join(', ')}, atualizado_em = ? WHERE id = ?`)
      .bind(...chaves.map((k) => campos[k]), agoraIso(), id).run();
  }
  return listarRevendas(env);
}

async function excluirRevenda(id, env) {
  const uso = await env.DB.prepare('SELECT COUNT(*) AS n FROM clientes WHERE revenda_id = ?').bind(id).first();
  if (uso?.n) return json({ ok: false, error: `Revenda com ${uso.n} cliente(s). Troque a revenda deles ou desative-a.` }, 409);
  await env.DB.prepare('DELETE FROM revendas WHERE id = ?').bind(id).run();
  return listarRevendas(env);
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
    await conferirRevenda(env, campos);
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }
  const agora = agoraIso();
  await env.DB.prepare(
    `INSERT INTO clientes (cnpj, aplicacao, razao, fantasia, status, pago_ate, mensagem, observacao, criado_em, atualizado_em, revenda_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(cnpj, app, campos.razao ?? null, campos.fantasia ?? null, campos.status, campos.pago_ate ?? null,
    campos.mensagem ?? null, campos.observacao ?? null, agora, agora, campos.revenda_id ?? null).run();
  await registrarEvento(env, cnpj, app, 'cadastro_manual', `status ${campos.status}`);
  return detalheCliente(cnpj, app, env);
}

async function atualizarCliente(cnpj, app, request, env) {
  await garantirPacoteEntrada(env);
  await garantirCentralOfertas(env);
  await garantirInstagram(env);
  const cli = await buscarCliente(env, cnpj, app);
  if (!cli) return json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  const body = await request.json().catch(() => ({}));
  let campos;
  let revendaNova = null;
  try {
    campos = camposEditaveis(body);
    revendaNova = await conferirRevenda(env, campos);
    await conferirContador(env, campos);
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }
  if (campos.status === 'bloqueado' && cli.status === 'liberado') campos.bloqueado_em = agoraIso();
  else if (campos.status && campos.status !== 'bloqueado') campos.bloqueado_em = null;
  if (campos.ig_token && campos.ig_token !== String(cli.ig_token || '')) campos.ig_token_em = agoraIso();
  const chaves = Object.keys(campos);
  if (!chaves.length) return detalheCliente(cnpj, app, env);
  await env.DB.prepare(
    `UPDATE clientes SET ${chaves.map((k) => `${k} = ?`).join(', ')}, atualizado_em = ? WHERE cnpj = ? AND aplicacao = ?`
  ).bind(...chaves.map((k) => campos[k]), agoraIso(), cnpj, app).run();
  if (campos.status && campos.status !== cli.status) {
    await registrarEvento(env, cnpj, app, 'status', `${cli.status} → ${campos.status}`);
  }
  const outros = chaves.filter((k) => k !== 'status' && k !== 'bloqueado_em' && k !== 'ig_token_em' && (campos[k] ?? null) !== (cli[k] ?? null));
  if (outros.length) {
    const ROTULOS = {
      revenda_id: 'revenda',
      pago_ate: 'pago até',
      em_teste: 'teste grátis',
      pacote_entrada: 'pacote de entrada',
      central_ofertas: 'central de ofertas',
      ig_usuario: 'instagram',
      ig_user_id: 'id do instagram',
      ig_token: 'token do instagram',
      ig_token_expira: 'validade do token',
      ig_token_em: 'momento do token',
    };
    const valor = (k) => {
      if (k === 'revenda_id') return revendaNova?.nome || 'sem revenda';
      if (k === 'ig_token') return 'atualizado';
      if (k === 'em_teste' || k === 'pacote_entrada' || k === 'central_ofertas') return campos[k] ? 'sim' : 'não';
      if (k === 'pago_ate' && campos[k]) return campos[k].split('-').reverse().join('/');
      return campos[k] ?? '—';
    };
    await registrarEvento(env, cnpj, app, 'edicao', outros.map((k) => `${ROTULOS[k] || k}: ${valor(k)}`).join(' · '));
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
  await garantirCentralOfertas(env);
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
    pacote_entrada: pacoteEntradaAtivo(cli),
    contador_vinculado: contadorVinculado(cli),
    central_ofertas: centralOfertasAtiva(cli),
    ...instagramDoCliente(cli),
  });
  await registrarEvento(env, cnpj, app, 'licenca_offline', `${dias} dia(s)${nse ? ` · NSE ${nse}` : ''}`);
  const codigo = `MTL1.${b64url(enc.encode(JSON.stringify(licenca)))}`;
  return json({ ok: true, codigo, valido_ate: validoAte.toISOString() });
}

async function garantirTabelaMt(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mt_empresas (
    cnpj TEXT NOT NULL,
    aplicacao TEXT NOT NULL,
    nse TEXT,
    nome TEXT,
    url TEXT,
    atualizado_em TEXT,
    PRIMARY KEY (cnpj, aplicacao)
  )`).run();
}

/** O check grava o contato no máximo a cada 10 min. Janela um pouco maior para o Gestor aberto aparecer. */
const JANELA_ONLINE_MS = 15 * 60 * 1000;

function urlTunelValida(v) {
  const s = String(v || '').trim().replace(/\/$/, '');
  return /^https:\/\/acesso\.smsjrdeveloper\.com\.br\/t\/[a-z2-7]{20,32}$/.test(s) ? s : '';
}

async function listarEmpresasMt(url, env, opcoes = {}) {
  const app = nomeApp(url.searchParams.get('aplicacao')) || APP_PADRAO;
  await garantirTabelaMt(env);
  await garantirPacoteEntrada(env);
  const desde = new Date(Date.now() - JANELA_ONLINE_MS).toISOString();
  const filtroPacote = opcoes.soPacoteEntrada === true ? 'AND COALESCE(c.pacote_entrada, 0) = 1' : '';
  const { results } = await env.DB.prepare(
    `SELECT c.cnpj,
            COALESCE(NULLIF(m.nome, ''), NULLIF(c.fantasia, ''), NULLIF(c.razao, '')) AS nome,
            i.nse, i.ultimo_contato, m.url
     FROM clientes c
     JOIN instalacoes i ON i.cnpj = c.cnpj AND i.aplicacao = c.aplicacao
     LEFT JOIN mt_empresas m ON m.cnpj = c.cnpj AND m.aplicacao = c.aplicacao
     WHERE c.aplicacao = ?
       ${filtroPacote}
       AND i.ultimo_contato >= ?
     ORDER BY i.ultimo_contato DESC`
  ).bind(app, desde).all();
  const vistos = new Set();
  const itens = [];
  for (const r of results || []) {
    if (vistos.has(r.cnpj)) continue;
    vistos.add(r.cnpj);
    itens.push({
      cnpj: r.cnpj,
      nse: r.nse || '',
      nome: r.nome || '',
      url: urlTunelValida(r.url) ? `${urlTunelValida(r.url)}?mt=1` : '',
      online: true,
      ultimo_contato: r.ultimo_contato || null,
    });
  }
  itens.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  return json({ ok: true, itens });
}

async function garantirTabelaVinculos(env) {
  await garantirTabelaMt(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mt_vinculos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aplicacao TEXT NOT NULL,
    cnpj_matriz TEXT NOT NULL,
    cnpj_filial TEXT NOT NULL,
    aceite_matriz TEXT,
    aceite_filial TEXT,
    criado_em TEXT,
    atualizado_em TEXT
  )`).run();
  await env.DB.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS mt_vinculos_par ON mt_vinculos (aplicacao, cnpj_matriz, cnpj_filial)`
  ).run();
  try {
    await env.DB.prepare('ALTER TABLE mt_vinculos ADD COLUMN apelido_filial TEXT').run();
  } catch { /* coluna já existe */ }
}

function apelidoFilialDe(v) {
  return texto(v, 40) || null;
}

function statusVinculo(v) {
  if (v.aceite_matriz === 'recusado' || v.aceite_filial === 'recusado') return 'recusado';
  if (v.aceite_matriz === 'aceito' && v.aceite_filial === 'aceito') return 'ativo';
  if (v.aceite_matriz === 'aceito') return 'aguardando_filial';
  if (v.aceite_filial === 'aceito') return 'aguardando_matriz';
  return 'aguardando';
}

async function fichaEmpresaMt(env, app, cnpj) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(m.nome, ''), NULLIF(c.fantasia, ''), NULLIF(c.razao, ''), ?) AS nome,
            m.url
     FROM (SELECT 1 AS x)
     LEFT JOIN mt_empresas m ON m.cnpj = ? AND m.aplicacao = ?
     LEFT JOIN clientes c ON c.cnpj = ? AND c.aplicacao = ?`
  ).bind(cnpj, cnpj, app, cnpj, app).first();
  return {
    cnpj,
    nome: row?.nome || cnpj,
    url: urlTunelValida(row?.url) || '',
  };
}

async function empresaConhecida(env, app, cnpj) {
  const cli = await env.DB.prepare(
    'SELECT 1 AS ok FROM clientes WHERE cnpj = ? AND aplicacao = ?'
  ).bind(cnpj, app).first();
  if (cli) return true;
  const mt = await env.DB.prepare(
    'SELECT 1 AS ok FROM mt_empresas WHERE cnpj = ? AND aplicacao = ?'
  ).bind(cnpj, app).first();
  return !!mt;
}

async function enriquecerVinculo(env, app, v) {
  const matriz = await fichaEmpresaMt(env, app, v.cnpj_matriz);
  const filial = await fichaEmpresaMt(env, app, v.cnpj_filial);
  return {
    id: v.id,
    cnpj_matriz: v.cnpj_matriz,
    cnpj_filial: v.cnpj_filial,
    nome_matriz: matriz.nome,
    nome_filial: filial.nome,
    url_matriz: matriz.url,
    url_filial: filial.url,
    aceite_matriz: v.aceite_matriz || null,
    aceite_filial: v.aceite_filial || null,
    apelido_filial: v.apelido_filial || '',
    status: statusVinculo(v),
    atualizado_em: v.atualizado_em || null,
  };
}

async function listarCadastroMt(url, env) {
  const app = nomeApp(url.searchParams.get('aplicacao')) || APP_PADRAO;
  await garantirTabelaMt(env);
  const desde = new Date(Date.now() - JANELA_ONLINE_MS).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT m.cnpj, m.nome, m.nse, m.url,
            (SELECT MAX(i.ultimo_contato) FROM instalacoes i
              WHERE i.cnpj = m.cnpj AND i.aplicacao = m.aplicacao) AS ultimo_contato
     FROM mt_empresas m
     WHERE m.aplicacao = ?
     ORDER BY m.nome`
  ).bind(app).all();
  const itens = (results || []).map((r) => ({
    cnpj: r.cnpj,
    nse: r.nse || '',
    nome: r.nome || '',
    url: urlTunelValida(r.url) || '',
    online: !!r.ultimo_contato && r.ultimo_contato >= desde,
  }));
  itens.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  return json({ ok: true, itens });
}

async function listarVinculosMt(url, env) {
  const app = nomeApp(url.searchParams.get('aplicacao')) || APP_PADRAO;
  await garantirTabelaVinculos(env);
  const cnpj = soDigitos(url.searchParams.get('cnpj'));
  const sql = cnpj
    ? `SELECT * FROM mt_vinculos WHERE aplicacao = ? AND (cnpj_matriz = ? OR cnpj_filial = ?) ORDER BY id DESC`
    : `SELECT * FROM mt_vinculos WHERE aplicacao = ? ORDER BY id DESC`;
  const q = env.DB.prepare(sql);
  const { results } = cnpj ? await q.bind(app, cnpj, cnpj).all() : await q.bind(app).all();
  const itens = [];
  for (const v of results || []) itens.push(await enriquecerVinculo(env, app, v));
  return json({ ok: true, itens });
}

async function criarVinculoMt(request, env) {
  const b = await request.json().catch(() => ({}));
  const app = nomeApp(b.aplicacao) || APP_PADRAO;
  const cnpjMatriz = soDigitos(b.cnpjMatriz);
  const cnpjFilial = soDigitos(b.cnpjFilial);
  if (cnpjMatriz.length < 11 || cnpjFilial.length < 11) {
    return json({ ok: false, error: 'Informe a matriz e a filial.' }, 400);
  }
  if (cnpjMatriz === cnpjFilial) {
    return json({ ok: false, error: 'A matriz e a filial precisam ser empresas diferentes.' }, 400);
  }
  await garantirTabelaVinculos(env);
  if (!(await empresaConhecida(env, app, cnpjMatriz)) || !(await empresaConhecida(env, app, cnpjFilial))) {
    return json({ ok: false, error: 'As duas empresas precisam estar no painel.' }, 400);
  }
  const outra = await env.DB.prepare(
    `SELECT id FROM mt_vinculos
     WHERE aplicacao = ? AND cnpj_filial = ? AND cnpj_matriz != ?
       AND COALESCE(aceite_matriz, '') != 'recusado'
       AND COALESCE(aceite_filial, '') != 'recusado'`
  ).bind(app, cnpjFilial, cnpjMatriz).first();
  if (outra) return json({ ok: false, error: 'Esta filial já está vinculada a outra matriz.' }, 400);
  const agora = agoraIso();
  const existente = await env.DB.prepare(
    `SELECT * FROM mt_vinculos WHERE aplicacao = ? AND cnpj_matriz = ? AND cnpj_filial = ?`
  ).bind(app, cnpjMatriz, cnpjFilial).first();
  const apelido = Object.hasOwn(b, 'apelidoFilial') ? apelidoFilialDe(b.apelidoFilial) : undefined;
  let id;
  if (existente) {
    if (statusVinculo(existente) === 'ativo') {
      if (apelido !== undefined) {
        await env.DB.prepare(
          'UPDATE mt_vinculos SET apelido_filial = ?, atualizado_em = ? WHERE id = ?'
        ).bind(apelido, agora, existente.id).run();
      }
      return json({ ok: true, id: existente.id, ativo: true });
    }
    await env.DB.prepare(
      `UPDATE mt_vinculos
       SET aceite_matriz = NULL, aceite_filial = NULL, apelido_filial = COALESCE(?, apelido_filial), atualizado_em = ?
       WHERE id = ?`
    ).bind(apelido === undefined ? null : apelido, agora, existente.id).run();
    id = existente.id;
  } else {
    const ins = await env.DB.prepare(
      `INSERT INTO mt_vinculos (aplicacao, cnpj_matriz, cnpj_filial, aceite_matriz, aceite_filial, apelido_filial, criado_em, atualizado_em)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)
       RETURNING id`
    ).bind(app, cnpjMatriz, cnpjFilial, apelido || null, agora, agora).first();
    id = ins?.id;
  }
  const row = await env.DB.prepare('SELECT * FROM mt_vinculos WHERE id = ?').bind(id).first();
  return json({ ok: true, vinculo: await enriquecerVinculo(env, app, row) });
}

/** Ligação feita no painel de licenças: já nasce aceita dos dois lados. */
async function ligarEmpresasAdmin(request, env) {
  const b = await request.json().catch(() => ({}));
  const app = nomeApp(b.aplicacao) || APP_PADRAO;
  const cnpjMatriz = soDigitos(b.cnpjMatriz);
  const cnpjFilial = soDigitos(b.cnpjFilial);
  if ((cnpjMatriz.length !== 14 && cnpjMatriz.length !== 11) || (cnpjFilial.length !== 14 && cnpjFilial.length !== 11)) {
    return json({ ok: false, error: 'Informe o CNPJ da outra empresa.' }, 400);
  }
  if (cnpjMatriz === cnpjFilial) {
    return json({ ok: false, error: 'A matriz e a filial precisam ser empresas diferentes.' }, 400);
  }
  await garantirTabelaVinculos(env);
  if (!(await empresaConhecida(env, app, cnpjMatriz)) || !(await empresaConhecida(env, app, cnpjFilial))) {
    return json({ ok: false, error: 'Cadastre os dois CNPJs em Licenças antes de ligar.' }, 400);
  }
  const matrizJaFilial = await env.DB.prepare(
    `SELECT id FROM mt_vinculos
     WHERE aplicacao = ? AND cnpj_filial = ?
       AND COALESCE(aceite_matriz, '') != 'recusado'
       AND COALESCE(aceite_filial, '') != 'recusado'`
  ).bind(app, cnpjMatriz).first();
  if (matrizJaFilial) {
    return json({ ok: false, error: 'Esta matriz já é filial de outra empresa. Ligue na matriz principal.' }, 400);
  }
  const outra = await env.DB.prepare(
    `SELECT id FROM mt_vinculos
     WHERE aplicacao = ? AND cnpj_filial = ? AND cnpj_matriz != ?
       AND COALESCE(aceite_matriz, '') != 'recusado'
       AND COALESCE(aceite_filial, '') != 'recusado'`
  ).bind(app, cnpjFilial, cnpjMatriz).first();
  if (outra) return json({ ok: false, error: 'Esta filial já está vinculada a outra matriz.' }, 400);
  const filialJaMatriz = await env.DB.prepare(
    `SELECT id FROM mt_vinculos
     WHERE aplicacao = ? AND cnpj_matriz = ?
       AND COALESCE(aceite_matriz, '') != 'recusado'
       AND COALESCE(aceite_filial, '') != 'recusado'`
  ).bind(app, cnpjFilial).first();
  if (filialJaMatriz) {
    return json({ ok: false, error: 'Esta filial já é matriz de outras empresas.' }, 400);
  }
  const agora = agoraIso();
  const apelido = apelidoFilialDe(b.apelidoFilial);
  const existente = await env.DB.prepare(
    `SELECT * FROM mt_vinculos WHERE aplicacao = ? AND cnpj_matriz = ? AND cnpj_filial = ?`
  ).bind(app, cnpjMatriz, cnpjFilial).first();
  let id;
  if (existente) {
    await env.DB.prepare(
      `UPDATE mt_vinculos
       SET aceite_matriz = 'aceito', aceite_filial = 'aceito', apelido_filial = ?, atualizado_em = ?
       WHERE id = ?`
    ).bind(apelido, agora, existente.id).run();
    id = existente.id;
  } else {
    const ins = await env.DB.prepare(
      `INSERT INTO mt_vinculos (aplicacao, cnpj_matriz, cnpj_filial, aceite_matriz, aceite_filial, apelido_filial, criado_em, atualizado_em)
       VALUES (?, ?, ?, 'aceito', 'aceito', ?, ?, ?)
       RETURNING id`
    ).bind(app, cnpjMatriz, cnpjFilial, apelido, agora, agora).first();
    id = ins?.id;
  }
  const row = await env.DB.prepare('SELECT * FROM mt_vinculos WHERE id = ?').bind(id).first();
  return json({ ok: true, vinculo: row ? await enriquecerVinculo(env, app, row) : null });
}

async function salvarApelidoVinculo(id, request, env) {
  const b = await request.json().catch(() => ({}));
  await garantirTabelaVinculos(env);
  const row = await env.DB.prepare('SELECT * FROM mt_vinculos WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'Vínculo não encontrado.' }, 404);
  const apelido = apelidoFilialDe(b.apelidoFilial);
  await env.DB.prepare(
    'UPDATE mt_vinculos SET apelido_filial = ?, atualizado_em = ? WHERE id = ?'
  ).bind(apelido, agoraIso(), id).run();
  const atual = await env.DB.prepare('SELECT * FROM mt_vinculos WHERE id = ?').bind(id).first();
  return json({ ok: true, vinculo: await enriquecerVinculo(env, row.aplicacao, atual) });
}

async function excluirVinculoAdmin(id, env) {
  await garantirTabelaVinculos(env);
  const row = await env.DB.prepare('SELECT id FROM mt_vinculos WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'Vínculo não encontrado.' }, 404);
  await env.DB.prepare('DELETE FROM mt_vinculos WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function excluirVinculoDaLoja(id, cnpj, app, env) {
  await garantirTabelaVinculos(env);
  const row = await env.DB.prepare(
    'SELECT id, cnpj_matriz, cnpj_filial FROM mt_vinculos WHERE id = ? AND aplicacao = ?'
  ).bind(id, app).first();
  if (!row) return json({ ok: false, error: 'Vínculo não encontrado.' }, 404);
  if (row.cnpj_matriz !== cnpj && row.cnpj_filial !== cnpj) {
    return json({ ok: false, error: 'Este vínculo não é desta empresa.' }, 403);
  }
  await env.DB.prepare('DELETE FROM mt_vinculos WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function aceitarVinculoMt(b, env) {
  const app = nomeApp(b.aplicacao) || APP_PADRAO;
  const cnpj = soDigitos(b.cnpj);
  const id = Number(b.id);
  const aceite = b.aceite === 'aceito' || b.aceite === 'recusado' ? b.aceite : '';
  if (!aceite || !Number.isFinite(id) || cnpj.length < 11) {
    return json({ ok: false, error: 'Aceite inválido.' }, 400);
  }
  await garantirTabelaVinculos(env);
  const row = await env.DB.prepare(
    'SELECT * FROM mt_vinculos WHERE id = ? AND aplicacao = ?'
  ).bind(id, app).first();
  if (!row) return json({ ok: false, error: 'Vínculo não encontrado.' }, 404);
  if (statusVinculo(row) === 'recusado') {
    return json({ ok: false, error: 'Este vínculo foi recusado. Crie de novo no painel.' }, 400);
  }
  const agora = agoraIso();
  if (row.cnpj_matriz === cnpj) {
    await env.DB.prepare(
      'UPDATE mt_vinculos SET aceite_matriz = ?, atualizado_em = ? WHERE id = ?'
    ).bind(aceite, agora, id).run();
  } else if (row.cnpj_filial === cnpj) {
    await env.DB.prepare(
      'UPDATE mt_vinculos SET aceite_filial = ?, atualizado_em = ? WHERE id = ?'
    ).bind(aceite, agora, id).run();
  } else {
    return json({ ok: false, error: 'Esta empresa não faz parte do vínculo.' }, 403);
  }
  const atual = await env.DB.prepare('SELECT * FROM mt_vinculos WHERE id = ?').bind(id).first();
  return json({ ok: true, vinculo: await enriquecerVinculo(env, app, atual) });
}

async function grupoEmpresaMt(url, env) {
  const app = nomeApp(url.searchParams.get('aplicacao')) || APP_PADRAO;
  const cnpj = soDigitos(url.searchParams.get('cnpj'));
  if (cnpj.length < 11) return json({ ok: true, empresas: [] });
  await garantirTabelaVinculos(env);
  const { results } = await env.DB.prepare(
    `SELECT id, cnpj_matriz, cnpj_filial, apelido_filial FROM mt_vinculos
     WHERE aplicacao = ? AND aceite_matriz = 'aceito' AND aceite_filial = 'aceito'
       AND (cnpj_matriz = ? OR cnpj_filial = ?)`
  ).bind(app, cnpj, cnpj).all();
  const diretos = results || [];
  if (!diretos.length) return json({ ok: true, empresas: [] });
  const matrizes = [...new Set(diretos.map((r) => r.cnpj_matriz))];
  const marcas = matrizes.map(() => '?').join(',');
  const irmas = await env.DB.prepare(
    `SELECT id, cnpj_matriz, cnpj_filial, apelido_filial FROM mt_vinculos
     WHERE aplicacao = ? AND aceite_matriz = 'aceito' AND aceite_filial = 'aceito'
       AND cnpj_matriz IN (${marcas})`
  ).bind(app, ...matrizes).all();
  const linhas = irmas.results || [];
  const ehMatriz = new Set();
  const cnpjs = new Set([cnpj]);
  for (const r of linhas) {
    ehMatriz.add(r.cnpj_matriz);
    cnpjs.add(r.cnpj_matriz);
    cnpjs.add(r.cnpj_filial);
  }
  if (cnpjs.size < 2) return json({ ok: true, empresas: [] });
  const empresas = [];
  for (const c of cnpjs) {
    const f = await fichaEmpresaMt(env, app, c);
    const ligacao = linhas.find((r) => (
      (r.cnpj_matriz === cnpj && r.cnpj_filial === c)
      || (r.cnpj_filial === cnpj && r.cnpj_matriz === c)
    ));
    const daFilial = linhas.find((r) => r.cnpj_filial === c);
    empresas.push({
      cnpj: f.cnpj,
      nome: f.nome,
      url: f.url,
      papel: ehMatriz.has(c) ? 'matriz' : 'filial',
      apelido: daFilial?.apelido_filial || '',
      atual: c === cnpj,
      vinculo_id: ligacao?.id || null,
    });
  }
  empresas.sort((a, b) => {
    if (a.papel !== b.papel) return a.papel === 'matriz' ? -1 : 1;
    return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  });
  return json({ ok: true, empresas });
}

async function loginMt(request, env) {
  let body = {};
  try { body = await request.json(); } catch { /* vazio */ }
  if (!(await senhaConfere(String(body.senha || ''), env.MT_ENTRADAS_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ ok: false, error: 'Senha incorreta.' }, 401);
  }
  return json({ ok: true, token: await emitirToken(env, 'entradas'), horas: SESSAO_HORAS });
}

const SEM_SESSAO_MT = { ok: false, error: 'Sessão MT expirada. Entre novamente.', code: 'AUTH' };
const SEM_INSTALACAO = {
  ok: false,
  error: 'Esta instalação do Gestor não foi confirmada para a empresa. Peça à MT para liberar a troca de computador.',
  code: 'INSTALACAO',
};

/**
 * Lado MT (lista de empresas, cadastro de vínculos): token do login MT.
 * Lado da loja (grupo, vínculos e aceite da própria empresa): CNPJ + segredo da instalação, e só a própria empresa.
 */
async function compararContadorDocumento(env, cnpjLoja, documento) {
  const doc = soDigitos(documento);
  if (!(doc.length === 11 || doc.length === 14)) {
    return json({ ok: true, confere: false, motivo: 'CPF/CNPJ do usuário inválido.' });
  }
  const cont = await env.DB.prepare(
    'SELECT id, nome, ativo FROM contadores WHERE documento = ?'
  ).bind(doc).first();
  if (!cont || !Number(cont.ativo)) {
    return json({ ok: true, confere: false, motivo: 'Este CPF/CNPJ não está cadastrado como contador ativo no painel.' });
  }
  const cli = await env.DB.prepare(
    'SELECT cnpj FROM clientes WHERE cnpj = ? AND aplicacao = ? AND contador_id = ?'
  ).bind(cnpjLoja, APP_PADRAO, cont.id).first();
  if (!cli) {
    return json({ ok: true, confere: false, motivo: 'O CPF/CNPJ do usuário não é o contador vinculado a esta empresa no painel.' });
  }
  return json({ ok: true, confere: true, nome: cont.nome });
}

async function rotaMt(request, env, url) {
  const p = url.pathname;
  if (p === '/api/mt/login' && request.method === 'POST') return loginMt(request, env);

  const sess = await sessaoToken(env, request);
  const appQuery = nomeApp(url.searchParams.get('aplicacao')) || APP_PADRAO;

  if (p === '/api/mt/contador-documento' && request.method === 'GET') {
    const cnpj = await instalacaoDaRequisicao(request, env, appQuery);
    if (!cnpj) return json(SEM_INSTALACAO, 403);
    return compararContadorDocumento(env, cnpj, url.searchParams.get('documento'));
  }

  if (p === '/api/mt/empresas' && request.method === 'GET') {
    return sess ? listarEmpresasMt(url, env, { soPacoteEntrada: sess.papel === 'entradas' }) : json(SEM_SESSAO_MT, 401);
  }
  if (p === '/api/mt/empresas/cadastro' && request.method === 'GET') {
    return sess ? listarCadastroMt(url, env) : json(SEM_SESSAO_MT, 401);
  }
  if (p === '/api/mt/vinculos' && request.method === 'POST') {
    return sess ? criarVinculoMt(request, env) : json(SEM_SESSAO_MT, 401);
  }
  const delMt = p.match(/^\/api\/mt\/vinculos\/(\d+)$/);
  if (delMt && request.method === 'DELETE') {
    const id = Number(delMt[1]);
    if (sess) return excluirVinculoAdmin(id, env);
    const cnpj = await instalacaoDaRequisicao(request, env, appQuery);
    if (!cnpj) return json(SEM_INSTALACAO, 403);
    return excluirVinculoDaLoja(id, cnpj, appQuery, env);
  }
  if (p === '/api/mt/vinculos' && request.method === 'GET') {
    if (sess) return listarVinculosMt(url, env);
    const cnpj = await instalacaoDaRequisicao(request, env, appQuery);
    if (!cnpj) return json(SEM_INSTALACAO, 403);
    url.searchParams.set('cnpj', cnpj);
    return listarVinculosMt(url, env);
  }
  if (p === '/api/mt/grupo' && request.method === 'GET') {
    const cnpj = await instalacaoDaRequisicao(request, env, appQuery);
    if (!cnpj) return json(SEM_INSTALACAO, 403);
    url.searchParams.set('cnpj', cnpj);
    return grupoEmpresaMt(url, env);
  }
  if (p === '/api/mt/vinculos/aceite' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const app = nomeApp(b.aplicacao) || APP_PADRAO;
    const cnpj = await instalacaoDaRequisicao(request, env, app);
    if (!cnpj) return json(SEM_INSTALACAO, 403);
    return aceitarVinculoMt({ ...b, aplicacao: app, cnpj }, env);
  }
  return json({ ok: false, error: 'Rota não encontrada.' }, 404);
}

function documentoValido(tipo, doc) {
  if (tipo === 'cpf') return cpfValido(doc);
  if (tipo === 'cnpj') return cnpjValido(doc);
  return false;
}

function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (len) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

function senhaContadorForte(senha) {
  const s = String(senha || '');
  return s.length >= 8 && /[A-Za-z]/.test(s) && /\d/.test(s);
}

async function hashSenhaContador(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(senha)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

async function conferirSenhaContador(senha, armazenada) {
  const partes = String(armazenada || '').split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;
  const iter = Number(partes[1]);
  if (!Number.isInteger(iter) || iter < 10000) return false;
  let salt;
  try { salt = b64urlDecode(partes[2]); } catch { return false; }
  const esperado = partes[3];
  const key = await crypto.subtle.importKey('raw', enc.encode(String(senha)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  const obtido = b64url(new Uint8Array(bits));
  if (obtido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < obtido.length; i++) diff |= obtido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

function contadorPublico(c) {
  return {
    id: c.id,
    nome: c.nome,
    tipo_doc: c.tipo_doc,
    documento: c.documento,
    crc: c.crc || '',
    email: c.email,
    telefone: c.telefone || '',
    ativo: Number(c.ativo) === 1,
  };
}

async function conferirContador(env, campos) {
  if (campos.contador_id == null) return null;
  const r = await env.DB.prepare('SELECT id, nome, ativo FROM contadores WHERE id = ?').bind(campos.contador_id).first();
  if (!r) throw new Error('Contador não encontrado.');
  if (Number(r.ativo) !== 1) throw new Error('Este contador está inativo.');
  return r;
}

async function listarContadores(url, env) {
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const rows = await env.DB.prepare(
    'SELECT id, nome, tipo_doc, documento, crc, email, telefone, ativo FROM contadores ORDER BY nome'
  ).all();
  const itens = (rows.results || [])
    .map(contadorPublico)
    .filter((c) => {
      if (!q) return true;
      return [c.nome, c.documento, c.email, c.crc].join(' ').toLowerCase().includes(q);
    });
  return json({ ok: true, itens });
}

async function salvarContador(request, env, id) {
  const body = await request.json().catch(() => ({}));
  const nome = texto(body.nome, 120);
  const tipo = String(body.tipo_doc || '').trim().toLowerCase();
  const doc = soDigitos(body.documento);
  const email = String(body.email || '').trim().toLowerCase();
  const crc = texto(body.crc, 20);
  const telefone = texto(body.telefone, 20);
  const ativo = body.ativo === false || body.ativo === 0 ? 0 : 1;
  const senha = String(body.senha || '');
  const confirma = String(body.confirma || '');
  if (!nome) return json({ ok: false, error: 'Informe o nome ou a razão social.' }, 400);
  if (!documentoValido(tipo, doc)) return json({ ok: false, error: 'CPF ou CNPJ inválido.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Informe um e-mail válido.' }, 400);
  const dupDoc = await env.DB.prepare('SELECT id FROM contadores WHERE documento = ? AND id <> ?').bind(doc, id || 0).first();
  if (dupDoc) return json({ ok: false, error: 'Já existe um contador com este CPF/CNPJ.' }, 400);
  const dupMail = await env.DB.prepare('SELECT id FROM contadores WHERE email = ? AND id <> ?').bind(email, id || 0).first();
  if (dupMail) return json({ ok: false, error: 'Já existe um contador com este e-mail.' }, 400);
  const agora = agoraIso();
  if (!id) {
    if (!senhaContadorForte(senha)) {
      return json({ ok: false, error: 'A senha precisa ter ao menos 8 caracteres, com letra e número.' }, 400);
    }
    if (senha !== confirma) return json({ ok: false, error: 'A confirmação da senha não confere.' }, 400);
    const hash = await hashSenhaContador(senha);
    const ins = await env.DB.prepare(
      `INSERT INTO contadores (nome, tipo_doc, documento, crc, email, telefone, senha_hash, ativo, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(nome, tipo, doc, crc, email, telefone, hash, agora, agora).run();
    const novoId = ins.meta?.last_row_id;
    await registrarEvento(env, '*', null, 'contador', `Contador cadastrado: ${nome}`);
    const row = await env.DB.prepare('SELECT id, nome, tipo_doc, documento, crc, email, telefone, ativo FROM contadores WHERE id = ?').bind(novoId).first();
    return json({ ok: true, contador: contadorPublico(row || { id: novoId, nome, tipo_doc: tipo, documento: doc, email, ativo: 1 }) });
  }
  const atual = await env.DB.prepare('SELECT id FROM contadores WHERE id = ?').bind(id).first();
  if (!atual) return json({ ok: false, error: 'Contador não encontrado.' }, 404);
  if (senha || confirma) {
    if (!senhaContadorForte(senha)) {
      return json({ ok: false, error: 'A senha precisa ter ao menos 8 caracteres, com letra e número.' }, 400);
    }
    if (senha !== confirma) return json({ ok: false, error: 'A confirmação da senha não confere.' }, 400);
    const hash = await hashSenhaContador(senha);
    await env.DB.prepare(
      `UPDATE contadores SET nome = ?, tipo_doc = ?, documento = ?, crc = ?, email = ?, telefone = ?, ativo = ?, senha_hash = ?, atualizado_em = ? WHERE id = ?`
    ).bind(nome, tipo, doc, crc, email, telefone, ativo, hash, agora, id).run();
  } else {
    await env.DB.prepare(
      `UPDATE contadores SET nome = ?, tipo_doc = ?, documento = ?, crc = ?, email = ?, telefone = ?, ativo = ?, atualizado_em = ? WHERE id = ?`
    ).bind(nome, tipo, doc, crc, email, telefone, ativo, agora, id).run();
  }
  const row = await env.DB.prepare('SELECT id, nome, tipo_doc, documento, crc, email, telefone, ativo FROM contadores WHERE id = ?').bind(id).first();
  return json({ ok: true, contador: contadorPublico(row) });
}

async function inativarContador(id, env) {
  const row = await env.DB.prepare('SELECT id, nome FROM contadores WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: 'Contador não encontrado.' }, 404);
  await env.DB.prepare('UPDATE contadores SET ativo = 0, atualizado_em = ? WHERE id = ?').bind(agoraIso(), id).run();
  await registrarEvento(env, '*', null, 'contador', `Contador inativado: ${row.nome}`);
  return json({ ok: true });
}

/** true/false conforme o relay vê o Gestor da loja conectado agora; null se não deu para perguntar. */
async function tunelConectado(env, urlTunel) {
  if (!urlTunel) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const req = new Request(`${urlTunel}/estado`, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-store' } });
    const r = env.RELAY ? await env.RELAY.fetch(req) : await fetch(req);
    if (!r.ok) return null;
    const d = await r.json();
    return d?.ok ? !!d.online : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function clientesDoContador(sess, env) {
  await garantirTabelaMt(env);
  const rows = await env.DB.prepare(`
    SELECT c.cnpj, c.razao, c.fantasia, c.aplicacao, m.nome AS nome_online, m.url,
           (SELECT MAX(i.ultimo_contato) FROM instalacoes i
             WHERE i.cnpj = c.cnpj AND i.aplicacao = c.aplicacao) AS ultimo_contato
    FROM clientes c
    LEFT JOIN mt_empresas m ON m.cnpj = c.cnpj AND m.aplicacao = c.aplicacao
    WHERE c.contador_id = ? AND c.aplicacao = ?
    ORDER BY COALESCE(c.fantasia, c.razao, c.cnpj)
  `).bind(sess.id, APP_PADRAO).all();
  const desde = new Date(Date.now() - JANELA_ONLINE_MS).toISOString();
  const itens = await Promise.all((rows.results || []).map(async (r) => {
    const tunel = urlTunelValida(r.url);
    const conectado = await tunelConectado(env, tunel);
    const online = conectado === null ? !!r.ultimo_contato && r.ultimo_contato >= desde : conectado;
    return {
      cnpj: r.cnpj,
      nome: r.fantasia || r.razao || r.nome_online || r.cnpj,
      aplicacao: r.aplicacao,
      url: tunel ? `${tunel}?contador=1` : '',
      online,
      ultimo_contato: r.ultimo_contato || null,
    };
  }));
  return json({ ok: true, nome: sess.nome, itens });
}

async function vinculoDoContador(sess, url, env) {
  const cnpj = soDigitos(url.searchParams.get('cnpj'));
  if (!(cnpj.length === 11 || cnpj.length === 14)) {
    return json({ ok: false, error: 'CNPJ da loja inválido.' }, 400);
  }
  const row = await env.DB.prepare(
    'SELECT cnpj FROM clientes WHERE cnpj = ? AND aplicacao = ? AND contador_id = ?'
  ).bind(cnpj, APP_PADRAO, sess.id).first();
  if (!row) return json({ ok: false, error: 'Este contador não atende esta loja.' }, 403);
  const conta = await env.DB.prepare('SELECT ativo FROM contadores WHERE id = ?').bind(sess.id).first();
  if (!conta || Number(conta.ativo) !== 1) {
    return json({ ok: false, error: 'Contador inativo.' }, 403);
  }
  return json({ ok: true, cnpj, nome: sess.nome });
}

const ROTA_CONTADOR = /^\/api\/admin\/contadores\/(\d+)$/;
const ROTA_CLIENTE = new RegExp(`^/api/admin/clientes/(${APP_ROTA})/(\\d{11,14})(/licenca-offline|/supervisor|/instalacao|/instagram/testar|/instagram/renovar|/instagram/post-teste)?$`);
const ROTA_REVENDA = /^\/api\/admin\/revendas\/(\d{1,9})$/;

async function rotaAdmin(request, env, url) {
  if (url.pathname === '/api/admin/login' && request.method === 'POST') return login(request, env);
  const sess = await sessaoToken(env, request);
  if (!sess) return json({ ok: false, error: 'Sessão expirada. Entre novamente.', code: 'AUTH' }, 401);
  if (url.pathname === '/api/admin/empresas-online' && request.method === 'GET') {
    return listarEmpresasMt(url, env, { soPacoteEntrada: sess.papel === 'entradas' });
  }
  if (sess.papel === 'contador') {
    if (url.pathname === '/api/admin/contador/clientes' && request.method === 'GET') {
      return clientesDoContador(sess, env);
    }
    if (url.pathname === '/api/admin/contador/vinculo' && request.method === 'GET') {
      return vinculoDoContador(sess, url, env);
    }
    return json({ ok: false, error: 'O contador acessa apenas os clientes vinculados a ele.', code: 'SEM_PERMISSAO' }, 403);
  }
  if (sess.papel === 'entradas') {
    return json({ ok: false, error: 'Este usuário acessa apenas as empresas online.', code: 'SEM_PERMISSAO' }, 403);
  }

  if (url.pathname === '/api/admin/vinculos' && request.method === 'GET') return listarVinculosMt(url, env);
  if (url.pathname === '/api/admin/vinculos' && request.method === 'POST') return ligarEmpresasAdmin(request, env);
  const delVinc = url.pathname.match(/^\/api\/admin\/vinculos\/(\d+)$/);
  if (delVinc && request.method === 'DELETE') return excluirVinculoAdmin(Number(delVinc[1]), env);
  if (delVinc && request.method === 'PATCH') return salvarApelidoVinculo(Number(delVinc[1]), request, env);

  if (url.pathname === '/api/admin/contadores' && request.method === 'GET') return listarContadores(url, env);
  if (url.pathname === '/api/admin/contadores' && request.method === 'POST') return salvarContador(request, env);
  const mc = url.pathname.match(ROTA_CONTADOR);
  if (mc) {
    const id = Number(mc[1]);
    if (request.method === 'PUT') return salvarContador(request, env, id);
    if (request.method === 'DELETE') return inativarContador(id, env);
  }

  if (url.pathname === '/api/admin/config' && request.method === 'GET') return obterConfig(env);
  if (url.pathname === '/api/admin/config/supervisor' && request.method === 'PUT') return definirSupPadrao(request, env);
  if (url.pathname === '/api/admin/config/teste' && request.method === 'PUT') return definirDiasTeste(request, env);
  if (url.pathname === '/api/admin/clientes') {
    if (request.method === 'GET') return listarClientes(url, env);
    if (request.method === 'POST') return criarCliente(request, env);
  }
  if (url.pathname === '/api/admin/revendas') {
    if (request.method === 'GET') return listarRevendas(env);
    if (request.method === 'POST') return criarRevenda(request, env);
  }
  const mr = url.pathname.match(ROTA_REVENDA);
  if (mr) {
    const id = Number(mr[1]);
    if (request.method === 'PUT') return atualizarRevenda(id, request, env);
    if (request.method === 'DELETE') return excluirRevenda(id, env);
  }
  const m = url.pathname.match(ROTA_CLIENTE);
  if (m) {
    const [, app, cnpj, sub] = m;
    if (sub === '/licenca-offline' && request.method === 'POST') return licencaOffline(cnpj, app, request, env);
    if (sub === '/supervisor' && request.method === 'PUT') return definirSupCliente(cnpj, app, request, env);
    if (sub === '/instalacao' && request.method === 'DELETE') return liberarTrocaInstalacao(cnpj, app, env);
    if (sub === '/instagram/testar' && request.method === 'POST') return testarInstagram(cnpj, app, request, env);
    if (sub === '/instagram/renovar' && request.method === 'POST') return renovarInstagram(cnpj, app, request, env);
    if (sub === '/instagram/post-teste' && request.method === 'POST') return publicarPostTeste(cnpj, app, request, env);
    if (!sub && request.method === 'GET') return detalheCliente(cnpj, app, env);
    if (!sub && request.method === 'PUT') return atualizarCliente(cnpj, app, request, env);
    if (!sub && request.method === 'DELETE') return excluirCliente(cnpj, app, env);
  }
  return json({ ok: false, error: 'Rota não encontrada.' }, 404);
}

const NOME_ATUALIZACAO = /^gestorestoque-online-\d+\.\d+\.\d+-online\.\d+\.(exe|apk)$/;
const GIT_PKG = 'https://raw.githubusercontent.com/junin1737/gestorestoque/online/package.json';
const GIT_RELEASE = 'https://api.github.com/repos/junin1737/gestorestoque/releases/tags/v';

function arquivoAtualizacao(origem, nome) {
  if (!nome || !NOME_ATUALIZACAO.test(nome)) return null;
  return { nome, url: `${origem}/atualizacao/arquivo/${nome}` };
}

function numeroVersao(parte) {
  const s = String(parte || '');
  let v = 0;
  let i = 0;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') {
    v = v * 10 + (s.charCodeAt(i) - 48);
    i += 1;
  }
  return v;
}

/** "1.2.160-online.1" é maior que "1.2.140-online.1". */
function cmpVersao(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.');
  const pb = String(b || '').replace(/^v/i, '').split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const da = numeroVersao(pa[i]);
    const db = numeroVersao(pb[i]);
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

async function releaseGithub(versao) {
  const res = await fetch(`${GIT_RELEASE}${encodeURIComponent(versao)}`, {
    headers: { 'User-Agent': 'gestor-licenca', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const achar = (ext) => assets.find((item) => String(item.name || '').toLowerCase().endsWith(ext));
  const apk = achar('.apk');
  const exe = achar('.exe');
  if (!apk?.browser_download_url) return null;
  return {
    versao,
    notas: String(data.body || ''),
    exe: exe?.browser_download_url ? { nome: exe.name, url: exe.browser_download_url } : null,
    apk: { nome: apk.name, url: apk.browser_download_url },
  };
}

/** A nuvem pode ficar para trás quando o CI não tem o token da Cloudflare. */
async function atualizacaoMaisNova(publicada) {
  try {
    const res = await fetch(GIT_PKG, { headers: { 'User-Agent': 'gestor-licenca', Accept: 'application/json' } });
    if (!res.ok) return null;
    const pkg = await res.json();
    const versao = String(pkg.version || '').replace(/^v/i, '').trim();
    if (!versao || cmpVersao(versao, publicada) <= 0) return null;
    return await releaseGithub(versao);
  } catch {
    return null;
  }
}

async function atualizacaoManifesto(request, env) {
  if (!env.ATUALIZACAO) return json({ ok: false, error: 'Atualização ainda não configurada.' }, 503);
  const obj = await env.ATUALIZACAO.get('online/manifest.json');
  let manifesto = {};
  if (obj) {
    try {
      manifesto = JSON.parse(await obj.text());
    } catch {
      return json({ ok: false, error: 'Manifesto de atualização inválido.' }, 500);
    }
  }
  const versaoNuvem = String(manifesto.versao || '').replace(/^v/i, '');
  const git = await atualizacaoMaisNova(versaoNuvem);
  if (git && cmpVersao(git.versao, versaoNuvem) > 0) {
    return json({
      ok: true,
      versao: git.versao,
      notas: git.notas,
      exe: git.exe,
      apk: git.apk,
    });
  }
  const origem = new URL(request.url).origin;
  return json({
    ok: true,
    versao: versaoNuvem,
    notas: String(manifesto.notas || ''),
    exe: arquivoAtualizacao(origem, manifesto.exe),
    apk: arquivoAtualizacao(origem, manifesto.apk),
  });
}

async function atualizacaoArquivo(request, env, nome) {
  if (!NOME_ATUALIZACAO.test(nome)) return json({ ok: false, error: 'Arquivo inválido.' }, 400);
  if (!env.ATUALIZACAO) return json({ ok: false, error: 'Atualização ainda não configurada.' }, 503);
  const obj = await env.ATUALIZACAO.get(`online/${nome}`);
  if (!obj) return json({ ok: false, error: 'Arquivo não encontrado.' }, 404);
  const tipo = nome.endsWith('.apk')
    ? 'application/vnd.android.package-archive'
    : 'application/octet-stream';
  const headers = {
    'Content-Type': tipo,
    'Content-Disposition': `attachment; filename="${nome}"`,
    'Cache-Control': 'public, max-age=86400',
  };
  if (obj.size) headers['Content-Length'] = String(obj.size);
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/atualizacao' && request.method === 'GET') return await atualizacaoManifesto(request, env);
      const arquivo = url.pathname.match(/^\/atualizacao\/arquivo\/([^/]+)$/);
      if (arquivo && request.method === 'GET') {
        return await atualizacaoArquivo(request, env, decodeURIComponent(arquivo[1]));
      }
      if (url.pathname === '/api/check' && request.method === 'POST') return await check(request, env);
      if (url.pathname.startsWith('/api/ofertas/')) return await rotaOfertas(request, env, url, instalacaoDaRequisicao);
      if (url.pathname.startsWith('/api/mt/')) return await rotaMt(request, env, url);
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
