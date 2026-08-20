'use strict';

function tag(block, name) {
  const m = String(block || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : '';
}

function tagNum(block, name) {
  const v = tag(block, name);
  if (v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function extractBlock(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[0] : '';
}

function parseImposto(det) {
  const imposto = extractBlock(det, 'imposto') || det;
  const icmsBlock = imposto.match(/<ICMS\b[\s\S]*?<\/ICMS>/i)?.[0] || '';
  const icmsInner = icmsBlock.match(/<ICMS\w*\b[\s\S]*?<\/ICMS\w*>/i)?.[0] || icmsBlock;
  const ipi = extractBlock(imposto, 'IPI') || '';
  const ipiTrib = extractBlock(ipi, 'IPITrib') || extractBlock(ipi, 'IPINT') || ipi;
  const pis = extractBlock(imposto, 'PIS') || '';
  const pisInner = pis.match(/<PIS\w*\b[\s\S]*?<\/PIS\w*>/i)?.[0] || pis;
  const cofins = extractBlock(imposto, 'COFINS') || '';
  const cofinsInner = cofins.match(/<COFINS\w*\b[\s\S]*?<\/COFINS\w*>/i)?.[0] || cofins;

  return {
    orig: tag(icmsInner, 'orig') || '0',
    CST: tag(icmsInner, 'CST') || '',
    CSOSN: tag(icmsInner, 'CSOSN') || '',
    vBC: tagNum(icmsInner, 'vBC'),
    pICMS: tagNum(icmsInner, 'pICMS'),
    vICMS: tagNum(icmsInner, 'vICMS'),
    vBCST: tagNum(icmsInner, 'vBCST'),
    vICMSST: tagNum(icmsInner, 'vICMSST'),
    CST_IPI: tag(ipiTrib, 'CST') || tag(ipi, 'CST') || '',
    vIPI: tagNum(ipiTrib, 'vIPI'),
    pIPI: tagNum(ipiTrib, 'pIPI'),
    CST_PIS: tag(pisInner, 'CST') || '',
    vPIS: tagNum(pisInner, 'vPIS'),
    pPIS: tagNum(pisInner, 'pPIS'),
    vBCPIS: tagNum(pisInner, 'vBC'),
    CST_COFINS: tag(cofinsInner, 'CST') || '',
    vCOFINS: tagNum(cofinsInner, 'vCOFINS'),
    pCOFINS: tagNum(cofinsInner, 'pCOFINS'),
    vBCCOFINS: tagNum(cofinsInner, 'vBC'),
  };
}

function parseDet(det) {
  const prod = extractBlock(det, 'prod') || det;
  const nItem = Number((det.match(/nItem\s*=\s*"(\d+)"/i) || [])[1] || tag(det, 'nItem') || 0);
  return {
    nItem,
    cProd: tag(prod, 'cProd'),
    cEAN: tag(prod, 'cEAN') || tag(prod, 'cEANTrib') || '',
    xProd: tag(prod, 'xProd'),
    NCM: tag(prod, 'NCM'),
    CFOP: tag(prod, 'CFOP'),
    uCom: tag(prod, 'uCom'),
    qCom: tagNum(prod, 'qCom'),
    vUnCom: tagNum(prod, 'vUnCom'),
    vProd: tagNum(prod, 'vProd'),
    vDesc: tagNum(prod, 'vDesc'),
    vFrete: tagNum(prod, 'vFrete'),
    vSeg: tagNum(prod, 'vSeg'),
    vOutro: tagNum(prod, 'vOutro'),
    imposto: parseImposto(det),
  };
}

function parseNfeXml(xmlRaw) {
  const xml = String(xmlRaw || '').replace(/\uFEFF/g, '');
  if (!xml.includes('<NFe') && !xml.includes('<nfeProc') && !xml.includes('<infNFe')) {
    throw new Error('Arquivo XML não parece ser uma NF-e válida.');
  }

  const inf = extractBlock(xml, 'infNFe') || xml;
  const ide = extractBlock(inf, 'ide');
  const emit = extractBlock(inf, 'emit');
  const dest = extractBlock(inf, 'dest');
  const total = extractBlock(inf, 'total');
  const icmsTot = extractBlock(total, 'ICMSTot') || total;
  const transp = extractBlock(inf, 'transp');
  const transporta = extractBlock(transp, 'transporta');
  const cobr = extractBlock(inf, 'cobr');
  const fat = extractBlock(cobr, 'fat');
  const pag = extractBlock(inf, 'pag');
  const infAdic = extractBlock(inf, 'infAdic');

  let chave = '';
  const idAttr = (inf.match(/Id\s*=\s*"NFe(\d{44})"/i) || [])[1];
  if (idAttr) chave = idAttr;
  if (!chave) chave = tag(xml, 'chNFe').replace(/\D/g, '');
  if (!chave) {
    const m = xml.match(/\b(\d{44})\b/);
    if (m) chave = m[1];
  }

  const enderEmit = extractBlock(emit, 'enderEmit');
  const enderDest = extractBlock(dest, 'enderDest');

  const dets = xml.match(/<det\b[^>]*>[\s\S]*?<\/det>/gi) || [];
  const itens = dets.map(parseDet).filter((it) => it.nItem > 0);
  if (!itens.length) throw new Error('XML sem itens (<det>).');

  const dups = [...(cobr.match(/<dup\b[^>]*>[\s\S]*?<\/dup>/gi) || [])].map((d, i) => ({
    nDup: tag(d, 'nDup') || String(i + 1).padStart(3, '0'),
    dVenc: tag(d, 'dVenc'),
    vDup: tagNum(d, 'vDup'),
  }));

  const detPags = [...(pag.match(/<detPag\b[^>]*>[\s\S]*?<\/detPag>/gi) || [])].map((d) => ({
    indPag: tag(d, 'indPag'),
    tPag: tag(d, 'tPag'),
    vPag: tagNum(d, 'vPag'),
    xPag: tag(d, 'xPag'),
  }));
  // Fallback: alguns XMLs trazem tPag direto em <pag>
  if (!detPags.length && (tag(pag, 'tPag') || tag(pag, 'vPag'))) {
    detPags.push({
      indPag: tag(pag, 'indPag'),
      tPag: tag(pag, 'tPag'),
      vPag: tagNum(pag, 'vPag'),
      xPag: tag(pag, 'xPag'),
    });
  }

  const vols = [...(transp.match(/<vol\b[^>]*>[\s\S]*?<\/vol>/gi) || [])].map((v) => ({
    qVol: tagNum(v, 'qVol'),
    esp: tag(v, 'esp'),
    marca: tag(v, 'marca'),
    nVol: tag(v, 'nVol'),
    pesoL: tagNum(v, 'pesoL'),
    pesoB: tagNum(v, 'pesoB'),
  }));

  return {
    chave,
    ide: {
      nNF: tag(ide, 'nNF'),
      serie: tag(ide, 'serie'),
      modelo: tag(ide, 'mod') || '55',
      dhEmi: tag(ide, 'dhEmi') || tag(ide, 'dEmi'),
      natOp: tag(ide, 'natOp'),
      tpNF: tag(ide, 'tpNF'),
      idDest: tag(ide, 'idDest'),
      cUF: tag(ide, 'cUF'),
    },
    emit: {
      CNPJ: tag(emit, 'CNPJ') || tag(emit, 'CPF'),
      xNome: tag(emit, 'xNome'),
      xFant: tag(emit, 'xFant'),
      IE: tag(emit, 'IE'),
      IM: tag(emit, 'IM'),
      enderEmit: {
        xLgr: tag(enderEmit, 'xLgr'),
        nro: tag(enderEmit, 'nro'),
        xCpl: tag(enderEmit, 'xCpl'),
        xBairro: tag(enderEmit, 'xBairro'),
        cMun: tag(enderEmit, 'cMun'),
        xMun: tag(enderEmit, 'xMun'),
        UF: tag(enderEmit, 'UF'),
        CEP: tag(enderEmit, 'CEP'),
        cPais: tag(enderEmit, 'cPais'),
        xPais: tag(enderEmit, 'xPais'),
        fone: tag(enderEmit, 'fone'),
      },
      email: tag(emit, 'email'),
    },
    dest: {
      CNPJ: tag(dest, 'CNPJ') || tag(dest, 'CPF'),
      xNome: tag(dest, 'xNome'),
      IE: tag(dest, 'IE'),
      enderDest: {
        xLgr: tag(enderDest, 'xLgr'),
        nro: tag(enderDest, 'nro'),
        xCpl: tag(enderDest, 'xCpl'),
        xBairro: tag(enderDest, 'xBairro'),
        cMun: tag(enderDest, 'cMun'),
        xMun: tag(enderDest, 'xMun'),
        UF: tag(enderDest, 'UF'),
        CEP: tag(enderDest, 'CEP'),
      },
    },
    transp: {
      modFrete: tag(transp, 'modFrete'),
      transporta: {
        CNPJ: tag(transporta, 'CNPJ') || tag(transporta, 'CPF'),
        xNome: tag(transporta, 'xNome'),
        IE: tag(transporta, 'IE'),
        xEnder: tag(transporta, 'xEnder'),
        xMun: tag(transporta, 'xMun'),
        UF: tag(transporta, 'UF'),
      },
      vol: vols,
    },
    total: {
      vNF: tagNum(icmsTot, 'vNF'),
      vProd: tagNum(icmsTot, 'vProd'),
      vDesc: tagNum(icmsTot, 'vDesc'),
      vFrete: tagNum(icmsTot, 'vFrete'),
      vSeg: tagNum(icmsTot, 'vSeg'),
      vOutro: tagNum(icmsTot, 'vOutro'),
      vBC: tagNum(icmsTot, 'vBC'),
      vICMS: tagNum(icmsTot, 'vICMS'),
      vST: tagNum(icmsTot, 'vST'),
      vIPI: tagNum(icmsTot, 'vIPI'),
      vPIS: tagNum(icmsTot, 'vPIS'),
      vCOFINS: tagNum(icmsTot, 'vCOFINS'),
    },
    cobr: {
      nFat: tag(fat, 'nFat'),
      vOrig: tagNum(fat, 'vOrig'),
      vLiq: tagNum(fat, 'vLiq'),
      dup: dups,
    },
    pag: {
      detPag: detPags,
      tPag: detPags[0]?.tPag || '',
      vPag: detPags[0]?.vPag || 0,
      indPag: detPags[0]?.indPag || '',
    },
    infAdic: { infCpl: tag(infAdic, 'infCpl') },
    itens,
  };
}

module.exports = { parseNfeXml };
