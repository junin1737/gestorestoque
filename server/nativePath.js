'use strict';
const fs = require('fs');
const path = require('path');

function isPackaged() {
  return process.env.GESTOR_PACKAGED === '1' || process.defaultApp === false && !!process.resourcesPath;
}

function resourcesRoot() {
  if (process.env.GESTOR_RESOURCES) return process.env.GESTOR_RESOURCES;
  if (process.resourcesPath && isPackaged()) return process.resourcesPath;
  return path.join(__dirname, '..');
}

function resolveMtdllDir() {
  const candidates = [
    path.join(resourcesRoot(), 'MTdll'),
    path.join(__dirname, '..', 'MTdll'),
    path.join(process.cwd(), 'MTdll'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

/** Coloca MTdll no PATH para o Windows achar fbclient*.dll */
function ensureFirebirdClientPath() {
  if (process.platform !== 'win32') return null;
  const dir = resolveMtdllDir();
  if (!fs.existsSync(dir)) return null;
  const parts = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (!parts.some((p) => path.resolve(p).toLowerCase() === path.resolve(dir).toLowerCase())) {
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH || ''}`;
  }
  return dir;
}

module.exports = {
  isPackaged,
  resourcesRoot,
  resolveMtdllDir,
  ensureFirebirdClientPath,
};
