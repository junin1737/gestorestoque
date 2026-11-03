/**
 * Central de Ofertas no navegador, para o cliente que não instala o Gestor.
 * O link é /ofertas/<token>. A entrada usa a senha do supervisor da ficha.
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
    <p>Entre com a senha do supervisor para agendar as postagens desta loja.</p>
    <label>Senha do supervisor<input id="senha" type="password" autocomplete="current-password" required></label>
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
    + '<span class="sub">' + (n.status || '') + (n.erro ? ' · ' + n.erro : '') + '</span></div>'
  ).join('') : 'Nenhuma postagem ainda.';
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
  const r = await api('/api/ofertas/acesso', { token, senha: $('#senha').value });
  if (!r.ok) { erro('#erro-entrar', r.error || 'Não foi possível entrar.'); return; }
  sessionStorage.setItem(chave, r.sessao);
  $('#senha').value = '';
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

function vista(cli, itens) {
  return {
    ok: true,
    nome: cli.fantasia || cli.razao || 'Central de Ofertas',
    instagram: !!(String(cli.ig_token || '').trim() && String(cli.ig_user_id || '').replace(/\D/g, '').length >= 5),
    itens,
  };
}

export async function entrarOferta(request, env, { conferirSenha, emitir }) {
  const body = await request.json().catch(() => ({}));
  const cli = await clienteDoToken(env, body.token);
  if (!cli || cli.status !== 'liberado' || Number(cli.central_ofertas) !== 1) {
    return json({ ok: false, error: 'Este link não está liberado.' }, 404);
  }
  const senha = await conferirSenha(cli, body.senha);
  if (senha === 'indefinida') {
    return json({ ok: false, error: 'Defina a senha do supervisor na ficha deste cliente, no painel.' }, 400);
  }
  if (senha !== 'ok') {
    await new Promise((r) => setTimeout(r, 800));
    return json({ ok: false, error: 'Senha do supervisor inválida.' }, 401);
  }
  const sessao = await emitir(cli.cnpj);
  const itens = await itensDaLoja(env, cli.cnpj).catch(() => []);
  return json({ ...vista(cli, itens), sessao });
}

async function lojaAutenticada(request, env, url, ler) {
  const sess = await ler(request);
  if (!sess) return { erro: json({ ok: false, error: 'Entre novamente.' }, 401) };
  const token = String(url.searchParams.get('token') || '');
  const cli = await clienteDoToken(env, token);
  if (!cli || cli.cnpj !== sess.cnpj) return { erro: json({ ok: false, error: 'Link inválido.' }, 403) };
  if (cli.status !== 'liberado' || Number(cli.central_ofertas) !== 1) {
    return { erro: json({ ok: false, error: 'Este link não está liberado.' }, 403) };
  }
  return { cli };
}

export async function lojaOferta(request, env, url, ler) {
  const auth = await lojaAutenticada(request, env, url, ler);
  if (auth.erro) return auth.erro;
  const itens = await itensDaLoja(env, auth.cli.cnpj).catch(() => []);
  return json(vista(auth.cli, itens));
}

export async function agendarOferta(request, env, url, ler, { garantirAgenda, idAgenda }) {
  const body = await request.json().catch(() => ({}));
  const pedido = new URL(request.url);
  pedido.searchParams.set('token', String(body.token || url.searchParams.get('token') || ''));
  const auth = await lojaAutenticada(request, env, pedido, ler);
  if (auth.erro) return auth.erro;
  const cli = auth.cli;
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
  const itens = await itensDaLoja(env, cli.cnpj);
  return json(vista(cli, itens));
}
