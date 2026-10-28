/**
 * Fila de alterações e fotos da Central de Ofertas.
 * A fila fica no D1 já usado pelo painel. As fotos ficam no R2 gestor-ofertas.
 */

const APP_PADRAO = 'GestorEstoque';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function garantir(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS alteracao_fila (
      id TEXT PRIMARY KEY,
      loja_id TEXT NOT NULL,
      produto_id TEXT NOT NULL,
      campo TEXT NOT NULL,
      valor_visto TEXT,
      valor_novo TEXT,
      periodo TEXT,
      usuario TEXT,
      criado_em TEXT NOT NULL,
      status TEXT NOT NULL,
      resultado TEXT
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_fila_loja ON alteracao_fila (loja_id, status, criado_em)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS catalogo_copia (
      loja_id TEXT NOT NULL,
      produto_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      PRIMARY KEY (loja_id, produto_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS produto_foto (
      loja_id TEXT NOT NULL,
      produto_id TEXT NOT NULL,
      ean TEXT,
      chave_r2 TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      PRIMARY KEY (loja_id, produto_id)
    )`),
  ]);
}

function lojaDaUrl(url) {
  return String(url.searchParams.get('loja') || '').replace(/\D/g, '');
}

export async function rotaOfertas(request, env, url, instalacaoDaRequisicao) {
  const cnpj = await instalacaoDaRequisicao(request, env, APP_PADRAO);
  if (!cnpj) return json({ ok: false, error: 'Instalação da loja não confirmada no painel.' }, 403);
  await garantir(env);
  const limite = new Date(Date.now() - 90 * 86400000).toISOString();
  await env.DB.prepare(`DELETE FROM alteracao_fila WHERE status = 'aplicada' AND criado_em < ?`).bind(limite).run();

  if (url.pathname === '/api/ofertas/fila' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: 'ID da fila inválido.' }, 400);
    const ja = await env.DB.prepare('SELECT id, status FROM alteracao_fila WHERE id = ?').bind(id).first();
    if (ja) return json({ ok: true, id, status: ja.status, repetido: true });
    await env.DB.prepare(
      `INSERT INTO alteracao_fila (id, loja_id, produto_id, campo, valor_visto, valor_novo, periodo, usuario, criado_em, status, resultado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', '')`
    ).bind(
      id, cnpj, String(body.produto_id || ''), String(body.campo || ''),
      body.valor_visto == null ? null : String(body.valor_visto),
      body.valor_novo == null ? null : String(body.valor_novo),
      body.periodo ? JSON.stringify(body.periodo) : null,
      String(body.usuario || '').slice(0, 80),
      String(body.criado_em || new Date().toISOString()),
    ).run();
    return json({ ok: true, id, status: 'pendente' });
  }

  if (url.pathname === '/api/ofertas/fila' && request.method === 'GET') {
    const pedido = lojaDaUrl(url);
    if (pedido && pedido !== cnpj) return json({ ok: false, error: 'A fila é só da loja desta instalação.' }, 403);
    const status = String(url.searchParams.get('status') || '');
    const sql = status
      ? 'SELECT * FROM alteracao_fila WHERE loja_id = ? AND status = ? ORDER BY criado_em'
      : 'SELECT * FROM alteracao_fila WHERE loja_id = ? ORDER BY criado_em';
    const res = status
      ? await env.DB.prepare(sql).bind(cnpj, status).all()
      : await env.DB.prepare(sql).bind(cnpj).all();
    return json({ ok: true, itens: res.results || [] });
  }

  const conf = url.pathname.match(/^\/api\/ofertas\/fila\/([0-9a-f-]{36})\/confirmar$/i);
  if (conf && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const status = ['aplicada', 'conflito', 'erro', 'pendente'].includes(body.status) ? body.status : 'erro';
    const r = await env.DB.prepare(
      `UPDATE alteracao_fila SET status = ?, resultado = ? WHERE id = ? AND loja_id = ?`
    ).bind(status, String(body.resultado || '').slice(0, 500), conf[1], cnpj).run();
    if (!r.meta?.changes) return json({ ok: false, error: 'Item da fila não encontrado.' }, 404);
    return json({ ok: true, id: conf[1], status });
  }

  if (url.pathname === '/api/ofertas/foto' && request.method === 'POST') {
    if (!env.FOTOS) return json({ ok: false, error: 'O bucket de fotos ainda não está ligado ao worker.' }, 500);
    const body = await request.json().catch(() => ({}));
    const produtoId = String(body.produto_id || '').replace(/[^\w.-]/g, '').slice(0, 40);
    const ean = String(body.ean || '').replace(/\D/g, '').slice(0, 20) || 'sem-codigo';
    if (!produtoId) return json({ ok: false, error: 'Produto inválido.' }, 400);
    let bytes;
    try { bytes = Uint8Array.from(atob(String(body.base64 || '')), (c) => c.charCodeAt(0)); }
    catch { return json({ ok: false, error: 'Foto inválida.' }, 400); }
    if (!bytes.length || bytes.length > 1500000) return json({ ok: false, error: 'A foto precisa ter até 1,5 MB.' }, 400);
    const chave = `${cnpj}/${produtoId}/${ean}`;
    const tipo = /^image\/(jpeg|png|webp)$/.test(body.tipo) ? body.tipo : 'image/jpeg';
    await env.FOTOS.put(chave, bytes, { httpMetadata: { contentType: tipo } });
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO produto_foto (loja_id, produto_id, ean, chave_r2, atualizado_em) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (loja_id, produto_id) DO UPDATE SET ean = excluded.ean, chave_r2 = excluded.chave_r2, atualizado_em = excluded.atualizado_em`
    ).bind(cnpj, produtoId, String(body.ean || '').replace(/\D/g, ''), chave, agora).run();
    const base = String(env.FOTOS_PUBLIC_BASE || '').replace(/\/$/, '');
    return json({
      ok: true,
      chave,
      url: base ? `${base}/${chave}` : '',
      aviso: base ? '' : 'A foto foi guardada. Falta o endereço público do R2 para o Instagram conseguir baixá-la.',
    });
  }

  if (url.pathname === '/api/ofertas/publicar' && request.method === 'POST') {
    return publicarNoInstagram(request, env, cnpj);
  }

  return json({ ok: false, error: 'Rota não encontrada.' }, 404);
}

function erroInstagram(msg) {
  return String(msg || 'O Instagram não confirmou a publicação.')
    .replace(/access_token[=:][^&\s"']+/gi, 'access_token')
    .replace(/client_secret[=:][^&\s"']+/gi, 'client_secret')
    .slice(0, 180);
}

async function publicarNoInstagram(request, env, cnpj) {
  const body = await request.json().catch(() => ({}));
  const cli = await env.DB.prepare(
    'SELECT ig_token, ig_user_id FROM clientes WHERE cnpj = ? AND aplicacao = ?'
  ).bind(cnpj, APP_PADRAO).first();
  const token = String(cli?.ig_token || '').trim();
  const igId = String(cli?.ig_user_id || '').replace(/\D/g, '');
  if (!token || igId.length < 5) {
    return json({ ok: false, error: 'Nenhuma conta do Instagram conectada no cadastro do cliente.' }, 400);
  }
  const base = String(env.FOTOS_PUBLIC_BASE || '').replace(/\/$/, '');
  const imagem = String(body.image_url || '').trim();
  if (!base || !imagem.startsWith(`${base}/`)) {
    return json({ ok: false, error: 'Anexe a foto do produto antes de postar.' }, 400);
  }
  const versao = /^v\d+\.\d+$/.test(String(env.IG_GRAPH_VERSION || '').trim())
    ? String(env.IG_GRAPH_VERSION).trim()
    : 'v26.0';
  const etapa = body.etapa === 'consultar' ? 'consultar' : 'criar';
  if (etapa === 'criar') {
    const params = new URLSearchParams();
    params.set('image_url', imagem);
    const forma = body.forma === 'story' ? 'story' : 'post';
    if (forma === 'story') params.set('media_type', 'STORIES');
    const legenda = String(body.caption || '').trim().slice(0, 2000);
    if (legenda) params.set('caption', legenda);
    const link = String(body.link || '').trim();
    if (forma === 'story' && /^https?:\/\/\S+$/i.test(link)) params.set('link', link.slice(0, 300));
    params.set('access_token', token);
    let resp;
    try {
      resp = await fetch(`https://graph.instagram.com/${versao}/${igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch {
      return json({ ok: false, error: 'Não foi possível falar com o Instagram.' }, 502);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error || !data.id) return json({ ok: false, error: erroInstagram(data.error?.message) }, 400);
    return json({
      ok: true,
      etapa: 'criado',
      creation_id: String(data.id),
      espera_ms: 4000,
      mensagem: 'Imagem enviada. Aguardando o Instagram.',
    });
  }
  const creationId = String(body.creation_id || '').trim();
  if (!/^\d{5,40}$/.test(creationId)) return json({ ok: false, error: 'Publicação sem identificador.' }, 400);
  const statusUrl = new URL(`https://graph.instagram.com/${versao}/${creationId}`);
  statusUrl.searchParams.set('fields', 'status_code');
  statusUrl.searchParams.set('access_token', token);
  let statusResp;
  try { statusResp = await fetch(statusUrl); }
  catch { return json({ ok: false, error: 'Não foi possível falar com o Instagram.' }, 502); }
  const status = await statusResp.json().catch(() => ({}));
  if (!statusResp.ok || status.error) return json({ ok: false, error: erroInstagram(status.error?.message) }, 400);
  const codigo = String(status.status_code || '');
  if (codigo === 'ERROR' || codigo === 'EXPIRED') {
    return json({
      ok: false,
      error: codigo === 'EXPIRED' ? 'A imagem expirou antes da publicação.' : 'O Instagram recusou a imagem.',
    }, 400);
  }
  if (codigo !== 'FINISHED') {
    return json({
      ok: true,
      etapa: 'processando',
      creation_id: creationId,
      espera_ms: 8000,
      mensagem: 'A imagem ainda está sendo preparada.',
    });
  }
  const publicar = new URLSearchParams();
  publicar.set('creation_id', creationId);
  publicar.set('access_token', token);
  let pubResp;
  try {
    pubResp = await fetch(`https://graph.instagram.com/${versao}/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publicar.toString(),
    });
  } catch {
    return json({ ok: false, error: 'Não foi possível publicar.' }, 502);
  }
  const publicado = await pubResp.json().catch(() => ({}));
  if (!pubResp.ok || publicado.error || !publicado.id) {
    return json({ ok: false, error: erroInstagram(publicado.error?.message) }, 400);
  }
  return json({ ok: true, etapa: 'publicado', post_id: String(publicado.id), creation_id: creationId, mensagem: 'Publicado.' });
}
