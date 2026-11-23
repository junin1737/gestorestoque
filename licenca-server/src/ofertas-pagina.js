/**
 * Central de Ofertas no navegador, para o cliente que não instala o Gestor.
 * O link é /ofertas/<token>. A entrada é o usuário da loja.
 * O primeiro usuário é Administrador, senha adm@adm.
 */

const APP = 'CentralOfertas';

const HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Central de Ofertas</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, Segoe UI, Roboto, sans-serif; background: #f4f6f9; color: #1a1f26; }
  header { background: #1e3a5f; color: #fff; padding: 16px 20px; }
  header strong { font-size: 18px; }
  header p { margin: 4px 0 0; opacity: .85; font-size: 14px; }
  main { max-width: 720px; margin: 0 auto; padding: 20px; }
  form, .card { background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 1px 3px rgba(16,24,40,.08); }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
  input, textarea, select { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid #d5dbe3; border-radius: 10px; }
  textarea { min-height: 90px; resize: vertical; }
  button { font: inherit; font-weight: 700; border: 0; border-radius: 10px; padding: 11px 16px; cursor: pointer; background: #1e3a5f; color: #fff; }
  button.ghost { background: #e8eef6; color: #1e3a5f; }
  .erro { color: #9b1c1c; font-size: 14px; min-height: 1.2em; }
  .ok { color: #146c43; font-size: 14px; min-height: 1.2em; }
  .aviso { background: #fff7e8; border-radius: 10px; padding: 10px 12px; font-size: 14px; }
  .item { border-top: 1px solid #e6ebf2; padding: 10px 0; font-size: 14px; }
  .item strong { display: block; }
  .sub { color: #5a6577; }
  .linha { display: flex; gap: 8px; align-items: center; }
  .linha > * { flex: 1; }
  footer { text-align: center; color: #5a6577; font-size: 13px; padding: 8px 16px 24px; }
</style>
</head>
<body>
<header>
  <strong>Central de Ofertas</strong>
  <p id="loja">MT Automações</p>
</header>
<main>
  <form id="entrar">
    <p>Entre com o usuário desta loja para agendar as postagens.</p>
    <label>Usuário<input id="usuario" autocomplete="username" required></label>
    <label>Senha<input id="senha" type="password" autocomplete="current-password" required></label>
    <p class="sub">O primeiro acesso é Administrador, senha adm@adm.</p>
    <p class="erro" id="erro-entrar"></p>
    <button type="submit">Entrar</button>
  </form>
  <div id="painel" hidden>
    <p class="aviso" id="aviso-ig" hidden>O Instagram ainda não está conectado na ficha deste cliente. A MT Automações precisa informar a conta antes da postagem sair.</p>
    <form id="agendar" class="card">
      <h2 style="margin:0 0 4px;font-size:18px">Nova postagem</h2>
      <p class="sub" style="margin:0">A foto sobe para a nuvem e sai no horário, sem o computador da loja ligado.</p>
      <label>Foto<input id="foto" type="file" accept="image/*" required></label>
      <label>Legenda<textarea id="legenda" maxlength="2000" required></textarea></label>
      <label>Link (opcional, usado no story)<input id="link" type="url" placeholder="https://"></label>
      <div class="linha">
        <label>Quando<input id="quando" type="datetime-local" required></label>
        <label>Forma
          <select id="forma">
            <option value="post">Postagem</option>
            <option value="story">Story</option>
            <option value="ambos">Postagem e story</option>
          </select>
        </label>
      </div>
      <p class="erro" id="erro-agendar"></p>
      <button type="submit">Agendar</button>
    </form>
    <section class="card" style="margin-top:14px">
      <h2 style="margin:0 0 8px;font-size:18px">Postagens</h2>
      <div id="lista" class="sub">Nenhuma postagem ainda.</div>
    </section>
    <section class="card" id="box-usuarios" style="margin-top:14px">
      <h2 style="margin:0 0 8px;font-size:18px">Usuários</h2>
      <p class="sub" id="eu"></p>
      <form id="form-senha">
        <label>Senha atual<input id="senha-atual" type="password" autocomplete="current-password" required></label>
        <label>Nova senha<input id="senha-nova" type="password" autocomplete="new-password" required></label>
        <p class="sub">A nova senha precisa ter pelo menos 8 caracteres, com letras e números.</p>
        <p class="ok" id="ok-senha"></p>
        <p class="erro" id="erro-senha"></p>
        <button type="submit">Alterar minha senha</button>
      </form>
      <div id="criar-usuario" hidden>
        <form id="form-usuario" style="margin-top:16px">
          <label>Nome do novo usuário<input id="novo-nome" maxlength="80" required></label>
          <label>Senha<input id="novo-senha" type="password" autocomplete="new-password" required></label>
          <p class="erro" id="erro-usuario"></p>
          <button type="submit">Criar usuário</button>
        </form>
        <div id="lista-usuarios"></div>
      </div>
      <p style="text-align:right"><button type="button" class="ghost" id="sair">Sair</button></p>
    </section>
  </div>
</main>
<footer>MT Automações · (34) 3674-1937</footer>
<script>
const token = location.pathname.split('/').filter(Boolean).pop();
const chave = 'mt-oferta-' + token;
const $ = (s) => document.querySelector(s);
function sessao() { return sessionStorage.getItem(chave) || ''; }
function erro(id, msg) { const el = $(id); if (el) el.textContent = msg || ''; }
function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessao() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/ofertas/acesso') {
    sessionStorage.removeItem(chave);
    $('#painel').hidden = true;
    $('#entrar').hidden = false;
  }
  return data;
}
function quandoTexto(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function pintar(loja) {
  $('#loja').textContent = loja.nome || 'Central de Ofertas';
  $('#aviso-ig').hidden = !!loja.instagram;
  const lista = $('#lista');
  const itens = loja.itens || [];
  lista.innerHTML = itens.length ? itens.map((n) =>
    '<div class="item"><strong>' + quandoTexto(n.quando) + ' · ' + (n.forma === 'story' ? 'Story' : 'Postagem') + '</strong>'
    + '<span class="sub">' + escHtml(n.status || '') + (n.erro ? ' · ' + escHtml(n.erro) : '') + '</span></div>'
  ).join('') : 'Nenhuma postagem ainda.';
  const eu = loja.usuario || {};
  $('#eu').textContent = eu.nome ? ('Entrou como ' + eu.nome + (eu.administrador ? ' · pode criar usuários' : '')) : '';
  $('#criar-usuario').hidden = !eu.administrador;
  const pessoas = $('#lista-usuarios');
  const usuarios = loja.usuarios || [];
  pessoas.innerHTML = usuarios.map((u) =>
    '<div class="item"><strong>' + escHtml(u.nome) + (u.administrador ? ' · Administrador' : '') + '</strong>'
    + (u.administrador ? '' : '<button type="button" class="ghost" data-remover="' + escHtml(u.id) + '">Remover</button>')
    + '</div>'
  ).join('');
  $('#entrar').hidden = true;
  $('#painel').hidden = false;
}
async function carregar() {
  if (!sessao()) return;
  const r = await api('/api/ofertas/loja?token=' + encodeURIComponent(token));
  if (!r.ok) { sessionStorage.removeItem(chave); return; }
  pintar(r);
}
$('#entrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  erro('#erro-entrar', '');
  const r = await api('/api/ofertas/acesso', { token, usuario: $('#usuario').value, senha: $('#senha').value });
  if (!r.ok) { erro('#erro-entrar', r.error || 'Não foi possível entrar.'); return; }
  sessionStorage.setItem(chave, r.sessao);
  $('#senha').value = '';
  pintar(r);
});
$('#form-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  erro('#erro-senha', '');
  erro('#ok-senha', '');
  const r = await api('/api/ofertas/usuarios', {
    token,
    acao: 'senha',
    senha_atual: $('#senha-atual').value,
    senha_nova: $('#senha-nova').value,
  });
  if (!r.ok) { erro('#erro-senha', r.error || 'Não foi possível alterar a senha.'); return; }
  $('#senha-atual').value = '';
  $('#senha-nova').value = '';
  erro('#ok-senha', 'Senha alterada.');
  pintar(r);
});
$('#form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  erro('#erro-usuario', '');
  const r = await api('/api/ofertas/usuarios', {
    token,
    acao: 'criar',
    nome: $('#novo-nome').value,
    senha: $('#novo-senha').value,
  });
  if (!r.ok) { erro('#erro-usuario', r.error || 'Não foi possível criar o usuário.'); return; }
  $('#novo-nome').value = '';
  $('#novo-senha').value = '';
  pintar(r);
});
$('#lista-usuarios').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remover]');
  if (!btn) return;
  erro('#erro-usuario', '');
  const r = await api('/api/ofertas/usuarios', { token, acao: 'remover', id: btn.dataset.remover });
  if (!r.ok) { erro('#erro-usuario', r.error || 'Não foi possível remover.'); return; }
  pintar(r);
});
async function reduzir(file) {
  const bmp = await createImageBitmap(file);
  const max = 1080;
  const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * escala));
  canvas.height = Math.max(1, Math.round(bmp.height * escala));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86));
  const buf = await blob.arrayBuffer();
  let s = '';
  const bytes = new Uint8Array(buf);
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) s += String.fromCharCode(...bytes.subarray(i, i + passo));
  return btoa(s);
}
$('#agendar').addEventListener('submit', async (e) => {
  e.preventDefault();
  erro('#erro-agendar', '');
  const arquivo = $('#foto').files[0];
  if (!arquivo) { erro('#erro-agendar', 'Escolha a foto.'); return; }
  const btn = $('#agendar button[type="submit"]');
  btn.disabled = true;
  try {
    const foto = await reduzir(arquivo);
    const quando = new Date($('#quando').value);
    if (Number.isNaN(quando.getTime())) { erro('#erro-agendar', 'Informe a data e a hora.'); return; }
    const r = await api('/api/ofertas/agendar', {
      token,
      foto,
      legenda: $('#legenda').value,
      link: $('#link').value,
      quando: quando.toISOString(),
      forma: $('#forma').value,
    });
    if (!r.ok) { erro('#erro-agendar', r.error || 'Não foi possível agendar.'); return; }
    $('#legenda').value = '';
    $('#link').value = '';
    $('#foto').value = '';
    pintar(r);
  } catch (err) {
    erro('#erro-agendar', err.message || 'Não foi possível ler a foto.');
  } finally {
    btn.disabled = false;
  }
});
$('#sair').addEventListener('click', () => {
  sessionStorage.removeItem(chave);
  $('#painel').hidden = true;
  $('#entrar').hidden = false;
});
carregar();
</script>
</body>
</html>`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function paginaOfertas() {
  return new Response(HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    },
  });
}

async function clienteDoToken(env, token) {
  const tok = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(tok)) return null;
  return env.DB.prepare(
    'SELECT * FROM clientes WHERE oferta_token = ? AND aplicacao = ?'
  ).bind(tok, APP).first();
}

export async function sessaoOferta(env, request, assinar) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [corpo, sig] = token.split('.');
  if (!corpo || !sig) return null;
  const esperado = await assinar(`oferta.${corpo}`);
  if (esperado.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= esperado.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const pad = corpo.replace(/-/g, '+').replace(/_/g, '/');
    const dados = JSON.parse(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4)));
    if (dados.tipo !== 'oferta' || !(Number(dados.exp) > Date.now())) return null;
    if (dados.app !== APP) return null;
    return dados;
  } catch {
    return null;
  }
}

async function itensDaLoja(env, cnpj) {
  const res = await env.DB.prepare(
    `SELECT quando, forma, status, erro FROM oferta_agenda
     WHERE loja_id = ? AND oferta_id = 'simples' AND status != 'cancelado'
     ORDER BY quando DESC LIMIT 30`
  ).bind(cnpj).all();
  return res.results || [];
}

const SENHA_INICIAL = 'adm@adm';
const LOGIN_ADMIN = 'administrador';
let tabelaUsuariosPronta = false;

function loginDe(nome) {
  return String(nome || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function senhaFraca(s) {
  const t = String(s || '');
  if (t.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return 'Use letras e números.';
  return '';
}

function usuarioPublico(u) {
  return {
    id: u.id,
    nome: u.nome,
    administrador: Number(u.administrador) === 1,
  };
}

async function garantirUsuarios(env) {
  if (tabelaUsuariosPronta) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS oferta_usuarios (
    id TEXT PRIMARY KEY,
    cnpj TEXT NOT NULL,
    aplicacao TEXT NOT NULL,
    nome TEXT NOT NULL,
    login TEXT NOT NULL,
    senha_hash TEXT NOT NULL,
    administrador INTEGER NOT NULL DEFAULT 0,
    senha_inicial INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL
  )`).run();
  await env.DB.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_oferta_usuario_login ON oferta_usuarios (cnpj, aplicacao, login)'
  ).run();
  tabelaUsuariosPronta = true;
}

async function listarUsuarios(env, cnpj) {
  const res = await env.DB.prepare(
    'SELECT id, nome, administrador FROM oferta_usuarios WHERE cnpj = ? AND aplicacao = ? ORDER BY administrador DESC, nome'
  ).bind(cnpj, APP).all();
  return (res.results || []).map(usuarioPublico);
}

export async function garantirUsuarioAdmin(env, cli, hashSenha) {
  await garantirUsuarios(env);
  const atual = await env.DB.prepare(
    'SELECT * FROM oferta_usuarios WHERE cnpj = ? AND aplicacao = ? AND login = ?'
  ).bind(cli.cnpj, APP, LOGIN_ADMIN).first();
  if (atual) return atual;
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO oferta_usuarios (id, cnpj, aplicacao, nome, login, senha_hash, administrador, senha_inicial, criado_em)
       VALUES (?, ?, ?, 'Administrador', ?, ?, 1, 1, ?)`
    ).bind(id, cli.cnpj, APP, LOGIN_ADMIN, await hashSenha(SENHA_INICIAL), agora).run();
  } catch (e) {
    const deNovo = await env.DB.prepare(
      'SELECT * FROM oferta_usuarios WHERE cnpj = ? AND aplicacao = ? AND login = ?'
    ).bind(cli.cnpj, APP, LOGIN_ADMIN).first();
    if (deNovo) return deNovo;
    throw e;
  }
  return env.DB.prepare('SELECT * FROM oferta_usuarios WHERE id = ?').bind(id).first();
}

export async function resumoAcessoOferta(env, cli, hashSenha) {
  if (cli?.aplicacao !== APP) return null;
  const admin = await garantirUsuarioAdmin(env, cli, hashSenha);
  const inicial = Number(admin?.senha_inicial) === 1;
  return {
    nome: 'Administrador',
    senha: inicial ? SENHA_INICIAL : '',
    senha_inicial: inicial,
  };
}

export async function restaurarUsuarioAdmin(env, cli, hashSenha) {
  const admin = await garantirUsuarioAdmin(env, cli, hashSenha);
  await env.DB.prepare(
    'UPDATE oferta_usuarios SET senha_hash = ?, senha_inicial = 1 WHERE id = ?'
  ).bind(await hashSenha(SENHA_INICIAL), admin.id).run();
  return { nome: 'Administrador', senha: SENHA_INICIAL, senha_inicial: true };
}

function vista(cli, itens, usuario, usuarios) {
  return {
    ok: true,
    nome: cli.fantasia || cli.razao || 'Central de Ofertas',
    instagram: !!(String(cli.ig_token || '').trim() && String(cli.ig_user_id || '').replace(/\D/g, '').length >= 5),
    itens,
    usuario: usuario ? usuarioPublico(usuario) : null,
    usuarios: usuarios || [],
  };
}

async function respostaLoja(env, cli, usuario) {
  const itens = await itensDaLoja(env, cli.cnpj).catch(() => []);
  const usuarios = Number(usuario?.administrador) === 1 ? await listarUsuarios(env, cli.cnpj) : [];
  return vista(cli, itens, usuario, usuarios);
}

export async function entrarOferta(request, env, { hashSenha, conferirHash, emitir }) {
  const body = await request.json().catch(() => ({}));
  const cli = await clienteDoToken(env, body.token);
  if (!cli || cli.status !== 'liberado' || Number(cli.central_ofertas) !== 1) {
    return json({ ok: false, error: 'Este link não está liberado.' }, 404);
  }
  await garantirUsuarioAdmin(env, cli, hashSenha);
  const login = loginDe(body.usuario);
  const usuario = login ? await env.DB.prepare(
    'SELECT * FROM oferta_usuarios WHERE cnpj = ? AND aplicacao = ? AND login = ?'
  ).bind(cli.cnpj, APP, login).first() : null;
  let hash = null;
  try { hash = JSON.parse(usuario?.senha_hash || ''); } catch { /* hash inválido */ }
  if (!usuario || !(await conferirHash(body.senha, hash))) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ ok: false, error: 'Usuário ou senha inválidos.' }, 401);
  }
  const sessao = await emitir(cli.cnpj, usuario.id);
  return json({ ...(await respostaLoja(env, cli, usuario)), sessao });
}

async function lojaAutenticada(request, env, url, ler) {
  const sess = await ler(request);
  if (!sess?.uid) return { erro: json({ ok: false, error: 'Entre novamente.' }, 401) };
  const token = String(url.searchParams.get('token') || '');
  const cli = await clienteDoToken(env, token);
  if (!cli || cli.cnpj !== sess.cnpj) return { erro: json({ ok: false, error: 'Link inválido.' }, 403) };
  if (cli.status !== 'liberado' || Number(cli.central_ofertas) !== 1) {
    return { erro: json({ ok: false, error: 'Este link não está liberado.' }, 403) };
  }
  const usuario = await env.DB.prepare(
    'SELECT id, nome, login, administrador FROM oferta_usuarios WHERE id = ? AND cnpj = ? AND aplicacao = ?'
  ).bind(String(sess.uid), cli.cnpj, APP).first();
  if (!usuario) return { erro: json({ ok: false, error: 'Entre novamente.' }, 401) };
  return { cli, usuario };
}

export async function lojaOferta(request, env, url, ler) {
  const auth = await lojaAutenticada(request, env, url, ler);
  if (auth.erro) return auth.erro;
  return json(await respostaLoja(env, auth.cli, auth.usuario));
}

export async function usuariosOferta(request, env, ler, { hashSenha, conferirHash }) {
  const body = await request.json().catch(() => ({}));
  const pedido = new URL(request.url);
  pedido.searchParams.set('token', String(body.token || ''));
  const auth = await lojaAutenticada(request, env, pedido, ler);
  if (auth.erro) return auth.erro;
  const acao = String(body.acao || '');
  if (acao === 'senha') {
    const atual = await env.DB.prepare('SELECT * FROM oferta_usuarios WHERE id = ?').bind(auth.usuario.id).first();
    let hash = null;
    try { hash = JSON.parse(atual?.senha_hash || ''); } catch { /* hash inválido */ }
    if (!(await conferirHash(body.senha_atual, hash))) {
      return json({ ok: false, error: 'A senha atual não confere.' }, 400);
    }
    const fraca = senhaFraca(body.senha_nova);
    if (fraca) return json({ ok: false, error: fraca }, 400);
    await env.DB.prepare('UPDATE oferta_usuarios SET senha_hash = ?, senha_inicial = 0 WHERE id = ?')
      .bind(await hashSenha(String(body.senha_nova)), atual.id).run();
  } else if (acao === 'criar') {
    if (Number(auth.usuario.administrador) !== 1) {
      return json({ ok: false, error: 'Só o Administrador cria usuários.' }, 403);
    }
    const nome = String(body.nome || '').trim().slice(0, 80);
    const login = loginDe(nome);
    if (login.length < 3) return json({ ok: false, error: 'Informe um nome com pelo menos 3 letras ou números.' }, 400);
    const fraca = senhaFraca(body.senha);
    if (fraca) return json({ ok: false, error: fraca }, 400);
    const existe = await env.DB.prepare(
      'SELECT id FROM oferta_usuarios WHERE cnpj = ? AND aplicacao = ? AND login = ?'
    ).bind(auth.cli.cnpj, APP, login).first();
    if (existe) return json({ ok: false, error: 'Já existe um usuário com esse nome.' }, 409);
    await env.DB.prepare(
      `INSERT INTO oferta_usuarios (id, cnpj, aplicacao, nome, login, senha_hash, administrador, senha_inicial, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`
    ).bind(crypto.randomUUID(), auth.cli.cnpj, APP, nome, login, await hashSenha(String(body.senha)), new Date().toISOString()).run();
  } else if (acao === 'remover') {
    if (Number(auth.usuario.administrador) !== 1) {
      return json({ ok: false, error: 'Só o Administrador remove usuários.' }, 403);
    }
    const alvo = await env.DB.prepare(
      'SELECT * FROM oferta_usuarios WHERE id = ? AND cnpj = ? AND aplicacao = ?'
    ).bind(String(body.id || ''), auth.cli.cnpj, APP).first();
    if (!alvo) return json({ ok: false, error: 'Usuário não encontrado.' }, 404);
    if (Number(alvo.administrador) === 1) return json({ ok: false, error: 'O Administrador não pode ser removido.' }, 400);
    await env.DB.prepare('DELETE FROM oferta_usuarios WHERE id = ?').bind(alvo.id).run();
  } else {
    return json({ ok: false, error: 'Ação inválida.' }, 400);
  }
  return json(await respostaLoja(env, auth.cli, auth.usuario));
}

export async function agendarOferta(request, env, url, ler, { garantirAgenda, idAgenda }) {
  const body = await request.json().catch(() => ({}));
  const pedido = new URL(request.url);
  pedido.searchParams.set('token', String(body.token || url.searchParams.get('token') || ''));
  const auth = await lojaAutenticada(request, env, pedido, ler);
  if (auth.erro) return auth.erro;
  const cli = auth.cli;
  const usuario = auth.usuario;
  if (!String(cli.ig_token || '').trim() || String(cli.ig_user_id || '').replace(/\D/g, '').length < 5) {
    return json({ ok: false, error: 'O Instagram ainda não está conectado na ficha deste cliente.' }, 400);
  }
  const legenda = String(body.legenda || '').trim().slice(0, 2000);
  if (!legenda) return json({ ok: false, error: 'Escreva a legenda.' }, 400);
  const quando = new Date(String(body.quando || ''));
  if (Number.isNaN(quando.getTime())) return json({ ok: false, error: 'Informe a data e a hora.' }, 400);
  let bytes;
  try { bytes = Uint8Array.from(atob(String(body.foto || '')), (c) => c.charCodeAt(0)); }
  catch { return json({ ok: false, error: 'Foto inválida.' }, 400); }
  if (!bytes.length || bytes.length > 1500000) return json({ ok: false, error: 'A foto precisa ter até 1,5 MB.' }, 400);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ ok: false, error: 'Envie a foto em JPEG.' }, 400);
  if (!env.FOTOS) return json({ ok: false, error: 'O armazenamento de fotos não está disponível.' }, 500);
  const base = String(env.FOTOS_PUBLIC_BASE || '').replace(/\/$/, '');
  if (!base) return json({ ok: false, error: 'O endereço público das fotos não está configurado.' }, 500);
  const slot = crypto.randomUUID().replace(/-/g, '');
  const chave = `${cli.cnpj}/simples/${slot}.jpg`;
  await env.FOTOS.put(chave, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  const imagem = `${base}/${chave}`;
  await garantirAgenda(env);
  const formas = body.forma === 'ambos' ? ['post', 'story'] : (body.forma === 'story' ? ['story'] : ['post']);
  const agora = new Date().toISOString();
  const link = String(body.link || '').trim().slice(0, 300);
  for (const forma of formas) {
    const id = idAgenda(cli.cnpj, 'simples', slot, forma);
    await env.DB.prepare(
      `INSERT INTO oferta_agenda (id, loja_id, oferta_id, slot_id, forma, quando, image_url, caption, link, status, creation_id, post_id, erro, tentativa_em, criado_em)
       VALUES (?, ?, 'simples', ?, ?, ?, ?, ?, ?, 'pendente', '', '', '', '', ?)
       ON CONFLICT (id) DO UPDATE SET
         quando = excluded.quando, image_url = excluded.image_url, caption = excluded.caption, link = excluded.link,
         status = 'pendente', creation_id = '', post_id = '', erro = '', tentativa_em = ''`
    ).bind(id, cli.cnpj, slot, forma, quando.toISOString(), imagem, legenda, link, agora).run();
  }
  return json(await respostaLoja(env, cli, usuario));
}
