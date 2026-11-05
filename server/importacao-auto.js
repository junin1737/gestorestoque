'use strict';

const params = require('./importacao-auto-params');
const staging = require('./importacao-staging');
const sefaz = require('./importacao-sefaz');
const fornecedor = require('./importacao-fornecedor');
const { buscarRegra } = require('./importacao-regra');

const HORA_MS = 60 * 60 * 1000;
const LOTE = 5;
let avaliando = false;
let timer = null;

function daquiUmaHora() {
  return new Date(Date.now() + HORA_MS).toISOString();
}

/**
 * xml incompleto: espera, sem ciência (o resumo não traz os produtos).
 * sem vínculo ou sem regra do fornecedor+produto: para e avisa.
 * algum produto com importar ou ciência em Não: não grava e não manifesta.
 * os dois Sim em todos, XML completo, vínculo e regra: grava.
 */
function decisao({ xmlCompleto, itens }) {
  if (!xmlCompleto) return 'aguardar_xml';
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) return 'manual';
  if (lista.some((i) => !i.vinculado || !i.parametrizado)) return 'manual';
  if (lista.some((i) => !i.importar || !i.ciencia)) return 'pessoa';
  return 'gravar';
}

async function classificarItens(sessao) {
  const idFornec = Number(sessao?.fornecedor?.id_fornec || 0);
  const itens = [];
  for (const it of sessao?.itens || []) {
    const id = Number(it.sistema?.id_identificador || 0);
    const vinculado = id > 0 && !it.sistema?.criar_novo;
    let parametrizado = false;
    if (vinculado && idFornec) {
      const regra = await buscarRegra({ idFornec, idIdentificador: id });
      parametrizado = !!(regra
        && Number(regra.id_identificador) === id
        && Number(regra.id_fornec) === idFornec);
    }
    const f = vinculado ? params.flag(id) : { importar: false, ciencia: false };
    itens.push({
      vinculado,
      parametrizado,
      importar: f.importar === true,
      ciencia: f.ciencia === true,
    });
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
    if (!visto.idFornec || visto.acao === 'manual') {
      staging.deleteSessao(id);
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'manual',
        autoAviso: 'Nota nova para tratar na mão: há produto sem cadastro, sem vínculo ou sem a parametrização deste fornecedor.',
        proximaTentativa: null,
      });
      return;
    }
    if (visto.acao === 'pessoa') {
      staging.deleteSessao(id);
      compras.atualizarNota(nota.chave, {
        autoMotivo: '',
        autoAviso: 'Esta nota não entra sozinha. Algum produto está com importação ou ciência automática em Não. Use Importar.',
        proximaTentativa: daquiUmaHora(),
      });
      return;
    }
    const conf = staging.conferirTodosItens(id);
    if (!conf.ok || (conf.pendentes || []).length) {
      staging.deleteSessao(id);
      compras.atualizarNota(nota.chave, {
        autoMotivo: 'manual',
        autoAviso: 'Nota nova para tratar na mão: há produto sem cadastro, sem vínculo ou sem a parametrização deste fornecedor.',
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
  if (nota.autoMotivo === 'manual' || nota.autoMotivo === 'falha') return;
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
        autoAviso: 'A consulta da SEFAZ ainda não está completa. Nova tentativa em 1 hora. A nota continua em Consultar compras.',
        proximaTentativa: daquiUmaHora(),
      });
      return;
    }
  }
  if (!xmlOk) {
    compras.atualizarNota(nota.chave, {
      autoMotivo: 'xml',
      autoAviso: 'A consulta da SEFAZ ainda não está completa. Nova tentativa em 1 hora. A nota continua em Consultar compras.',
      proximaTentativa: daquiUmaHora(),
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
      .filter((n) => n.status === 'Pendente' && n.autoMotivo !== 'manual' && n.autoMotivo !== 'falha')
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
  }, HORA_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  decisao,
  avaliarPendentes,
  iniciar,
};
