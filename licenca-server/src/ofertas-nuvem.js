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

  if (url.pathname === '/api/ofertas/agenda' && (request.method === 'GET' || request.method === 'POST')) {
    return await rotaAgenda(request, env, cnpj);
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
  const passo = await passoInstagram(env, cnpj, body);
  return json(passo.ok ? passo : { ok: false, error: passo.error }, passo.status || (passo.ok ? 200 : 400));
}

export async function garantirAgenda(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS oferta_agenda (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,
    oferta_id TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    forma TEXT NOT NULL,
    quando TEXT NOT NULL,
    image_url TEXT NOT NULL,
    caption TEXT,
    link TEXT,
    status TEXT NOT NULL,
    creation_id TEXT,
    post_id TEXT,
    erro TEXT,
    tentativa_em TEXT,
    criado_em TEXT NOT NULL
  )`).run();
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_oferta_agenda_slot ON oferta_agenda (loja_id, oferta_id, slot_id, forma)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_oferta_agenda_quando ON oferta_agenda (status, quando)').run();
}

export function idAgenda(loja, oferta, slot, forma) {
  return `${loja}:${oferta}:${slot}:${forma}`.slice(0, 180);
}

async function rotaAgenda(request, env, cnpj) {
  await garantirAgenda(env);
  if (request.method === 'GET') {
    const res = await env.DB.prepare(
      `SELECT oferta_id, slot_id, forma, quando, status, post_id, erro FROM oferta_agenda
       WHERE loja_id = ? AND status != 'cancelado' ORDER BY quando`
    ).bind(cnpj).all();
    return json({ ok: true, itens: res.results || [] });
  }
  const body = await request.json().catch(() => ({}));
  const ofertaId = String(body.oferta_id || '').replace(/[^\w.-]/g, '').slice(0, 80);
  if (!ofertaId) return json({ ok: false, error: 'Oferta inválida.' }, 400);
  const manter = body.manter === true;
  const retirar = new Set((Array.isArray(body.retirar) ? body.retirar : []).map((id) => String(id).slice(0, 80)).filter(Boolean));
  if (!manter) {
    await env.DB.prepare(
      `UPDATE oferta_agenda SET status = 'cancelado'
       WHERE loja_id = ? AND oferta_id = ? AND status IN ('pendente', 'erro', 'criado')`
    ).bind(cnpj, ofertaId).run();
  }
  for (const slotId of retirar) {
    await env.DB.prepare(
      `UPDATE oferta_agenda SET status = 'cancelado'
       WHERE loja_id = ? AND oferta_id = ? AND slot_id = ? AND status IN ('pendente', 'erro', 'criado')`
    ).bind(cnpj, ofertaId, slotId).run();
  }
  const base = String(env.FOTOS_PUBLIC_BASE || '').replace(/\/$/, '');
  const itens = Array.isArray(body.itens) ? body.itens.slice(0, 40) : [];
  const agora = new Date().toISOString();
  for (const item of itens) {
    const slotId = String(item?.slot_id || '').replace(/[^\w|.:-]/g, '').slice(0, 80);
    const forma = item?.forma === 'story' ? 'story' : (item?.forma === 'post' ? 'post' : '');
    const quando = new Date(String(item?.quando || ''));
    const imagem = String(item?.image_url || '').trim();
    if (!slotId || !forma || Number.isNaN(quando.getTime()) || !base || !imagem.startsWith(`${base}/`)) continue;
    const id = idAgenda(cnpj, ofertaId, slotId, forma);
    const atual = await env.DB.prepare('SELECT status FROM oferta_agenda WHERE id = ?').bind(id).first();
    if (atual?.status === 'publicado' || atual?.status === 'criado') continue;
    const caption = String(item?.caption || '').slice(0, 2000);
    const link = String(item?.link || '').trim().slice(0, 300);
    await env.DB.prepare(
      `INSERT INTO oferta_agenda (id, loja_id, oferta_id, slot_id, forma, quando, image_url, caption, link, status, creation_id, post_id, erro, tentativa_em, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', '', '', '', '', ?)
       ON CONFLICT (id) DO UPDATE SET
         quando = excluded.quando, image_url = excluded.image_url, caption = excluded.caption, link = excluded.link,
         status = 'pendente', creation_id = '', post_id = '', erro = '', tentativa_em = ''`
    ).bind(id, cnpj, ofertaId, slotId, forma, quando.toISOString(), imagem, caption, link, agora).run();
  }
  return json({ ok: true });
}

/** Um passo por vez: o cron de 1 minuto não espera o Instagram dentro da mesma chamada. */
export async function publicarAgenda(env) {
  await garantirAgenda(env);
  const agora = new Date();
  const limite = new Date(agora.getTime() - 6 * 3600 * 1000).toISOString();
  const res = await env.DB.prepare(
    `SELECT * FROM oferta_agenda
     WHERE status IN ('pendente', 'criado', 'erro') AND quando <= ? AND quando >= ?
     ORDER BY quando LIMIT 4`
  ).bind(agora.toISOString(), limite).all();
  for (const linha of res.results || []) {
    try {
      await passoAgenda(env, linha, agora);
    } catch (err) {
      console.error('Agenda da oferta:', err?.message || err);
    }
  }
}

async function passoAgenda(env, linha, agora) {
  if (linha.status === 'erro') {
    const em = Date.parse(String(linha.tentativa_em || ''));
    if (Number.isFinite(em) && agora.getTime() - em < 10 * 60 * 1000) return;
  }
  const cli = await env.DB.prepare(
    `SELECT ig_token, ig_user_id, central_ofertas, status, aplicacao FROM clientes
     WHERE cnpj = ? AND COALESCE(central_ofertas, 0) = 1 AND status = 'liberado'
       AND ig_token IS NOT NULL AND TRIM(ig_token) != ''
     ORDER BY CASE aplicacao WHEN 'GestorEstoque' THEN 0 WHEN 'CentralOfertas' THEN 1 ELSE 2 END
     LIMIT 1`
  ).bind(linha.loja_id).first();
  if (!cli) return;
  const etapa = linha.status === 'criado' && linha.creation_id ? 'consultar' : 'criar';
  const passo = await passoInstagram(env, linha.loja_id, {
    etapa,
    creation_id: linha.creation_id,
    image_url: linha.image_url,
    caption: linha.caption,
    forma: linha.forma,
    link: linha.link,
  }, cli.aplicacao);
  if (!passo.ok) {
    await env.DB.prepare(
      `UPDATE oferta_agenda SET status = 'erro', erro = ?, tentativa_em = ?, creation_id = '' WHERE id = ?`
    ).bind(String(passo.error || 'Falha ao publicar.').slice(0, 180), agora.toISOString(), linha.id).run();
    return;
  }
  if (passo.etapa === 'criado' || passo.etapa === 'processando') {
    await env.DB.prepare(
      `UPDATE oferta_agenda SET status = 'criado', creation_id = ?, erro = '' WHERE id = ?`
    ).bind(String(passo.creation_id || linha.creation_id || ''), linha.id).run();
    return;
  }
  if (passo.etapa === 'publicado') {
    await env.DB.prepare(
      `UPDATE oferta_agenda SET status = 'publicado', post_id = ?, creation_id = ?, erro = '', tentativa_em = ? WHERE id = ?`
    ).bind(String(passo.post_id || ''), String(passo.creation_id || ''), agora.toISOString(), linha.id).run();
  }
}

async function passoInstagram(env, cnpj, body, aplicacao = APP_PADRAO) {
  const cli = await env.DB.prepare(
    'SELECT ig_token, ig_user_id FROM clientes WHERE cnpj = ? AND aplicacao = ?'
  ).bind(cnpj, aplicacao).first();
  const token = String(cli?.ig_token || '').trim();
  const igId = String(cli?.ig_user_id || '').replace(/\D/g, '');
  if (!token || igId.length < 5) {
    return { ok: false, status: 400, error: 'Nenhuma conta do Instagram conectada no cadastro do cliente.' };
  }
  const base = String(env.FOTOS_PUBLIC_BASE || '').replace(/\/$/, '');
  const imagem = String(body.image_url || '').trim();
  if (!base || !imagem.startsWith(`${base}/`)) {
    return { ok: false, status: 400, error: 'Anexe a foto do produto antes de postar.' };
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
      return { ok: false, status: 502, error: 'Não foi possível falar com o Instagram.' };
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error || !data.id) return { ok: false, status: 400, error: erroInstagram(data.error?.message) };
    return {
      ok: true,
      etapa: 'criado',
      creation_id: String(data.id),
      espera_ms: 4000,
      mensagem: 'Imagem enviada. Aguardando o Instagram.',
    };
  }
  const creationId = String(body.creation_id || '').trim();
  if (!/^\d{5,40}$/.test(creationId)) return { ok: false, status: 400, error: 'Publicação sem identificador.' };
  const statusUrl = new URL(`https://graph.instagram.com/${versao}/${creationId}`);
  statusUrl.searchParams.set('fields', 'status_code');
  statusUrl.searchParams.set('access_token', token);
  let statusResp;
  try { statusResp = await fetch(statusUrl); }
  catch { return { ok: false, status: 502, error: 'Não foi possível falar com o Instagram.' }; }
  const status = await statusResp.json().catch(() => ({}));
  if (!statusResp.ok || status.error) return { ok: false, status: 400, error: erroInstagram(status.error?.message) };
  const codigo = String(status.status_code || '');
  if (codigo === 'ERROR' || codigo === 'EXPIRED') {
    return {
      ok: false,
      status: 400,
      error: codigo === 'EXPIRED' ? 'A imagem expirou antes da publicação.' : 'O Instagram recusou a imagem.',
    };
  }
  if (codigo !== 'FINISHED') {
    return {
      ok: true,
      etapa: 'processando',
      creation_id: creationId,
      espera_ms: 8000,
      mensagem: 'A imagem ainda está sendo preparada.',
    };
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
    return { ok: false, status: 502, error: 'Não foi possível publicar.' };
  }
  const publicado = await pubResp.json().catch(() => ({}));
  if (!pubResp.ok || publicado.error || !publicado.id) {
    return { ok: false, status: 400, error: erroInstagram(publicado.error?.message) };
  }
  return { ok: true, etapa: 'publicado', post_id: String(publicado.id), creation_id: creationId, mensagem: 'Publicado.' };
}
