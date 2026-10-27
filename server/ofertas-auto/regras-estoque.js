'use strict';

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dataIso(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function promoValida(produto, data) {
  const dia = dataIso(data);
  const por = numero(produto?.preco_promocional);
  const inicio = dataIso(produto?.promocao_inicio);
  const fim = dataIso(produto?.promocao_fim);
  if (!(por > 0) || !dia || !inicio || !fim) return false;
  return dia >= inicio && dia <= fim;
}

function descontoPercentual(de, por) {
  const a = numero(de);
  const b = numero(por);
  if (!(a > 0) || !(b > 0) || b >= a) return null;
  return Math.round((1 - b / a) * 1000) / 10;
}

function ignoraEstoque(produto, modulo) {
  return produto?.ignorar_estoque === true || modulo?.ignorar_estoque === true;
}

/** Estoque só bloqueia quando a loja exige saldo positivo e o produto não é exceção. */
function bloqueioEstoque(produto, config, modulo) {
  if (ignoraEstoque(produto, modulo)) return '';
  if (config?.estoque?.exigir_estoque_positivo !== true) return '';
  const minimo = Number.isInteger(Number(config?.estoque?.estoque_minimo_anuncio))
    ? Number(config.estoque.estoque_minimo_anuncio)
    : 1;
  const saldo = numero(produto?.estoque);
  if (saldo == null || saldo < minimo) {
    return `Estoque abaixo do mínimo para anúncio (${minimo}).`;
  }
  return '';
}

function modoDaLinha(linha) {
  const escolhido = linha?.modo_escolhido;
  if (escolhido === 'oferta' || escolhido === 'exposicao') return escolhido;
  if (linha?.exposicao?.ok === false) return 'sem_estoque';
  if (linha?.selecionado !== true) return 'nenhum';
  return linha?.oferta?.ok === true ? 'oferta' : 'exposicao';
}

function validarPublicacao({ produto, modo, data, config, modulo }) {
  const tipo = modo === 'oferta' ? 'oferta' : 'exposicao';
  const estoque = bloqueioEstoque(produto, config, modulo);
  if (estoque) return { ok: false, motivo: estoque, preco_de: numero(produto?.preco), preco_por: null };
  const de = numero(produto?.preco);
  if (tipo === 'exposicao') {
    return { ok: true, motivo: '', preco_de: de, preco_por: null, desconto: null };
  }
  if (!promoValida(produto, data)) {
    return { ok: false, motivo: 'Oferta só pode ser agendada com preço promocional válido no ERP nessa data.', preco_de: de, preco_por: null };
  }
  const por = numero(produto.preco_promocional);
  return { ok: true, motivo: '', preco_de: de, preco_por: por, desconto: descontoPercentual(de, por) };
}

module.exports = {
  promoValida,
  descontoPercentual,
  ignoraEstoque,
  bloqueioEstoque,
  modoDaLinha,
  validarPublicacao,
};
