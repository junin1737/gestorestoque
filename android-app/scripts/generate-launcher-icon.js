'use strict';
/**
 * Gera o ícone do APK a partir de TB_EMITENTE.
 * Com logo: usa a imagem. Sem logo: iniciais do NOME_FANTA.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
process.chdir(root);

const { ensureFirebirdClientPath } = require(path.join(root, 'server', 'nativePath'));
const { loadAppConfig } = require(path.join(root, 'server', 'config'));
const { connectSmart, detach, query, blobToDataUrl } = require(path.join(root, 'server', 'db'));

function initialsFromName(name) {
  const raw = String(name || '').trim();
  const skip = /^(de|da|do|das|dos|e|the|and)$/i;
  const parts = raw.split(/\s+/).filter((w) => w && !skip.test(w));
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const letters = raw.replace(/[^A-Za-z0-9À-ÿ]/g, '');
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  if (letters.length === 1) return (letters + letters).toUpperCase();
  return 'GE';
}

function detectExt(buf) {
  if (!buf || buf.length < 4) return '.bin';
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return '.gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return '.bmp';
  return '.bin';
}

async function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) return null;
  const m = String(dataUrl).match(/^data:[^;]+;base64,(.+)$/);
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

async function loadEmitente() {
  ensureFirebirdClientPath();
  const cfg = loadAppConfig();
  const { db } = await connectSmart(cfg);
  try {
    const rows = await query(db, 'SELECT FIRST 1 NOME_FANTA, NOME, LOGO FROM TB_EMITENTE');
    const row = rows[0] || {};
    const nome = String(row.NOME_FANTA || row.NOME || '').trim() || 'Gestor Estoque';
    const logoUrl = await blobToDataUrl(row.LOGO);
    const logoBuf = await dataUrlToBuffer(logoUrl);
    return { nome, logoBuf };
  } finally {
    await detach(db);
  }
}

async function main() {
  const cacheDir = path.join(__dirname, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  let nome = 'Gestor Estoque';
  let logoBuf = null;
  try {
    const data = await loadEmitente();
    nome = data.nome;
    logoBuf = data.logoBuf;
    console.log(`Emitente: ${nome}${logoBuf ? ` (logo ${logoBuf.length} bytes)` : ' (sem logo)'}`);
  } catch (err) {
    console.warn('Não leu TB_EMITENTE, usando iniciais GE:', err.message);
  }

  const initials = initialsFromName(nome);
  const meta = { nome, initials, hasLogo: !!(logoBuf && logoBuf.length) };
  fs.writeFileSync(path.join(cacheDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  const logoPath = path.join(cacheDir, `logo${logoBuf ? detectExt(logoBuf) : '.bin'}`);
  if (logoBuf && logoBuf.length) fs.writeFileSync(logoPath, logoBuf);
  else if (fs.existsSync(logoPath)) fs.unlinkSync(logoPath);

  const ps1 = path.join(__dirname, 'Render-LauncherIcon.ps1');
  const resDir = path.join(__dirname, '..', 'app', 'src', 'main', 'res');
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1,
    '-ResDir', resDir,
    '-Initials', initials,
    '-HasLogo', meta.hasLogo ? '1' : '0',
    '-LogoPath', meta.hasLogo ? logoPath : '',
  ];
  const run = spawnSync('powershell', args, { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  const png = path.join(resDir, 'mipmap-xxxhdpi', 'ic_launcher.png');
  if (!fs.existsSync(png) || fs.statSync(png).size < 200) {
    console.error('Ícone PNG não foi gerado.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
