'use strict';

const params = require('./importacao-auto-params');
const staging = require('./importacao-staging');
const sefaz = require('./importacao-sefaz');
const fornecedor = require('./importacao-fornecedor');

const HORA_MS = 60 * 60 * 1000;
const CINCO_MIN_MS = 5 * 60 * 1000;
const LOTE = 5;
let avaliando = false;
let timer = null;

function daquiUmaHora() {
  return new Date(Date.now() + HORA_MS).toISOString();
}

function daquiCincoMinutos() {
  return new Date(Date.now() + CINCO_MIN_MS).toISOString();
}

function esperaXml(err) {
  const consumo = err?.code === 'CONSUMO_INDEVIDO' || String(err?.cStat || '') === '656';
  return consumo ? daquiUmaHora() : daquiCincoMinutos();
}

function avisoXml(err) {
  const consumo = err?.code === 'CONSUMO_INDEVIDO' || String(err?.cStat || '') === '656';
  return consumo
    ? 'A SEFAZ pediu para aguardar. Nova tentativa em 1 hora. A nota continua em Consultar compras.'
    : 'A consulta da SEFAZ ainda não está completa. Nova tentativa em 5 minutos. A nota continua em Consultar compras.';
}

/**
 * Resumo da SEFAZ não entra: só XML completo.
 * Produto novo na nota: avisa e não grava.
 * Algum produto sem importação automática: avisa para importar na mão.
 * Todos marcados: confere, salva o financeiro e grava.
 * O relógio não envia ciência da operação.
 */
function decisao({ xmlCompleto, itens }) {
  if (!xmlCompleto) return 'aguardar_xml';
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) return 'manual';
  if (lista.some((i) => i.novo)) return 'produto_novo';
  if (lista.some((i) => !i.importar)) return 'manual';
  return 'gravar';
}

async function classificarItens(sessao) {
  const idFornec = Number(sessao?.fornecedor?.id_fornec || 0);
  const itens = [];
  for (const it of sessao?.itens || []) {
    const id = Number(it.sistema?.id_identificador || 0);
    const novo = !(id > 0) || !!it.sistema?.criar_novo;
    let importar = false;
    if (!novo && idFornec && await params.parametrizado(idFornec, id)) {
      importar = params.flag(idFornec, id).importar === true;
    }
    itens.push({ novo, importar });
  }
  return { idFornec, itens, acao: decisao({ xmlCompleto: true, itens }) };
}

async function tentarGravar(nota, arquivo) {
  const compras = require('./compras-dfe');
  const criada = await staging.createSessao({
    chave: nota.chave,
    xmlText: arquivo,
    preferSefaz: false,
    ciencia: false,
    usuario: 'Importação automática',
  });
  if (!criada?.ok || !criada.sessao?.id) {
    compras.atualizarNota(nota.chave, {
      autoMotivo: 'falha',
      autoAviso: criada?.error || 'A nota não pôde ser preparada. Use Importar em Consultar compras.',
      proximaTentativa: null,
    });
    return;
  }
  if (criada.aviso) {
    compras.atualizarNota(nota.chave, { proximaTentativa: daquiUmaHora() });
    return;
  }
  const id = criada.sessao.id;
  try {
    const atual = staging.getSessao(id);
    const forn = await fornecedor.resolverNaImportacao(atual?.xml || criada.sessao.xml);
    if (forn?.id_fornec) staging.setFornecedor(id, forn);
    await staging.aplicarVinculosSessao(id);
    const sessao = staging.getSessao(id);
    const visto = await classificarItens(sessao);
    if (!visto.idFornec) {
      staging.deleteSessao(id);
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'manual',
        autoAviso: 'O fornecedor desta nota não está vinculado. Importe a nota manualmente.',
        proximaTentativa: null,
      });
      return;
    }
    if (visto.acao === 'produto_novo') {
      staging.deleteSessao(id);
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'produto_novo',
        autoAviso: 'Esta nota tem produto novo e não pode ser importada automaticamente. Use Importar em Consultar compras.',
        proximaTentativa: null,
      });
      return;
    }
    if (visto.acao === 'manual') {
      staging.deleteSessao(id);
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'manual',
        autoAviso: 'Algum produto desta nota não permite importação automática. Importe a nota manualmente.',
        proximaTentativa: null,
      });
      return;
    }
    const conf = staging.conferirTodosItens(id);
    if (!conf.ok || (conf.pendentes || []).length) {
      staging.deleteSessao(id);
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'produto_novo',
        autoAviso: 'Esta nota tem produto novo e não pode ser importada automaticamente. Use Importar em Consultar compras.',
        proximaTentativa: null,
      });
      return;
    }
    const fin = await staging.sugerirFinanceiroSessao(id);
    if (!fin?.ok) {
      staging.deleteSessao(id);
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'manual',
        autoAviso: fin?.error || 'O financeiro da nota não pôde ser salvo. Importe a nota manualmente.',
        proximaTentativa: null,
      });
      return;
    }
    const gravou = await staging.confirmarSessao(id, { usuario: 'Importação automática' });
    if (!gravou?.ok) {
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'falha',
        autoAviso: gravou?.error || 'A gravação automática não concluiu. Abra a nota por Importar.',
        proximaTentativa: null,
      });
      return;
    }
    compras.atualizarNota(nota.chave, {
      autoMotivo: '',
      autoAviso: '',
      proximaTentativa: null,
    });
    console.log(`Importação automática: NF ${nota.nNF || ''} gravada (${nota.chave}).`);
  } catch (err) {
    try { staging.deleteSessao(id); } catch { /* a conferência fica para o botão Importar */ }
    compras.atualizarNota(nota.chave, {
      autoMotivo: '',
      autoAviso: 'A importação automática não concluiu. Nova tentativa em 1 hora, ou use Importar.',
      proximaTentativa: daquiUmaHora(),
    });
    throw err;
  }
}

async function avaliarNota(nota) {
  const compras = require('./compras-dfe');
  if (nota.autoMotivo === 'manual' || nota.autoMotivo === 'falha' || nota.autoMotivo === 'produto_novo') return;
  const espera = nota.proximaTentativa ? Date.parse(nota.proximaTentativa) : 0;
  if (espera > Date.now()) return;
  const arquivo = compras.lerXmlArquivo(nota.chave);
  let xmlOk = !!(nota.temXml && sefaz.xmlNfeCompleto(arquivo));
  if (!xmlOk) {
    try {
      const baixado = await sefaz.obterXmlCompleto(nota.chave);
      if (baixado?.xmlText && sefaz.xmlNfeCompleto(baixado.xmlText)) {
        compras.gravarXmlArquivo(nota.chave, baixado.xmlText);
        compras.atualizarNota(nota.chave, {
          temXml: true,
          autoMotivo: '',
          autoAviso: '',
          proximaTentativa: null,
        });
        nota.temXml = true;
        xmlOk = true;
      }
    } catch (err) {
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'xml',
        autoAviso: avisoXml(err),
        proximaTentativa: esperaXml(err),
      });
      return;
    }
  }
  if (!xmlOk) {
    compras.atualizarNota(nota.chave, {
      autoMotivo: 'xml',
      autoAviso: avisoXml(),
      proximaTentativa: daquiCincoMinutos(),
    });
    return;
  }
  const texto = compras.lerXmlArquivo(nota.chave);
  if (!sefaz.xmlNfeCompleto(texto)) return;
  await tentarGravar(nota, texto);
}

async function avaliarPendentes() {
  if (avaliando) return;
  const compras = require('./compras-dfe');
  if (compras.loadStore().importarAutomatico !== true) return;
  if (require('./licenca').situacao().consultar_compras !== true) return;
  avaliando = true;
  try {
    const lista = await compras.listar();
    const fila = (lista.notas || [])
      .filter((n) => n.status === 'Pendente' && n.autoMotivo !== 'manual' && n.autoMotivo !== 'falha' && n.autoMotivo !== 'produto_novo')
      .slice(0, LOTE);
    for (const nota of fila) {
      try {
        await avaliarNota(nota);
      } catch (err) {
        console.warn(`Importação automática ${nota.chave}:`, err.message);
      }
    }
  } finally {
    avaliando = false;
  }
}

function iniciar() {
  if (timer) return;
  timer = setInterval(() => {
    avaliarPendentes().catch((err) => console.warn('Importação automática:', err.message));
  }, CINCO_MIN_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  decisao,
  avaliarPendentes,
  iniciar,
};
