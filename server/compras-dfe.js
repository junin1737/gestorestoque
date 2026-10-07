'use strict';

const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./config');
const { withDb, query } = require('./db');
const { getFiscalConfig } = require('./certificado');
const sefaz = require('./importacao-sefaz');

/** Intervalo entre rodadas na SEFAZ. Acima de 1 h para não cair na rejeição 656. */
const INTERVALO_MS = 90 * 60 * 1000;
/** O webservice oficial só devolve documentos dos últimos 90 dias. */
const JANELA_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_PAGINAS = 40;
const CONTINUACAO_MS = 3000;

let timer = null;
let running = false;

function storePath() {
  return path.join(getAppDataDir(), 'compras-dfe.json');
}

function xmlPath(chave) {
  return path.join(getAppDataDir(), 'xml', `${chave}.xml`);
}

function emptyStore() {
  return {
    ultNSU: '0',
    maxNSU: '0',
    ultimaConsulta: null,
    proximaConsulta: null,
    ultimoErro: '',
    ultimoCStat: '',
    importarAutomatico: false,
    leituraInicial: false,
    canceladas: {},
    notas: {},
  };
}

let cnpjAtivo = '';

function bucketDe(raw) {
  return {
    ...emptyStore(),
    ...(raw || {}),
    importarAutomatico: raw?.importarAutomatico === true,
    leituraInicial: raw?.leituraInicial === true || ['137', '138'].includes(String(raw?.ultimoCStat || '')),
    canceladas: raw?.canceladas && typeof raw.canceladas === 'object' ? raw.canceladas : {},
    notas: raw?.notas && typeof raw.notas === 'object' ? raw.notas : {},
  };
}

function cnpjDestDoXml(chave) {
  const xml = lerXmlArquivo(chave);
  if (!xml) return '';
  const dest = sefaz.extractBlock(xml, 'dest');
  return soDigitos(sefaz.extractTag(dest, 'CNPJ') || sefaz.extractTag(dest, 'CPF'));
}

function loadRoot() {
  const p = storePath();
  if (!fs.existsSync(p)) return { importarAutomatico: false, porCnpj: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (raw.porCnpj && typeof raw.porCnpj === 'object') {
      return {
        importarAutomatico: raw.importarAutomatico === true,
        porCnpj: raw.porCnpj,
      };
    }
    const legado = bucketDe(raw);
    const porCnpj = {};
    const dests = new Set();
    for (const chave of Object.keys(legado.notas)) {
      const dest = cnpjDestDoXml(chave);
      if (dest.length >= 11) dests.add(dest);
    }
    if (dests.size === 1) {
      porCnpj[[...dests][0]] = legado;
    } else {
      for (const [chave, nota] of Object.entries(legado.notas)) {
        const dest = cnpjDestDoXml(chave);
        if (dest.length < 11) continue;
        if (!porCnpj[dest]) porCnpj[dest] = bucketDe({ importarAutomatico: legado.importarAutomatico });
        porCnpj[dest].notas[chave] = nota;
        if (legado.canceladas[chave]) porCnpj[dest].canceladas[chave] = true;
      }
    }
    const root = { importarAutomatico: legado.importarAutomatico === true, porCnpj };
    saveRoot(root);
    return root;
  } catch {
    return { importarAutomatico: false, porCnpj: {} };
  }
}

function saveRoot(root) {
  const p = storePath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(root), 'utf8');
  fs.renameSync(tmp, p);
}

function loadStore() {
  const root = loadRoot();
  const bucket = cnpjAtivo && root.porCnpj[cnpjAtivo] ? bucketDe(root.porCnpj[cnpjAtivo]) : emptyStore();
  bucket.importarAutomatico = root.importarAutomatico === true;
  return bucket;
}

function saveStore(store) {
  const root = loadRoot();
  root.importarAutomatico = store.importarAutomatico === true;
  if (cnpjAtivo) {
    const { importarAutomatico, ...bucket } = store;
    root.porCnpj[cnpjAtivo] = bucket;
  }
  saveRoot(root);
}

async function cnpjEmitente() {
  try {
    let cnpj = '';
    await withDb(async (db) => {
      const rows = await query(db, 'SELECT FIRST 1 CNPJ FROM TB_EMITENTE');
      cnpj = soDigitos(rows[0]?.CNPJ);
    });
    return cnpj;
  } catch {
    return '';
  }
}

async function definirCnpj() {
  cnpjAtivo = await cnpjEmitente();
  return cnpjAtivo;
}

function decodeXmlText(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function soDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function numKey(v) {
  const d = soDigitos(v);
  if (!d) return '';
  const n = Number(d);
  return Number.isFinite(n) ? String(n) : '';
}

function serieKey(v) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (/^\d+$/.test(t)) return String(Number(t));
  return t;
}

function partesChave(chave) {
  const ch = soDigitos(chave);
  if (ch.length !== 44) return null;
  return {
    cnpjEmit: ch.slice(6, 20),
    modelo: ch.slice(20, 22),
    serie: String(Number(ch.slice(22, 25))),
    nNF: String(Number(ch.slice(25, 34))),
  };
}

function lerXmlArquivo(chave) {
  const p = xmlPath(chave);
  try {
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function gravarXmlArquivo(chave, xml) {
  const dir = path.join(getAppDataDir(), 'xml');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(xmlPath(chave), xml, 'utf8');
}

function notaFromResumo(xml) {
  const chave = soDigitos(sefaz.extractTag(xml, 'chNFe'));
  const partes = partesChave(chave);
  if (!partes || partes.modelo !== '55') return null;
  const sit = sefaz.extractTag(xml, 'cSitNFe');
  return {
    chave,
    cnpjEmit: soDigitos(sefaz.extractTag(xml, 'CNPJ')) || partes.cnpjEmit,
    emitente: decodeXmlText(sefaz.extractTag(xml, 'xNome')),
    dhEmi: sefaz.extractTag(xml, 'dhEmi'),
    vNF: Number(sefaz.extractTag(xml, 'vNF') || 0),
    nNF: partes.nNF,
    serie: partes.serie,
    modelo: '55',
    cancelada: sit === '3' || sit === '2',
    temXml: false,
  };
}

function notaFromProc(xml, cnpjNosso) {
  if (!sefaz.xmlNfeCompleto(xml)) return null;
  const inf = sefaz.extractBlock(xml, 'infNFe') || xml;
  const id = (String(xml).match(/\bId="NFe(\d{44})"/i) || [])[1] || '';
  const chave = id || soDigitos(sefaz.extractTag(inf, 'chNFe'));
  const partes = partesChave(chave);
  if (!partes || partes.modelo !== '55') return null;
  const emit = sefaz.extractBlock(inf, 'emit');
  const dest = sefaz.extractBlock(inf, 'dest');
  const ide = sefaz.extractBlock(inf, 'ide');
  const tot = sefaz.extractBlock(inf, 'ICMSTot');
  const destCnpj = soDigitos(sefaz.extractTag(dest, 'CNPJ') || sefaz.extractTag(dest, 'CPF'));
  if (!cnpjNosso || destCnpj !== cnpjNosso) return null;
  const emitCnpj = soDigitos(sefaz.extractTag(emit, 'CNPJ') || sefaz.extractTag(emit, 'CPF'));
  return {
    chave,
    cnpjEmit: emitCnpj || partes.cnpjEmit,
    emitente: decodeXmlText(sefaz.extractTag(emit, 'xNome') || sefaz.extractTag(emit, 'xFant')),
    dhEmi: sefaz.extractTag(ide, 'dhEmi') || sefaz.extractTag(ide, 'dEmi'),
    vNF: Number(sefaz.extractTag(tot, 'vNF') || 0),
    nNF: numKey(sefaz.extractTag(ide, 'nNF')) || partes.nNF,
    serie: serieKey(sefaz.extractTag(ide, 'serie')) || partes.serie,
    modelo: '55',
    cancelada: false,
    temXml: true,
    xml,
  };
}

function eventosCancelamento(xml) {
  const chaves = [];
  if (!/<(?:[\w.-]+:)?tpEvento>\s*11011[12]\s*<\/(?:[\w.-]+:)?tpEvento>/i.test(String(xml || ''))) return chaves;
  const re = /<(?:[\w.-]+:)?chNFe>\s*(\d{44})\s*<\/(?:[\w.-]+:)?chNFe>/gi;
  let m;
  while ((m = re.exec(String(xml)))) chaves.push(m[1]);
  return chaves;
}

function emissaoMs(nota) {
  const t = Date.parse(nota?.dhEmi || '');
  if (Number.isFinite(t)) return t;
  const ch = soDigitos(nota?.chave);
  if (ch.length !== 44) return Date.now();
  const aa = Number(ch.slice(2, 4));
  const mm = Number(ch.slice(4, 6));
  if (!aa || mm < 1 || mm > 12) return Date.now();
  return Date.UTC(2000 + aa, mm, 0, 15, 0, 0);
}

function dentroDaJanela(nota, agora = Date.now()) {
  return emissaoMs(nota) >= agora - JANELA_MS;
}

function podarForaDaJanela(store) {
  for (const chave of Object.keys(store.notas || {})) {
    if (!dentroDaJanela(store.notas[chave])) delete store.notas[chave];
  }
}

function mergeNota(store, nota) {
  if (!dentroDaJanela(nota)) return;
  const prev = store.notas[nota.chave] || {};
  const cancelada = !!(nota.cancelada || prev.cancelada || store.canceladas[nota.chave]);
  store.notas[nota.chave] = {
    chave: nota.chave,
    cnpjEmit: nota.cnpjEmit || prev.cnpjEmit || '',
    emitente: nota.emitente || prev.emitente || '',
    dhEmi: nota.dhEmi || prev.dhEmi || '',
    vNF: nota.vNF || prev.vNF || 0,
    nNF: nota.nNF || prev.nNF || '',
    serie: nota.serie || prev.serie || '',
    modelo: '55',
    cancelada,
    temXml: !!(nota.temXml || prev.temXml),
    atualizadaEm: new Date().toISOString(),
  };
  if (nota.temXml && nota.xml) {
    gravarXmlArquivo(nota.chave, nota.xml);
    store.notas[nota.chave].temXml = true;
  }
  if (store.canceladas[nota.chave]) store.notas[nota.chave].cancelada = true;
}

function nsuNum(valor) {
  const n = Number(String(valor || '0').replace(/\D/g, '') || '0');
  return Number.isFinite(n) ? n : 0;
}

function filaCompleta(store) {
  if (!store?.maxNSU) return false;
  return nsuNum(store.ultNSU) >= nsuNum(store.maxNSU);
}

function ingerirLote(store, docs, cnpjNosso) {
  const cancelar = [];
  const stats = { docs: 0, resumo: 0, proc: 0 };
  for (const doc of docs || []) {
    stats.docs += 1;
    const xml = doc.xml || '';
    cancelar.push(...eventosCancelamento(xml));
    if (/<resNFe[\s>]/i.test(xml)) {
      const nota = notaFromResumo(xml);
      if (!nota) continue;
      if (cnpjNosso && nota.cnpjEmit === cnpjNosso) continue;
      stats.resumo += 1;
      mergeNota(store, nota);
      continue;
    }
    if (sefaz.xmlNfeCompleto(xml)) {
      const nota = notaFromProc(xml, cnpjNosso);
      if (nota) {
        stats.proc += 1;
        mergeNota(store, nota);
      }
    }
  }
  for (const ch of cancelar) {
    store.canceladas[ch] = true;
    if (store.notas[ch]) store.notas[ch].cancelada = true;
  }
  return stats;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function agendar(ms) {
  if (timer) clearTimeout(timer);
  const store = loadStore();
  store.proximaConsulta = new Date(Date.now() + ms).toISOString();
  saveStore(store);
  timer = setTimeout(() => {
    executarCiclo().catch((err) => console.warn('Consultar compras:', err.message));
  }, ms);
  if (timer.unref) timer.unref();
}

async function executarCiclo() {
  if (running) return;
  running = true;
  const cnpjBase = await definirCnpj();
  const store = loadStore();
  if (!cnpjBase) {
    store.ultimoErro = 'CNPJ da empresa não encontrado nesta base.';
    store.ultimoCStat = '';
    running = false;
    return;
  }
  try {
    const fiscal = getFiscalConfig();
    if (!sefaz.fiscalReady(fiscal)) {
      store.ultimoErro = 'Certificado NF-e não configurado. Configure em Serviço → Certificado NF-e.';
      store.ultimoCStat = '';
      store.proximaConsulta = null;
      saveStore(store);
      return;
    }
    let paginas = 0;
    let cnpj = '';
    let recebidos = 0;
    let resumos = 0;
    let procs = 0;
    while (paginas < MAX_PAGINAS) {
      paginas += 1;
      const lote = await sefaz.distribuirNsu(store.ultNSU || '0');
      cnpj = lote.cnpj || cnpj;
      store.ultimoCStat = lote.cStat || '';
      store.ultimoErro = '';
      store.ultimaConsulta = new Date().toISOString();
      if (lote.ultNSU) store.ultNSU = lote.ultNSU;
      if (lote.maxNSU) store.maxNSU = lote.maxNSU;
      const stats = ingerirLote(store, lote.docs, cnpj) || { docs: 0, resumo: 0, proc: 0 };
      recebidos += stats.docs;
      resumos += stats.resumo;
      procs += stats.proc;
      saveStore(store);
      const semMais = lote.cStat === '137' || !lote.maxNSU || filaCompleta(store);
      if (semMais || !lote.docs.length) break;
      await sleep(1200);
    }
    podarForaDaJanela(store);
    store.leituraInicial = true;
    saveStore(store);
    const incompleto = store.ultimoCStat === '138' && !filaCompleta(store);
    // importarAutomatico fica guardado para uma próxima versão; a entrada continua manual.
    console.log(`Consultar compras: cStat ${store.ultimoCStat || '—'} · NSU ${store.ultNSU}/${store.maxNSU || '—'} · ${Object.keys(store.notas).length} nota(s) em 90 dias · ${recebidos} doc(s), ${resumos} resumo(s), ${procs} XML.`);
    agendar(incompleto ? CONTINUACAO_MS : INTERVALO_MS);
  } catch (err) {
    store.ultimoCStat = err.cStat || '';
    store.ultimoErro = err.code === 'SEM_CERTIFICADO'
      ? 'Certificado NF-e não configurado. Configure em Serviço → Certificado NF-e.'
      : (err.message || String(err));
    if (err.ultNSU) store.ultNSU = nsuGravado(err.ultNSU);
    const espera = err.cStat === '656' || err.code === 'CONSUMO_INDEVIDO';
    if (espera) {
      store.ultimaConsulta = new Date().toISOString();
      saveStore(store);
      console.warn('Consultar compras:', store.ultimoErro);
      agendar(INTERVALO_MS);
    } else {
      store.ultimaConsulta = null;
      store.proximaConsulta = null;
      saveStore(store);
      console.warn('Consultar compras:', store.ultimoErro);
    }
  } finally {
    running = false;
  }
}

function consultaRecente(store) {
  const ultima = store.ultimaConsulta ? new Date(store.ultimaConsulta).getTime() : 0;
  return !!(ultima && (Date.now() - ultima) < INTERVALO_MS);
}

function iniciar() {
  definirCnpj().then(() => {
  const store = loadStore();
  if (!store.leituraInicial) return;
  const agora = Date.now();
  const ultima = store.ultimaConsulta ? new Date(store.ultimaConsulta).getTime() : 0;
  const faltam = ultima ? (ultima + INTERVALO_MS) - agora : INTERVALO_MS;
  const incompleto = !filaCompleta(store) && nsuNum(store.maxNSU) > 0 && store.ultimoCStat !== '656';
  agendar(incompleto ? 5000 : Math.max(0, faltam));
  }).catch((err) => console.warn('Consultar compras:', err.message));
}

function nsuGravado(valor) {
  return String(valor || '0').replace(/\D/g, '') || '0';
}

/** Primeira abertura, ou fila ainda incompleta: segue o NSU até o fim dos 90 dias. */
async function sincronizarAoAbrir() {
  await definirCnpj();
  const store = loadStore();
  const bloqueado = store.ultimoCStat === '656' && consultaRecente(store);
  const incompleto = !filaCompleta(store) && nsuNum(store.maxNSU) > 0 && store.ultimoCStat !== '656';
  if (!running && !bloqueado && (!store.leituraInicial || incompleto)) {
    executarCiclo().catch((err) => console.warn('Consultar compras:', err.message));
  }
  return listar();
}

async function mapaLancadas(notas) {
  const porChave = new Map();
  const porTripla = new Map();
  if (!notas.length) return { porChave, porTripla };
  const desde = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  const desdeSql = desde.toISOString().slice(0, 10);
  try {
    await withDb(async (db) => {
      const rows = await query(db, `
        SELECT N.ID_NFCOMPRA, N.NF_NUMERO, TRIM(COALESCE(N.NF_SERIE, '')) AS NF_SERIE,
               TRIM(COALESCE(N.NFE_ORIGEM, '')) AS NFE_ORIGEM,
               REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(F.CNPJ, '')), '.', ''), '/', ''), '-', ''), ' ', '') AS CNPJ
        FROM TB_NFCOMPRA N
        LEFT JOIN TB_FORNECEDOR F ON F.ID_FORNEC = N.ID_FORNEC
        WHERE UPPER(TRIM(COALESCE(N.STATUS, ''))) <> 'C'
          AND N.DT_EMISSAO >= ?`, [desdeSql]);
      for (const r of rows || []) {
        const id = Number(r.ID_NFCOMPRA);
        const chave = soDigitos(r.NFE_ORIGEM);
        if (chave.length === 44) porChave.set(chave, id);
        const tripla = `${numKey(r.NF_NUMERO)}|${serieKey(r.NF_SERIE)}|${soDigitos(r.CNPJ)}`;
        if (!porTripla.has(tripla)) porTripla.set(tripla, id);
      }
    });
  } catch (err) {
    console.warn('Consultar compras: não comparou com TB_NFCOMPRA:', err.message);
  }
  return { porChave, porTripla };
}

function erroVisivel(store, fiscal) {
  const pronto = sefaz.fiscalReady(fiscal);
  const erro = String(store.ultimoErro || '');
  if (pronto && /n[aã]o configurado/i.test(erro)) return '';
  if (!pronto) return erro || 'Certificado NF-e não configurado. Configure em Serviço → Certificado NF-e.';
  return erro;
}

async function listar() {
  const cnpjBase = await definirCnpj();
  const store = loadStore();
  const fiscal = getFiscalConfig();
  const brutas = Object.values(store.notas);
  const mapa = await mapaLancadas(brutas);
  const notas = brutas.filter((n) => dentroDaJanela(n)).map((n) => {
    const idChave = mapa.porChave.get(n.chave) || null;
    const idTripla = mapa.porTripla.get(`${numKey(n.nNF)}|${serieKey(n.serie)}|${soDigitos(n.cnpjEmit)}`) || null;
    const id = idChave || idTripla;
    let status = 'Pendente';
    if (n.cancelada) status = 'Cancelada';
    else if (id) status = 'Lançada';
    const arquivo = lerXmlArquivo(n.chave);
    return {
      chave: n.chave,
      nNF: n.nNF || '',
      serie: n.serie || '',
      emitente: n.emitente || '',
      cnpjEmit: n.cnpjEmit || '',
      dhEmi: n.dhEmi || '',
      vNF: Number(n.vNF || 0),
      status,
      id_nfcompra: id,
      temXml: !!(n.temXml && sefaz.xmlNfeCompleto(arquivo)),
    };
  });
  notas.sort((a, b) => String(b.dhEmi).localeCompare(String(a.dhEmi)) || b.chave.localeCompare(a.chave));
  return {
    ok: true,
    notas,
    ultimaConsulta: store.ultimaConsulta,
    proximaConsulta: store.proximaConsulta,
    ultimoErro: erroVisivel(store, fiscal),
    ultimoCStat: store.ultimoCStat || '',
    certificadoOk: sefaz.fiscalReady(fiscal),
    ambiente: fiscal.ambiente === 'producao' ? 'producao' : 'homologacao',
    importarAutomatico: store.importarAutomatico === true,
    leituraInicial: store.leituraInicial === true,
    consultando: running,
    filaCompleta: filaCompleta(store),
    intervaloMin: 90,
    janelaDias: 90,
    cnpj: cnpjBase,
  };
}

function setImportarAutomatico(valor) {
  const store = loadStore();
  store.importarAutomatico = valor === true;
  saveStore(store);
  return store.importarAutomatico;
}

async function obterXmlParaImportar(chave) {
  await definirCnpj();
  const ch = soDigitos(chave);
  if (ch.length !== 44) {
    const e = new Error('Chave de acesso inválida.');
    e.code = 'CHAVE';
    throw e;
  }
  const store = loadStore();
  const nota = store.notas[ch];
  if (nota?.cancelada || store.canceladas[ch]) {
    const e = new Error('Esta NF-e está cancelada na SEFAZ e não pode ser importada.');
    e.code = 'CANCELADA';
    throw e;
  }
  const arquivo = lerXmlArquivo(ch);
  if (sefaz.xmlNfeCompleto(arquivo)) {
    return { ok: true, chave: ch, xmlText: arquivo, via: 'arquivo' };
  }
  try {
    const direto = await sefaz.consultarChaveSefaz(ch);
    if (direto?.xmlText && sefaz.xmlNfeCompleto(direto.xmlText)) {
      if (nota) {
        nota.temXml = true;
        saveStore(store);
      }
      gravarXmlArquivo(ch, direto.xmlText);
      return { ok: true, chave: ch, xmlText: direto.xmlText, via: 'sefaz' };
    }
  } catch (err) {
    const segue = err.code === 'SEM_XML_COMPLETO' || err.code === 'SEM_XML';
    if (!segue) throw err;
  }
  await sefaz.manifestarCiencia(ch);
  if (nota) {
    nota.cienciaEm = new Date().toISOString();
    saveStore(store);
  }
  await sleep(4000);
  const depois = await sefaz.consultarChaveSefaz(ch);
  if (!depois?.xmlText || !sefaz.xmlNfeCompleto(depois.xmlText)) {
    const e = new Error('A ciência foi registrada, mas a SEFAZ ainda não liberou o XML completo. Tente importar de novo em alguns minutos.');
    e.code = 'SEM_XML_COMPLETO';
    throw e;
  }
  if (nota) {
    nota.temXml = true;
    saveStore(store);
  }
  gravarXmlArquivo(ch, depois.xmlText);
  return { ok: true, chave: ch, xmlText: depois.xmlText, via: 'ciencia' };
}

module.exports = {
  INTERVALO_MS,
  iniciar,
  listar,
  sincronizarAoAbrir,
  setImportarAutomatico,
  obterXmlParaImportar,
  ingerirLote,
  partesChave,
  loadStore,
};
