'use strict';

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
const EVENTO_ENDPOINTS = {
  producao: { host: 'www.nfe.fazenda.gov.br', path: '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx' },
  homologacao: { host: 'hom.nfe.fazenda.gov.br', path: '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx' },
};
const UF_IBGE = {
  AC: '12', AL: '27', AM: '13', AP: '16', BA: '29', CE: '23', DF: '53', ES: '32',
  GO: '52', MA: '21', MG: '31', MS: '50', MT: '51', PA: '15', PB: '25', PE: '26',
  PI: '22', PR: '41', RJ: '33', RN: '24', RO: '11', RR: '14', RS: '43', SC: '42',
  SE: '28', SP: '35', TO: '17',
};

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

function pfxLegado(err) {
  return err?.code === 'ERR_CRYPTO_UNSUPPORTED_OPERATION'
    || /PKCS12|unsupported/i.test(String(err?.message || ''));
}

async function httpsRequestPfxWindows({ host, path, body, arquivoPfx, passphrase }) {
  const b64 = Buffer.from(body, 'utf8').toString('base64');
  const scriptPath = path.join(os.tmpdir(), `gestor-dfe-${process.pid}-${Date.now()}.ps1`);
  const script = `
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($env:GESTOR_PFX_PATH, $env:GESTOR_PFX_PASS, $flags)
$body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))
$uri = 'https://${host}${path}'
$resp = Invoke-WebRequest -Uri $uri -Method POST -Body $body -ContentType 'application/soap+xml; charset=utf-8' -Certificate $cert -UseBasicParsing -TimeoutSec 90
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($resp.Content))
`;
  fs.writeFileSync(scriptPath, script, 'utf8');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GESTOR_PFX_PATH: arquivoPfx, GESTOR_PFX_PASS: passphrase || '' },
      }
    );
    return Buffer.from(String(stdout || '').replace(/\s+/g, ''), 'base64').toString('utf8');
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* arquivo temporário */ }
  }
}

function httpsRequestPfx({ host, path, body, pfx, passphrase, arquivoPfx }) {
  const fallback = () => httpsRequestPfxWindows({ host, path, body, arquivoPfx, passphrase })
    .then((xml) => ({ status: 200, body: xml }));
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = https.request({
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
    } catch (err) {
      if (arquivoPfx && pfxLegado(err)) {
        fallback().then(resolve, reject);
        return;
      }
      reject(err);
      return;
    }
    req.on('error', (err) => {
      if (arquivoPfx && pfxLegado(err)) {
        fallback().then(resolve, reject);
        return;
      }
      reject(err);
    });
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
  const m = String(xml || '').match(new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'i'));
  return m ? m[1].trim() : '';
}

function extractAll(xml, name) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'gi');
  const out = [];
  let m;
  const src = String(xml || '');
  while ((m = re.exec(src))) out.push(m[1].trim());
  return out;
}

function extractBlock(xml, name) {
  const m = String(xml || '').match(new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'i'));
  return m ? m[1] : '';
}

async function decodeDocZip(b64) {
  const buf = Buffer.from(String(b64 || '').replace(/\s+/g, ''), 'base64');
  try {
    return (await gunzip(buf)).toString('utf8');
  } catch {
    return buf.toString('utf8');
  }
}

function xmlNfeCompleto(xml) {
  const s = String(xml || '');
  if (/<resNFe[\s>]/i.test(s)) return false;
  return /<infNFe[\s>]/i.test(s);
}

async function parseDistLote(soapBody) {
  const cStat = extractTag(soapBody, 'cStat');
  const xMotivo = extractTag(soapBody, 'xMotivo');
  const ultNSU = extractTag(soapBody, 'ultNSU');
  const maxNSU = extractTag(soapBody, 'maxNSU');
  const docs = [];
  const re = /<docZip\b([^>]*)>([\s\S]*?)<\/docZip>/gi;
  let m;
  while ((m = re.exec(String(soapBody || '')))) {
    const attrs = m[1] || '';
    const nsu = (attrs.match(/\bNSU="(\d+)"/i) || [])[1] || '';
    const schema = (attrs.match(/\bschema="([^"]+)"/i) || [])[1] || '';
    const xml = await decodeDocZip(m[2]);
    docs.push({ nsu, schema, xml });
  }
  return { cStat, xMotivo, ultNSU, maxNSU, docs };
}

async function parseDistResponse(soapBody) {
  const lote = await parseDistLote(soapBody);
  const { cStat, xMotivo } = lote;
  if (!lote.docs.length && !['138', '137'].includes(cStat)) {
    const e = new Error(xMotivo || `SEFAZ retornou cStat=${cStat || '?'}`);
    e.cStat = cStat;
    e.ultNSU = lote.ultNSU;
    if (cStat === '656') e.code = 'CONSUMO_INDEVIDO';
    throw e;
  }
  for (const doc of lote.docs) {
    if (xmlNfeCompleto(doc.xml)) {
      return { xml: doc.xml, cStat, xMotivo };
    }
  }
  if (cStat === '137') {
    const e = new Error('SEFAZ: nenhum documento localizado para esta chave (cStat 137). Verifique se o CNPJ do certificado é o destinatário/autorizado da NF-e.');
    e.cStat = cStat;
    throw e;
  }
  const soResumo = lote.docs.some((d) => /<resNFe[\s>]/i.test(d.xml));
  const e = new Error(soResumo
    ? 'A SEFAZ devolveu só o resumo da NF-e. O XML completo sai depois da Ciência da Operação.'
    : (xMotivo || 'SEFAZ não retornou o XML da NF-e nesta consulta.'));
  e.cStat = cStat;
  e.code = soResumo ? 'SEM_XML_COMPLETO' : 'SEM_XML';
  throw e;
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
  const soap = buildSoapDist(dados);
  const responseXml = await enviarSoap({ host, path: PATH, soap, fiscal });
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

function buildSoapDist(nfeDadosMsg) {
  return buildSoap(nfeDadosMsg);
}

function nsu15(valor) {
  const digitos = String(valor || '0').replace(/\D/g, '') || '0';
  return digitos.padStart(15, '0').slice(-15);
}

function buildDistNsuXml({ cnpj, tpAmb, cUFAutor, ultNSU }) {
  const uf = String(cUFAutor || '').replace(/\D/g, '');
  const nsu = nsu15(ultNSU);
  return (
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">`
    + `<tpAmb>${tpAmb}</tpAmb>`
    + (uf.length === 2 ? `<cUFAutor>${uf}</cUFAutor>` : '')
    + `<CNPJ>${cnpj}</CNPJ>`
    + `<distNSU><ultNSU>${nsu}</ultNSU></distNSU>`
    + `</distDFeInt>`
  );
}

async function contextoFiscal(opts = {}) {
  const fiscal = { ...getFiscalConfig(), ...(opts.fiscal || {}) };
  if (!fiscalReady(fiscal)) {
    const err = new Error('Certificado fiscal não configurado. Configure em Serviço → Certificado NF-e.');
    err.code = 'SEM_CERTIFICADO';
    throw err;
  }
  const cnpj = String(opts.cnpj || await getEmitenteCnpj() || '').replace(/\D/g, '');
  if (cnpj.length !== 14) {
    throw new Error('CNPJ do emitente (destinatário da consulta) não encontrado em TB_EMITENTE.');
  }
  let cUFAutor = String(opts.cUFAutor || '').replace(/\D/g, '');
  if (!cUFAutor) {
    try {
      const uf = await require('./importacao-params').getEmitenteUf();
      cUFAutor = UF_IBGE[String(uf || '').trim().toUpperCase()] || '';
    } catch {
      cUFAutor = '';
    }
  }
  const ambiente = fiscal.ambiente === 'producao' ? 'producao' : 'homologacao';
  return { fiscal, cnpj, cUFAutor, ambiente, tpAmb: ambiente === 'producao' ? '1' : '2' };
}

async function enviarSoap({ host, path, soap, fiscal }) {
  if (fiscal.tipo === 'windows') {
    return httpsRequestWindowsCert({
      host,
      path,
      body: soap,
      thumbprint: fiscal.thumbprint,
      certStore: fiscal.certStore,
    });
  }
  const senha = decryptSecret(fiscal.senhaEnc);
  const pfx = fs.readFileSync(fiscal.arquivoPfx);
  const res = await httpsRequestPfx({
    host,
    path,
    body: soap,
    pfx,
    passphrase: senha,
    arquivoPfx: fiscal.arquivoPfx,
  });
  if (res.status >= 400) {
    throw new Error(`SEFAZ HTTP ${res.status}: ${String(res.body || '').slice(0, 300)}`);
  }
  return res.body;
}

/**
 * Uma página da distribuição por NSU (até 50 documentos).
 * Não avança o relógio de 1 hora — quem chama decide quando repetir.
 */
async function distribuirNsu(ultNSU, opts = {}) {
  const ctx = await contextoFiscal(opts);
  const dados = buildDistNsuXml({
    cnpj: ctx.cnpj,
    tpAmb: ctx.tpAmb,
    cUFAutor: ctx.cUFAutor,
    ultNSU,
  });
  const soap = buildSoapDist(dados);
  const responseXml = await enviarSoap({
    host: ENDPOINTS[ctx.ambiente],
    path: PATH,
    soap,
    fiscal: ctx.fiscal,
  });
  const lote = await parseDistLote(responseXml);
  if (lote.cStat === '656') {
    const e = new Error(lote.xMotivo || 'SEFAZ: consumo indevido. Aguarde 1 hora.');
    e.code = 'CONSUMO_INDEVIDO';
    e.cStat = '656';
    e.ultNSU = lote.ultNSU;
    throw e;
  }
  if (lote.cStat && !['137', '138'].includes(lote.cStat)) {
    const e = new Error(lote.xMotivo || `SEFAZ retornou cStat=${lote.cStat}`);
    e.cStat = lote.cStat;
    e.ultNSU = lote.ultNSU;
    throw e;
  }
  return { ...lote, cnpj: ctx.cnpj, ambiente: ctx.ambiente };
}

function dhEventoBrasil(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}-03:00`;
}

const ASSINAR_PS1 = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
if (-not ('SignedXmlComId' -as [type])) {
  Add-Type -ReferencedAssemblies System.Xml, System.Security -TypeDefinition @'
using System.Xml;
using System.Security.Cryptography.Xml;
public class SignedXmlComId : SignedXml {
  public SignedXmlComId(XmlElement el) : base(el) {}
  public override XmlElement GetIdElement(XmlDocument doc, string id) {
    XmlElement idElem = base.GetIdElement(doc, id);
    if (idElem != null) return idElem;
    foreach (XmlElement el in doc.GetElementsByTagName("infEvento")) {
      if (el.GetAttribute("Id") == id) return el;
    }
    return null;
  }
}
'@
}
$tipo = $env:GE_EVT_TIPO
if ($tipo -eq 'windows') {
  $store = [string]$env:GE_EVT_STORE
  if ($store -notmatch '^Cert:') { $store = 'Cert:\\' + $store }
  $thumb = ([string]$env:GE_EVT_THUMB -replace '[^0-9A-Fa-f]','').ToUpper()
  $cert = Get-ChildItem $store | Where-Object { $_.Thumbprint.ToUpper() -eq $thumb } | Select-Object -First 1
  if (-not $cert) { throw "Certificado nao encontrado em $store" }
} else {
  $flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2([string]$env:GE_EVT_PFX, [string]$env:GE_EVT_SENHA, $flags)
}
$xml = New-Object System.Xml.XmlDocument
$xml.PreserveWhitespace = $true
$xml.Load([string]$env:GE_EVT_IN)
$ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace('n', 'http://www.portalfiscal.inf.br/nfe')
$inf = $xml.SelectSingleNode('//n:infEvento', $ns)
if (-not $inf) { throw 'infEvento nao encontrado' }
$evento = $inf.ParentNode
$signed = New-Object SignedXmlComId($evento)
$key = $null
try { $key = $cert.PrivateKey } catch { $key = $null }
if (-not $key) {
  try { $key = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert) } catch { $key = $null }
}
if (-not $key) { throw 'Sem chave privada para assinar o evento.' }
$signed.SigningKey = $key
$signed.SignedInfo.CanonicalizationMethod = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
$signed.SignedInfo.SignatureMethod = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
$ref = New-Object System.Security.Cryptography.Xml.Reference
$ref.Uri = '#' + $inf.GetAttribute('Id')
$ref.DigestMethod = 'http://www.w3.org/2000/09/xmldsig#sha1'
[void]$ref.AddTransform((New-Object System.Security.Cryptography.Xml.XmlDsigEnvelopedSignatureTransform))
[void]$ref.AddTransform((New-Object System.Security.Cryptography.Xml.XmlDsigC14NTransform))
[void]$signed.AddReference($ref)
$ki = New-Object System.Security.Cryptography.Xml.KeyInfo
[void]$ki.AddClause((New-Object System.Security.Cryptography.Xml.KeyInfoX509Data($cert)))
$signed.KeyInfo = $ki
$signed.ComputeSignature()
[void]$evento.AppendChild($xml.ImportNode($signed.GetXml(), $true))
$xml.Save([string]$env:GE_EVT_OUT)
`;

async function assinarEventoXml(eventoXml, fiscal) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ge-evt-'));
  const inPath = path.join(dir, 'evento.xml');
  const outPath = path.join(dir, 'assinado.xml');
  const ps1 = path.join(dir, 'assinar.ps1');
  fs.writeFileSync(inPath, eventoXml, 'utf8');
  fs.writeFileSync(ps1, ASSINAR_PS1.trim(), 'utf8');
  const env = { ...process.env, GE_EVT_IN: inPath, GE_EVT_OUT: outPath };
  if (fiscal.tipo === 'windows') {
    env.GE_EVT_TIPO = 'windows';
    env.GE_EVT_THUMB = String(fiscal.thumbprint || '').replace(/[^0-9A-Fa-f]/g, '');
    env.GE_EVT_STORE = fiscal.certStore || 'CurrentUser\\My';
  } else {
    env.GE_EVT_TIPO = 'a1';
    env.GE_EVT_PFX = fiscal.arquivoPfx;
    env.GE_EVT_SENHA = decryptSecret(fiscal.senhaEnc);
  }
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    const signed = fs.readFileSync(outPath, 'utf8');
    if (!/<Signature[\s>]/i.test(signed)) throw new Error('Assinatura do evento não foi gerada.');
    return signed.replace(/^\uFEFF/, '').replace(/<\?xml[^?]*\?>\s*/i, '');
  } catch (err) {
    const msg = String(err.stderr || err.message || err).replace(/\s+/g, ' ').trim();
    throw new Error(msg.slice(0, 400) || 'Falha ao assinar o evento de ciência.');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function buildSoapEvento(envEvento) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>`
    + `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`
    + ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"`
    + ` xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">`
    + `<soap12:Body>`
    + `<nfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">`
    + `<nfeDadosMsg>${envEvento}</nfeDadosMsg>`
    + `</nfeRecepcaoEvento>`
    + `</soap12:Body></soap12:Envelope>`
  );
}

/** Ciência da Operação (210210) — libera o XML completo para o destinatário. Não confirma a compra. */
async function manifestarCiencia(chave, opts = {}) {
  const ch = String(chave || '').replace(/\D/g, '');
  if (ch.length !== 44) throw new Error('Chave inválida para manifestação.');
  const ctx = await contextoFiscal(opts);
  const tpEvento = '210210';
  const nSeq = '01';
  const id = `ID${tpEvento}${ch}${nSeq}`;
  const evento = (
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">`
    + `<infEvento Id="${id}">`
    + `<cOrgao>91</cOrgao>`
    + `<tpAmb>${ctx.tpAmb}</tpAmb>`
    + `<CNPJ>${ctx.cnpj}</CNPJ>`
    + `<chNFe>${ch}</chNFe>`
    + `<dhEvento>${dhEventoBrasil()}</dhEvento>`
    + `<tpEvento>${tpEvento}</tpEvento>`
    + `<nSeqEvento>1</nSeqEvento>`
    + `<verEvento>1.00</verEvento>`
    + `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>`
    + `</infEvento></evento>`
  );
  const assinado = await assinarEventoXml(evento, ctx.fiscal);
  const idLote = String(Date.now()).slice(-15);
  const env = (
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">`
    + `<idLote>${idLote}</idLote>${assinado}</envEvento>`
  );
  const ep = EVENTO_ENDPOINTS[ctx.ambiente];
  const soap = buildSoapEvento(env);
  const responseXml = await enviarSoap({ host: ep.host, path: ep.path, soap, fiscal: ctx.fiscal });
  const stats = extractAll(responseXml, 'cStat');
  const motivos = extractAll(responseXml, 'xMotivo');
  const ok = stats.some((s) => ['135', '136', '573'].includes(s));
  if (!ok) {
    const motivo = motivos.filter((m) => !/lote/i.test(m)).pop() || motivos.pop() || `cStat ${stats.join(',') || '?'}`;
    const e = new Error(`SEFAZ não registrou a ciência: ${motivo}`);
    e.cStat = stats[stats.length - 1] || '';
    throw e;
  }
  return { ok: true, cStat: stats[stats.length - 1] || '135', xMotivo: motivos.pop() || '' };
}

module.exports = {
  consultarChaveSefaz,
  distribuirNsu,
  manifestarCiencia,
  fiscalReady,
  getEmitenteCnpj,
  xmlNfeCompleto,
  extractTag,
  extractBlock,
};
