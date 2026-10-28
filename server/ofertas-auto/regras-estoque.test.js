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

test('a janela lê hora_inicio mesmo quando o relógio manda os segundos', () => {
  const ok = capacidadeJanela({ hora_inicio: '08:00:00', hora_fim: '09:00', intervalo_minutos: 30, posts_por_dia: 3 });
  assert.equal(ok.cabe, true);
  assert.equal(ok.vagas, 3);
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
  assert.equal(modoDaLinha({ exposicao: { ok: true }, selecionado: true, oferta: { ok: true }, modo_escolhido: 'exposicao' }), 'exposicao');
});

test('a rotina encaixa um horário por produto dentro da janela', () => {
  const { montarRotina } = require('./regras-publicacao');
  const gerada = montarRotina({
    inicio: '2026-10-26',
    fim: '2026-10-30',
    produtos: [
      { id: '1', descricao: 'A', detalhe: 'obs' },
      { id: '2', descricao: 'B', detalhe: '' },
    ],
    publicacao: {
      posts_por_dia: 4,
      intervalo_minutos: 90,
      hora_inicio: '08:00',
      hora_fim: '20:00',
      dias_semana: [1, 2, 3, 4, 5],
    },
  });
  assert.equal(gerada.rotina.length, 2);
  assert.equal(gerada.rotina[0].data, '2026-10-26');
  assert.equal(gerada.rotina[0].hora, '08:00');
  assert.equal(gerada.rotina[1].hora, '09:30');
  assert.equal(gerada.rotina[0].detalhe, 'obs');
  assert.equal(gerada.faltaram, 0);
});

test('o espaço em branco do banner fica dentro da imagem', () => {
  const { furoBanner } = require('./regras-postagem');
  const f = furoBanner({ x: 90, y: 80, w: 40, h: 50 }, null);
  assert.ok(f.x + f.w <= 100);
  assert.ok(f.y + f.h <= 100);
  assert.ok(f.w >= 18 && f.h >= 18);
});

test('o horário vencido de uma campanha ativa é o que publica', () => {
  const { escolherSlot } = require('./regras-postagem');
  const agora = new Date(2026, 9, 28, 15, 21, 0, 0);
  const alvo = escolherSlot([
    {
      id: '1',
      ativa: true,
      rotina: [
        { produto_id: '9', data: '2026-10-27', hora: '15:20', publicado: false },
        { produto_id: '8', data: '2026-10-28', hora: '22:00', publicado: false },
      ],
    },
    {
      id: '2',
      ativa: false,
      rotina: [{ produto_id: '7', data: '2026-10-27', hora: '08:00', publicado: false }],
    },
  ], agora);
  assert.equal(alvo.slot.produto_id, '9');
  assert.equal(escolherSlot([{
    id: '3',
    ativa: true,
    rotina: [{ produto_id: '1', data: '2026-10-28', hora: '15:20', publicado: false, erro: 'falhou', tentativa_em: agora.toISOString() }],
  }], agora), null);
});

test('a foto alta entra na proporção que o Instagram aceita', async () => {
  const { Jimp } = require('jimp');
  const { enquadrarJpeg } = require('./publicador');
  const { caixaInstagram } = require('./regras-postagem');
  const alta = new Jimp({ width: 400, height: 800, color: 0xff3366ff });
  const quadro = await enquadrarJpeg(await alta.getBuffer('image/png'));
  assert.equal(quadro.mudou, true);
  assert.equal(caixaInstagram(400, 800).fw, 640);
  const razao = quadro.largura / quadro.altura;
  assert.ok(razao >= 0.8 && razao <= 1.91);
  const quadrada = new Jimp({ width: 500, height: 500, color: 0xffffffff });
  const igual = await enquadrarJpeg(await quadrada.getBuffer('image/png'));
  assert.equal(igual.mudou, false);
});
