/**
 * Servidor de passagem do acesso online do Gestor Estoque.
 *
 * - O Gestor (PC da loja) abre um WebSocket de SAÍDA para /tunel/conectar, apresentando a licença
 *   assinada pelo painel (Ed25519) e o segredo do túnel. Nenhuma porta é aberta na loja e o
 *   Firebird nunca é exposto.
 * - Cada túnel é um Durable Object (um por loja). O celular entra por /t/<id> (vindo do QR Code),
 *   recebe o cookie de roteamento e todas as requisições seguintes são repassadas pelo WebSocket.
 * - Autenticação de usuário, permissões e pareamento de aparelho continuam sendo feitos pelo Gestor.
 */

// Par da LICENCA_PRIVATE_KEY do servidor de licenças (mesma chave pública embutida no Gestor).
const CHAVE_PUBLICA_SPKI = 'MCowBQYDK2VwAyEAVzRoulQmBLiOEDO+6ohBDvRKXTPWppJNBfHRLROAlq8=';
const APLICACAO = 'GestorEstoque';
const ID_RE = /^[a-z2-7]{20,32}$/;
const COOKIE_TUNEL = 'gestor_tunel';
/** Corpo máximo de requisição (fotos da chave já chegam reduzidas pelo painel). */
const MAX_CORPO = 12 * 1024 * 1024;
const MAX_RESPOSTA = 50 * 1024 * 1024;
/** Pedaço de corpo por mensagem do WebSocket (base64 cresce ~33%; fica bem abaixo de 1 MiB). */
const PEDACO = 256 * 1024;
const TIMEOUT_MS = 90 * 1000;
const LIMITE_POR_MINUTO = 600;
/** Endereço por loja: <nse>.<domínio>, apontando para o túnel da instalação dona daquele NSE. */
const DOMINIO_PADRAO = 'smsjrdeveloper.com.br';
/** O NSE do Clipp sempre tem dígitos; subdomínios só com letras (blog, loja…) seguem para a origem. */
const APELIDO_RE = /^(?=[a-z]*[0-9])[a-z0-9]{4,40}$/;
const RESERVADOS = new Set(['www', 'acesso', 'painel', 'api', 'admin', 'mail', 'smtp', 'ftp', 'webmail', 'cpanel', 'ns1', 'ns2']);
const CACHE_APELIDO_MS = 60 * 1000;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64ParaBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesParaB64(bytes) {
  let bin = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  }
  return btoa(bin);
}

async function sha256Hex(texto) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(texto)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function iguaisTempoConstante(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

let chavePublica = null;
async function obterChavePublica() {
  if (!chavePublica) {
    chavePublica = await crypto.subtle.importKey('spki', b64ParaBytes(CHAVE_PUBLICA_SPKI), { name: 'Ed25519' }, false, ['verify']);
  }
  return chavePublica;
}

/** Licença do cabeçalho X-Licenca (base64 de {payload, sig}) → dados, se assinada, liberada e válida. */
async function verificarLicenca(valor) {
  let lic;
  try {
    lic = JSON.parse(dec.decode(b64ParaBytes(String(valor || ''))));
  } catch {
    return { ok: false, erro: 'Licença ilegível.' };
  }
  if (!lic || typeof lic.payload !== 'string' || typeof lic.sig !== 'string') return { ok: false, erro: 'Licença em formato inválido.' };
  let assinaturaOk = false;
  try {
    assinaturaOk = await crypto.subtle.verify({ name: 'Ed25519' }, await obterChavePublica(), b64ParaBytes(lic.sig), enc.encode(lic.payload));
  } catch {
    assinaturaOk = false;
  }
  if (!assinaturaOk) return { ok: false, erro: 'Assinatura da licença inválida.' };
  let dados;
  try {
    dados = JSON.parse(lic.payload);
  } catch {
    return { ok: false, erro: 'Licença ilegível.' };
  }
  if (dados.v !== 1 || !dados.cnpj) return { ok: false, erro: 'Licença incompleta.' };
  if (dados.app && dados.app !== APLICACAO) return { ok: false, erro: 'Licença de outra aplicação.' };
  if (dados.status !== 'liberado') return { ok: false, erro: 'Licença não liberada.' };
  if (!(new Date(dados.valido_ate).getTime() > Date.now())) return { ok: false, erro: 'Licença vencida.' };
  return { ok: true, dados };
}

function lerCookie(request, nome) {
  const raw = request.headers.get('Cookie') || '';
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return '';
}

function comSeguranca(resp) {
  const r = new Response(resp.body, resp);
  r.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return r;
}

function pagina(titulo, texto, status = 200) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f9;color:#1a1f26;display:grid;place-items:center;min-height:100vh}
main{max-width:420px;padding:28px;text-align:center}h1{color:#1e3a5f;font-size:22px}p{color:#5a6577;line-height:1.5}
.logo{width:72px;height:72px;border-radius:18px;background:#1e3a5f;color:#fff;font:700 28px system-ui;display:grid;place-items:center;margin:0 auto 16px}</style>
</head><body><main><div class="logo">MT</div><h1>${titulo}</h1><p>${texto}</p><p style="font-size:13px">MT Automações · (34) 3674-1937</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function apelidoDaNse(nse) {
  const a = String(nse || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return APELIDO_RE.test(a) && !RESERVADOS.has(a) ? a : '';
}

/** Subdomínio de um host do domínio (só um nível), ou '' se não for endereço de loja. */
function apelidoDoHost(hostname, dominio) {
  const h = String(hostname || '').toLowerCase();
  if (!h.endsWith(`.${dominio}`)) return '';
  const sub = h.slice(0, -(dominio.length + 1));
  return APELIDO_RE.test(sub) && !RESERVADOS.has(sub) ? sub : '';
}

const cacheApelidos = new Map();
async function tunelDoApelido(env, apelido) {
  const hit = cacheApelidos.get(apelido);
  if (hit && Date.now() - hit.em < CACHE_APELIDO_MS) return hit.tunel;
  let tunel = '';
  try {
    const r = await env.APELIDO.get(env.APELIDO.idFromName(apelido)).fetch('https://apelido/');
    tunel = String((await r.json()).tunel || '');
  } catch { /* trata como inexistente */ }
  if (!ID_RE.test(tunel)) tunel = '';
  if (cacheApelidos.size > 5000) cacheApelidos.clear();
  cacheApelidos.set(apelido, { tunel, em: Date.now() });
  return tunel;
}

async function registrarApelido(env, apelido, tunel, cnpj) {
  try {
    const r = await env.APELIDO.get(env.APELIDO.idFromName(apelido)).fetch('https://apelido/', {
      method: 'PUT',
      body: JSON.stringify({ tunel, cnpj }),
    });
    if (r.ok) cacheApelidos.set(apelido, { tunel, em: Date.now() });
  } catch { /* o Gestor continua usando o link /t/ */ }
}

function encaminharAoTunel(env, request, id) {
  // Cabeçalhos internos nunca vêm do cliente.
  const headers = new Headers(request.headers);
  for (const k of [...headers.keys()]) if (k.startsWith('x-relay-')) headers.delete(k);
  const stub = env.TUNEL.get(env.TUNEL.idFromName(id));
  return stub.fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const dominio = String(env.DOMINIO || DOMINIO_PADRAO).toLowerCase();

    if (url.pathname === '/tunel/conectar') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket esperado.', { status: 426 });
      const id = String(request.headers.get('X-Tunel-Id') || '');
      if (!ID_RE.test(id)) return new Response('Túnel inválido.', { status: 400 });
      const lic = await verificarLicenca(request.headers.get('X-Licenca'));
      if (!lic.ok) return new Response(lic.erro, { status: 403 });
      const headers = new Headers(request.headers);
      headers.set('X-Relay-Cnpj', String(lic.dados.cnpj));
      headers.set('X-Relay-Nse', String(lic.dados.nse || ''));
      const stub = env.TUNEL.get(env.TUNEL.idFromName(id));
      const resp = await stub.fetch(new Request(request, { headers }));
      // O NSE vem da licença assinada: só a instalação dona dele aponta o endereço para o seu túnel.
      const apelido = apelidoDaNse(lic.dados.nse);
      if (resp.status === 101 && apelido) ctx.waitUntil(registrarApelido(env, apelido, id, String(lic.dados.cnpj)));
      return resp;
    }

    if (url.hostname.toLowerCase() !== `acesso.${dominio}`) {
      const apelido = apelidoDoHost(url.hostname, dominio);
      const tunel = apelido ? await tunelDoApelido(env, apelido) : '';
      if (!tunel) {
        // A rota curinga também pega outros subdomínios do site: esses seguem para a origem normal.
        if (!apelido) return fetch(request);
        return comSeguranca(pagina('Endereço não encontrado', 'Nenhuma loja está usando este endereço. Confira o endereço ou leia o QR Code de acesso online na tela do Gestor Estoque, no computador da loja.', 404));
      }
      if (url.pathname === '/tunel/saude') {
        const resp = Response.json({ ok: true, tunel: (await sha256Hex(tunel)).slice(0, 16) }, { headers: { 'Cache-Control': 'no-store' } });
        return comSeguranca(resp);
      }
      return comSeguranca(await encaminharAoTunel(env, request, tunel));
    }

    const entrada = url.pathname.match(/^\/t\/([a-z2-7]{20,32})\/?$/);
    if (entrada) {
      const codigo = url.searchParams.get('p') || '';
      let destino = '/';
      if (/^[A-Za-z0-9_-]{16,64}$/.test(codigo)) destino = `/parear?c=${codigo}`;
      else if (url.searchParams.get('mt') === '1') destino = '/?mt=1';
      const resp = new Response(null, { status: 302, headers: { Location: destino } });
      resp.headers.append('Set-Cookie', `${COOKIE_TUNEL}=${entrada[1]}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
      return comSeguranca(resp);
    }

    const id = lerCookie(request, COOKIE_TUNEL);
    if (!ID_RE.test(id)) {
      return comSeguranca(pagina('Gestor Estoque', 'Para acessar pela internet, leia o QR Code de acesso online na tela do Gestor Estoque, no computador da loja.'));
    }
    return comSeguranca(await encaminharAoTunel(env, request, id));
  },
};

/** Um por endereço de loja (NSE): guarda para qual túnel ele aponta e de qual CNPJ é. */
export class Apelido {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method === 'PUT') {
      let dados;
      try {
        dados = await request.json();
      } catch {
        return new Response('Inválido.', { status: 400 });
      }
      const tunel = String(dados?.tunel || '');
      const cnpj = String(dados?.cnpj || '');
      if (!ID_RE.test(tunel) || !cnpj) return new Response('Inválido.', { status: 400 });
      const atual = await this.ctx.storage.get('apelido');
      if (atual && atual.cnpj !== cnpj) return new Response('Endereço pertence a outra empresa.', { status: 409 });
      if (!atual || atual.tunel !== tunel) {
        await this.ctx.storage.put('apelido', { tunel, cnpj, desde: new Date().toISOString() });
      }
      return new Response('ok');
    }
    const atual = await this.ctx.storage.get('apelido');
    return Response.json({ tunel: atual?.tunel || '' });
  }
}

/** Cabeçalhos que não atravessam o túnel (conexão/Cloudflare). */
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'proxy-authorization', 'proxy-authenticate', 'content-length', 'host']);

export class Tunel {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.pendentes = new Map();
    this.acessos = new Map();
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/tunel/conectar') return this.conectar(request);
    return this.encaminhar(request);
  }

  async conectar(request) {
    const segredo = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (segredo.length < 32) return new Response('Segredo do túnel ausente.', { status: 401 });
    const cnpj = request.headers.get('X-Relay-Cnpj') || '';
    const hash = await sha256Hex(segredo);
    const vinculo = await this.ctx.storage.get('vinculo');
    if (!vinculo) {
      // Primeiro uso: o túnel fica preso a este segredo e a esta empresa.
      await this.ctx.storage.put('vinculo', { hash, cnpj, criado_em: new Date().toISOString() });
    } else if (!iguaisTempoConstante(vinculo.hash, hash) || vinculo.cnpj !== cnpj) {
      return new Response('Túnel pertence a outra instalação.', { status: 403 });
    }

    for (const antigo of this.ctx.getWebSockets('gestor')) {
      try { antigo.close(4000, 'Substituido por nova conexao'); } catch { /* já fechado */ }
    }
    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par);
    this.ctx.acceptWebSocket(servidor, ['gestor']);
    servidor.serializeAttachment({ cnpj, desde: Date.now() });
    return new Response(null, { status: 101, webSocket: cliente });
  }

  limitado(ip) {
    const agora = Date.now();
    let r = this.acessos.get(ip);
    if (!r || agora - r.inicio > 60000) {
      r = { inicio: agora, n: 0 };
      this.acessos.set(ip, r);
      if (this.acessos.size > 5000) this.acessos.clear();
    }
    r.n += 1;
    return r.n > LIMITE_POR_MINUTO;
  }

  async encaminhar(request) {
    const ws = this.ctx.getWebSockets('gestor')[0];
    if (!ws) {
      return pagina('Loja desconectada', 'O computador da loja não está conectado à internet agora (ou o Gestor Estoque está fechado). Tente novamente em instantes.', 503);
    }
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (this.limitado(ip)) return new Response('Muitas requisições. Aguarde um minuto.', { status: 429 });

    const metodo = request.method.toUpperCase();
    let corpo = null;
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      const tam = Number(request.headers.get('Content-Length') || 0);
      if (tam > MAX_CORPO) return new Response('Conteúdo grande demais.', { status: 413 });
      corpo = new Uint8Array(await request.arrayBuffer());
      if (corpo.length > MAX_CORPO) return new Response('Conteúdo grande demais.', { status: 413 });
    }

    const headers = [];
    for (const [k, v] of request.headers) {
      const kl = k.toLowerCase();
      if (HOP.has(kl) || kl.startsWith('cf-') || kl.startsWith('x-forwarded') || kl === 'x-real-ip' || kl === 'x-gestor-ip-remoto') continue;
      if (kl === 'cookie') {
        const resto = v.split(';').filter((p) => p.split('=')[0].trim() !== COOKIE_TUNEL).join(';').trim();
        if (resto) headers.push([k, resto]);
        continue;
      }
      headers.push([k, v]);
    }
    const url = new URL(request.url);
    headers.push(['host', url.host]);
    headers.push(['x-gestor-ip-remoto', ip]);

    const id = crypto.randomUUID();
    const resposta = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        resolve(new Response('O computador da loja demorou para responder.', { status: 504 }));
      }, TIMEOUT_MS);
      this.pendentes.set(id, { resolve, timer, status: 502, headers: [], partes: [], tamanho: 0, metodo });
    });

    try {
      const semCorpo = !corpo || corpo.length === 0;
      ws.send(JSON.stringify({ t: 'req', id, m: metodo, u: url.pathname + url.search, h: headers, fim: semCorpo }));
      if (!semCorpo) {
        for (let i = 0; i < corpo.length; i += PEDACO) {
          const fim = i + PEDACO >= corpo.length;
          ws.send(JSON.stringify({ t: 'req-parte', id, d: bytesParaB64(corpo.subarray(i, i + PEDACO)), fim }));
        }
      }
    } catch {
      this.finalizar(id, new Response('Conexão com a loja caiu.', { status: 502 }));
    }
    return resposta;
  }

  finalizar(id, resp) {
    const p = this.pendentes.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendentes.delete(id);
    p.resolve(resp);
  }

  montarResposta(p) {
    const headers = new Headers();
    for (const [k, v] of p.headers) {
      if (HOP.has(String(k).toLowerCase())) continue;
      headers.append(k, v);
    }
    const semCorpo = p.metodo === 'HEAD' || [101, 204, 205, 304].includes(p.status);
    let corpo = null;
    if (!semCorpo) {
      corpo = new Uint8Array(p.tamanho);
      let pos = 0;
      for (const parte of p.partes) {
        corpo.set(parte, pos);
        pos += parte.length;
      }
    }
    return new Response(corpo, { status: p.status, headers });
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string') return;
    let f;
    try {
      f = JSON.parse(msg);
    } catch {
      return;
    }
    const p = f && this.pendentes.get(f.id);
    if (!p) return;
    if (f.t === 'res') {
      p.status = Number(f.s) || 502;
      p.headers = Array.isArray(f.h) ? f.h : [];
    } else if (f.t === 'res-parte' && typeof f.d === 'string' && f.d) {
      const bytes = b64ParaBytes(f.d);
      p.tamanho += bytes.length;
      if (p.tamanho > MAX_RESPOSTA) {
        this.finalizar(f.id, new Response('Resposta grande demais.', { status: 502 }));
        return;
      }
      p.partes.push(bytes);
    } else if (f.t !== 'res-parte') {
      return;
    }
    if (f.fim) this.finalizar(f.id, this.montarResposta(p));
  }

  async webSocketClose(ws, code, reason) {
    for (const id of [...this.pendentes.keys()]) {
      this.finalizar(id, new Response('Conexão com a loja caiu.', { status: 502 }));
    }
    try { ws.close(code, reason); } catch { /* já fechado */ }
  }

  async webSocketError() {
    for (const id of [...this.pendentes.keys()]) {
      this.finalizar(id, new Response('Conexão com a loja caiu.', { status: 502 }));
    }
  }
}
