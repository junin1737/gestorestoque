'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { loadAppConfig, saveAppConfig, getAppDataDir } = require('./config');

const execFileAsync = promisify(execFile);

function defaultFiscalConfig() {
  return {
    tipo: 'a1', // a1 | windows
    arquivoPfx: '',
    senhaEnc: '',
    thumbprint: '',
    certStore: 'CurrentUser\\My',
    ambiente: 'homologacao', // homologacao | producao
  };
}

function machineSecret() {
  const seedPath = path.join(getAppDataDir(), '.fiscal-key');
  if (fs.existsSync(seedPath)) {
    return fs.readFileSync(seedPath);
  }
  const seed = crypto.randomBytes(32);
  fs.writeFileSync(seedPath, seed);
  return seed;
}

function encryptSecret(plain) {
  if (!plain) return '';
  const key = crypto.createHash('sha256').update(machineSecret()).update('gestor-fiscal-v1').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(encB64) {
  if (!encB64) return '';
  try {
    const buf = Buffer.from(encB64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const key = crypto.createHash('sha256').update(machineSecret()).update('gestor-fiscal-v1').digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function getFiscalConfig() {
  const cfg = loadAppConfig();
  return { ...defaultFiscalConfig(), ...(cfg.fiscal || {}) };
}

function saveFiscalConfig(patch) {
  const cfg = loadAppConfig();
  const current = { ...defaultFiscalConfig(), ...(cfg.fiscal || {}) };
  const next = { ...current };
  if (patch.tipo !== undefined) next.tipo = patch.tipo;
  if (patch.arquivoPfx !== undefined) next.arquivoPfx = patch.arquivoPfx;
  if (patch.thumbprint !== undefined) next.thumbprint = patch.thumbprint;
  if (patch.certStore !== undefined) next.certStore = patch.certStore;
  if (patch.ambiente !== undefined) next.ambiente = patch.ambiente;
  if (patch.senha !== undefined) {
    next.senhaEnc = patch.senha ? encryptSecret(patch.senha) : current.senhaEnc;
  }
  cfg.fiscal = next;
  saveAppConfig(cfg);
  return next;
}

function publicFiscalConfig(fiscal) {
  const f = fiscal || getFiscalConfig();
  return {
    tipo: f.tipo || 'a1',
    arquivoPfx: f.arquivoPfx || '',
    thumbprint: f.thumbprint || '',
    certStore: f.certStore || 'CurrentUser\\My',
    ambiente: f.ambiente || 'homologacao',
    hasSenha: !!f.senhaEnc,
  };
}

async function runPowerShell(script) {
  if (process.platform !== 'win32') {
    throw new Error('Listagem de certificados Windows disponível apenas no servidor Windows.');
  }
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  if (stderr && !stdout) throw new Error(stderr.trim());
  return stdout.trim();
}

function extractCnpjFromSubject(subject) {
  const m = String(subject || '').match(/\d{14}/);
  return m ? m[0] : '';
}

async function listWindowsCertificates() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$items = @()
foreach ($store in @('Cert:\\CurrentUser\\My','Cert:\\LocalMachine\\My')) {
  Get-ChildItem $store | Where-Object { $_.HasPrivateKey } | ForEach-Object {
    $items += [PSCustomObject]@{
      thumbprint = $_.Thumbprint
      subject = $_.Subject
      notAfter = $_.NotAfter.ToString('yyyy-MM-dd')
      notBefore = $_.NotBefore.ToString('yyyy-MM-dd')
      store = $store
    }
  }
}
if (-not $items.Count) { '[]' } else { $items | ConvertTo-Json -Compress }
`;
  const out = await runPowerShell(script);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((c) => ({
      thumbprint: c.thumbprint,
      subject: c.subject,
      notAfter: c.notAfter,
      notBefore: c.notBefore,
      store: c.store,
      cnpj: extractCnpjFromSubject(c.subject),
      label: `${extractCnpjFromSubject(c.subject) || 'Certificado'} · válido até ${c.notAfter}`,
    }));
  } catch {
    return [];
  }
}

function psEscape(str) {
  return String(str || '').replace(/'/g, "''");
}

async function testA1Certificate(arquivoPfx, senha) {
  if (!arquivoPfx || !fs.existsSync(arquivoPfx)) {
    return { ok: false, error: 'Arquivo .pfx não encontrado.' };
  }
  if (!senha) return { ok: false, error: 'Informe a senha do certificado.' };

  const script = `
$ErrorActionPreference = 'Stop'
try {
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${psEscape(arquivoPfx)}', '${psEscape(senha)}', [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
  $sub = $cert.Subject
  $cnpj = ([regex]::Match($sub, '\\d{14}')).Value
  @{
    ok = $true
    subject = $sub
    thumbprint = $cert.Thumbprint
    notAfter = $cert.NotAfter.ToString('yyyy-MM-dd')
    notBefore = $cert.NotBefore.ToString('yyyy-MM-dd')
    cnpj = $cnpj
  } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
  const out = await runPowerShell(script);
  return JSON.parse(out || '{"ok":false,"error":"Resposta vazia"}');
}

async function testWindowsCertificate(thumbprint, certStore) {
  if (!thumbprint) return { ok: false, error: 'Selecione um certificado instalado no Windows.' };
  const store = certStore || 'Cert:\\CurrentUser\\My';
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $cert = Get-ChildItem '${psEscape(store)}' | Where-Object { $_.Thumbprint -eq '${psEscape(thumbprint)}' } | Select-Object -First 1
  if (-not $cert) { throw 'Certificado não encontrado no repositório selecionado.' }
  if (-not $cert.HasPrivateKey) { throw 'Certificado sem chave privada.' }
  $okKey = $false
  try { $okKey = $null -ne $cert.GetRSAPrivateKey() } catch { $okKey = $false }
  if (-not $okKey) {
    try { $okKey = $null -ne $cert.PrivateKey } catch { $okKey = $false }
  }
  if (-not $okKey) { throw 'Não foi possível acessar a chave privada (token/smart card ou permissão).' }
  $sub = $cert.Subject
  $cnpj = ([regex]::Match($sub, '\\d{14}')).Value
  @{
    ok = $true
    subject = $sub
    thumbprint = $cert.Thumbprint
    notAfter = $cert.NotAfter.ToString('yyyy-MM-dd')
    notBefore = $cert.NotBefore.ToString('yyyy-MM-dd')
    cnpj = $cnpj
    store = '${psEscape(store)}'
  } | ConvertTo-Json -Compress
} catch {
  @{ ok = false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
  const out = await runPowerShell(script);
  return JSON.parse(out || '{"ok":false,"error":"Resposta vazia"}');
}

async function testFiscalConfig(override = {}) {
  const fiscal = { ...getFiscalConfig(), ...override };
  const senha = override.senha != null && override.senha !== ''
    ? override.senha
    : decryptSecret(fiscal.senhaEnc);

  let result;
  if (fiscal.tipo === 'windows') {
    result = await testWindowsCertificate(fiscal.thumbprint, fiscal.certStore);
  } else {
    result = await testA1Certificate(fiscal.arquivoPfx, senha);
  }

  if (!result.ok) return result;

  const emitenteCnpj = override.emitenteCnpj || '';
  if (emitenteCnpj && result.cnpj && emitenteCnpj !== result.cnpj) {
    return {
      ok: false,
      error: `CNPJ do certificado (${result.cnpj}) difere do emitente configurado (${emitenteCnpj}).`,
      certificado: result,
    };
  }

  const hoje = new Date();
  const val = new Date(result.notAfter);
  if (val < hoje) {
    return { ok: false, error: 'Certificado expirado.', certificado: result };
  }

  return {
    ok: true,
    message: 'Certificado válido e pronto para uso no servidor.',
    certificado: result,
    ambiente: fiscal.ambiente,
  };
}

module.exports = {
  defaultFiscalConfig,
  getFiscalConfig,
  saveFiscalConfig,
  publicFiscalConfig,
  listWindowsCertificates,
  testFiscalConfig,
  decryptSecret,
};
