'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validarPublicacao, modoDaLinha } = require('./regras-estoque');
const { capacidadeJanela } = require('./regras-publicacao');
const { catalogoSimulado } = require('./conectores/erp');

const configLigado = { estoque: { exigir_estoque_positivo: true, estoque_minimo_anuncio: 1 } };
const configDesligado = { estoque: { exigir_estoque_positivo: false, estoque_minimo_anuncio: 1 } };

test('com estoque exigido, saldo zero ou negativo não publica', () => {
  const zero = { preco: 8.5, preco_promocional: 6.9, promocao_inicio: '2026-01-01', promocao_fim: '2026-12-31', estoque: 0 };
  const negativo = { preco: 4.8, estoque: -3 };
  assert.equal(validarPublicacao({ produto: zero, modo: 'oferta', data: '2026-10-27', config: configLigado }).ok, false);
  assert.equal(validarPublicacao({ produto: negativo, modo: 'exposicao', data: '2026-10-27', config: configLigado }).ok, false);
});

test('com estoque ignorado, saldo zero ou negativo pode ser oferta ou exposição', () => {
  const zero = { preco: 8.5, preco_promocional: 6.9, promocao_inicio: '2026-01-01', promocao_fim: '2026-12-31', estoque: 0 };
  const negativo = { preco: 4.8, estoque: -3 };
  assert.equal(validarPublicacao({ produto: zero, modo: 'oferta', data: '2026-10-27', config: configDesligado }).ok, true);
  assert.equal(validarPublicacao({ produto: negativo, modo: 'exposicao', data: '2026-10-27', config: configDesligado }).ok, true);
});

test('produção própria publica mesmo com a exigência de estoque marcada', () => {
  const pao = { preco: 0.8, estoque: 0, ignorar_estoque: true };
  const r = validarPublicacao({ produto: pao, modo: 'exposicao', data: '2026-10-27', config: configLigado });
  assert.equal(r.ok, true);
  const porModulo = validarPublicacao({
    produto: { preco: 3.5, estoque: 0 },
    modo: 'exposicao',
    data: '2026-10-27',
    config: configLigado,
    modulo: { ignorar_estoque: true },
  });
  assert.equal(porModulo.ok, true);
});

test('oferta usa o preço do ERP e recusa promoção fora da data', () => {
  const produto = { preco: 18, preco_promocional: 15, promocao_inicio: '2026-12-01', promocao_fim: '2026-12-31', estoque: 5 };
  const fora = validarPublicacao({ produto, modo: 'oferta', data: '2026-10-27', config: configDesligado });
  assert.equal(fora.ok, false);
  const dentro = validarPublicacao({ produto, modo: 'oferta', data: '2026-12-10', config: configDesligado });
  assert.equal(dentro.ok, true);
  assert.equal(dentro.preco_de, 18);
  assert.equal(dentro.preco_por, 15);
});

test('a janela avisa quando a quantidade de posts não cabe', () => {
  const ok = capacidadeJanela({ horaInicio: '08:00', horaFim: '20:00', intervaloMinutos: 60, postsPorDia: 13 });
  assert.equal(ok.cabe, true);
  assert.equal(ok.vagas, 13);
  const cheia = capacidadeJanela({ horaInicio: '08:00', horaFim: '20:00', intervaloMinutos: 60, postsPorDia: 14 });
  assert.equal(cheia.cabe, false);
  assert.match(cheia.aviso, /14/);
});

test('o catálogo simulado cobre os casos de estoque, promoção, foto, EAN e produção própria', () => {
  const lista = catalogoSimulado();
  assert.ok(lista.some((p) => p.estoque > 0));
  assert.ok(lista.some((p) => p.estoque === 0 && !p.ignorar_estoque));
  assert.ok(lista.some((p) => p.estoque < 0));
  assert.ok(lista.some((p) => p.preco_promocional > 0));
  assert.ok(lista.some((p) => !p.preco_promocional));
  assert.ok(lista.some((p) => p.foto === false));
  assert.ok(lista.some((p) => !p.ean));
  assert.ok(lista.some((p) => p.ignorar_estoque === true));
});

test('o modo da linha segue seleção, promoção e bloqueio de estoque', () => {
  assert.equal(modoDaLinha({ exposicao: { ok: false }, selecionado: true, oferta: { ok: false } }), 'sem_estoque');
  assert.equal(modoDaLinha({ exposicao: { ok: true }, selecionado: false, oferta: { ok: true } }), 'nenhum');
  assert.equal(modoDaLinha({ exposicao: { ok: true }, selecionado: true, oferta: { ok: true } }), 'oferta');
  assert.equal(modoDaLinha({ exposicao: { ok: true }, selecionado: true, oferta: { ok: false } }), 'exposicao');
});
