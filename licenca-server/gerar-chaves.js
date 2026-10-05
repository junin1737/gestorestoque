'use strict';
// Gera o par Ed25519 da licença e a senha do painel (uma vez). Não sobrescreve chaves existentes.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '.keys');
const privPath = path.join(dir, 'licenca-private.pem');
const pubPath = path.join(dir, 'licenca-public.pem');
const senhaPath = path.join(dir, 'admin-senha.txt');

if (fs.existsSync(privPath)) {
  console.log('Chaves já existem em', dir);
} else {
  fs.mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const senha = crypto.randomBytes(12).toString('base64url');
  fs.writeFileSync(senhaPath, senha);
  console.log('Chaves geradas em', dir);
}

const priv = fs.readFileSync(privPath, 'utf8').trim();
const senha = fs.readFileSync(senhaPath, 'utf8').trim();
fs.writeFileSync(
  path.join(__dirname, '.dev.vars'),
  `LICENCA_PRIVATE_KEY="${priv.replace(/\r?\n/g, '\\n')}"\nADMIN_PASSWORD="${senha}"\n`
);
console.log('Pública:\n' + fs.readFileSync(pubPath, 'utf8'));
