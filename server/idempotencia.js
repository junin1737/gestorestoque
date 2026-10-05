'use strict';

/**
 * Repetição segura de gravações: o painel manda o mesmo Idempotency-Key ao reenviar um pedido
 * cuja resposta se perdeu (rede caiu). O segundo pedido recebe a resposta do primeiro em vez de
 * gravar de novo (ex.: ajuste de quantidade não soma duas vezes).
 */
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ITENS = 3000;
const FORMATO = /^[A-Za-z0-9_-]{16,80}$/;
const ESPERA_MAX_MS = 90 * 1000;

const cache = new Map();

function limpar() {
  const limite = Date.now() - TTL_MS;
  for (const [k, v] of cache) {
    if (v.at < limite || cache.size > MAX_ITENS) cache.delete(k);
    else break;
  }
}

function responderDoCache(res, entrada) {
  res.setHeader('Idempotent-Replay', '1');
  return res.status(entrada.status || 200).json(entrada.body);
}

function middleware(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const chave = String(req.headers['idempotency-key'] || '');
  if (!FORMATO.test(chave)) return next();
  const id = `${req.usuario?.id ?? '-'}:${req.method}:${req.originalUrl}:${chave}`;

  const existente = cache.get(id);
  if (existente) {
    if (existente.body !== undefined) return responderDoCache(res, existente);
    const limite = new Promise((r) => setTimeout(r, ESPERA_MAX_MS).unref?.());
    return Promise.race([existente.espera, limite]).then(() => {
      const fim = cache.get(id);
      if (fim && fim.body !== undefined) return responderDoCache(res, fim);
      return res.status(409).json({ ok: false, error: 'A operação anterior ainda não terminou. Confira e tente novamente.' });
    });
  }

  let concluir;
  const entrada = { at: Date.now(), espera: new Promise((r) => { concluir = r; }) };
  cache.set(id, entrada);
  limpar();

  const jsonOriginal = res.json.bind(res);
  res.json = (body) => {
    entrada.status = res.statusCode;
    entrada.body = body;
    concluir();
    return jsonOriginal(body);
  };
  // Conexão caída no meio: a gravação continua rodando; a repetição espera por ela.
  // Só libera a chave se a rota terminar sem resposta JSON (erro inesperado).
  res.on('finish', () => {
    if (entrada.body === undefined) {
      cache.delete(id);
      concluir();
    }
  });
  next();
}

module.exports = { middleware };
