'use strict';

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { getFiscalConfig, decryptSecret } = require('./certificado');
const { withDb, query } = require('./db');

const gunzip = promisify(zlib.gunzip);
const execFileAsync = promisify(execFile);

const ENDPOINTS = {
  producao: 'www1.nfe.fazenda.gov.br',
  homologacao: 'hom1.nfe.fazenda.gov.br',
};
const PATH = '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

async function getEmitenteCnpj() {
  try {
    return await withDb(async (db) => {
      const rows = await query(db, 'SELECT FIRST 1 CNPJ FROM TB_EMITENTE');
      return String(rows[0]?.CNPJ || '').replace(/\D/g, '');
    });
  } catch {
    return '';
  }
}

function buildDistDFeXml({ chave, cnpj, tpAmb, cUFAutor }) {
  return (
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">`
    + `<tpAmb>${tpAmb}</tpAmb>`
    + (cUFAutor ? `<cUFAutor>${cUFAutor}</cUFAutor>` : '')
    + `<CNPJ>${cnpj}</CNPJ>`
    + `<consChNFe><chNFe>${chave}</chNFe></consChNFe>`
    + `</distDFeInt>`
  );
}

function buildSoap(nfeDadosMsg) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>`
    + `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`
    + ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"`
    + ` xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">`
    + `<soap12:Body>`
    + `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">`
    + `<nfeDadosMsg>${nfeDadosMsg}</nfeDadosMsg>`
    + `</nfeDistDFeInteresse>`
    + `</soap12:Body></soap12:Envelope>`
  );
}

function httpsRequestPfx({ host, path, body, pfx, passphrase }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host,
      path,
      method: 'POST',
      port: 443,
      pfx,
      passphrase: passphrase || '',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na consulta SEFAZ.'));
    });
    req.write(body);
    req.end();
  });
}

async function httpsRequestWindowsCert({ host, path, body, thumbprint, certStore }) {
  const store = String(certStore || 'CurrentUser\\My').replace(/'/g, "''");
  const thumb = String(thumbprint || '').replace(/[^0-9A-Fa-f]/g, '');
  if (!thumb) throw new Error('Thumbprint do certificado Windows não configurado.');
  const b64 = Buffer.from(body, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$thumb = '${thumb}'
$storePath = 'Cert:\\${store}'
$cert = Get-ChildItem $storePath | Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
if (-not $cert) { throw "Certificado $thumb não encontrado em $storePath" }
$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))
$uri = 'https://${host}${path}'
try {
  $resp = Invoke-WebRequest -Uri $uri -Method POST -Body $body -ContentType 'application/soap+xml; charset=utf-8' -Certificate $cert -UseBasicParsing -TimeoutSec 60
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($resp.Content))
} catch {
  throw $_.Exception.Message
}
`;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  return Buffer.from(String(stdout || '').trim(), 'base64').toString('utf8');
}

function extractTag(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : '';
}

async function decodeDocZip(b64) {
  const buf = Buffer.from(String(b64 || '').replace(/\s+/g, ''), 'base64');
  try {
    return (await gunzip(buf)).toString('utf8');
  } catch {
    return buf.toString('utf8');
  }
}

async function parseDistResponse(soapBody) {
  const cStat = extractTag(soapBody, 'cStat') || extractTag(soapBody, 'cStat');
  const xMotivo = extractTag(soapBody, 'xMotivo');
  const docs = [];
  const re = /<docZip[^>]*>([\s\S]*?)<\/docZip>/gi;
  let m;
  while ((m = re.exec(soapBody))) {
    docs.push(m[1].replace(/\s+/g, ''));
  }
  if (!docs.length && !['138', '137'].includes(cStat)) {
    const err = xMotivo || `SEFAZ retornou cStat=${cStat || '?'}`;
    const e = new Error(err);
    e.cStat = cStat;
    throw e;
  }
  for (const zip of docs) {
    const xml = await decodeDocZip(zip);
    if (/<NFe[\s>]|<nfeProc[\s>]|<infNFe[\s>]/i.test(xml)) {
      return { xml, cStat, xMotivo };
    }
    // resNFe / evento — tenta achar procNFe embutido
    if (/nfeProc|NFe/i.test(xml)) {
      return { xml, cStat, xMotivo };
    }
  }
  if (cStat === '137') {
    throw new Error('SEFAZ: nenhum documento localizado para esta chave (cStat 137). Verifique se o CNPJ do certificado é o destinatário/autorizado da NF-e.');
  }
  throw new Error(xMotivo || 'SEFAZ não retornou o XML da NF-e nesta consulta.');
}

function fiscalReady(fiscal) {
  if (!fiscal) return false;
  if (fiscal.tipo === 'windows') return !!fiscal.thumbprint;
  return !!(fiscal.arquivoPfx && fs.existsSync(fiscal.arquivoPfx) && fiscal.senhaEnc);
}

/**
 * Consulta NF-e na SEFAZ (NFeDistribuicaoDFe / consChNFe).
 * Requer certificado A1 ou Windows configurado no serviço.
 */
async function consultarChaveSefaz(chave, opts = {}) {
  const ch = String(chave || '').replace(/\D/g, '');
  if (ch.length !== 44) throw new Error('Chave inválida para consulta SEFAZ.');

  const fiscal = { ...getFiscalConfig(), ...(opts.fiscal || {}) };
  if (!fiscalReady(fiscal)) {
    const err = new Error('Certificado fiscal não configurado. Configure em Serviço → Certificado NF-e, ou anexe o XML.');
    err.code = 'SEM_CERTIFICADO';
    throw err;
  }

  const cnpj = String(opts.cnpj || await getEmitenteCnpj() || '').replace(/\D/g, '');
  if (cnpj.length !== 14) {
    throw new Error('CNPJ do emitente (destinatário da consulta) não encontrado em TB_EMITENTE.');
  }

  const ambiente = fiscal.ambiente === 'producao' ? 'producao' : 'homologacao';
  const tpAmb = ambiente === 'producao' ? '1' : '2';
  const host = ENDPOINTS[ambiente];
  const cUFAutor = ch.slice(0, 2);
  const dados = buildDistDFeXml({ chave: ch, cnpj, tpAmb, cUFAutor });
  const soap = buildSoap(dados);

  let responseXml;
  if (fiscal.tipo === 'windows') {
    responseXml = await httpsRequestWindowsCert({
      host,
      path: PATH,
      body: soap,
      thumbprint: fiscal.thumbprint,
      certStore: fiscal.certStore,
    });
  } else {
    const senha = decryptSecret(fiscal.senhaEnc);
    const pfx = fs.readFileSync(fiscal.arquivoPfx);
    const res = await httpsRequestPfx({
      host,
      path: PATH,
      body: soap,
      pfx,
      passphrase: senha,
    });
    if (res.status >= 400) {
      throw new Error(`SEFAZ HTTP ${res.status}: ${res.body.slice(0, 300)}`);
    }
    responseXml = res.body;
  }

  const parsed = await parseDistResponse(responseXml);
  return {
    ok: true,
    fonte: 'sefaz',
    xmlText: parsed.xml,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    ambiente,
  };
}

module.exports = {
  consultarChaveSefaz,
  fiscalReady,
  getEmitenteCnpj,
};
