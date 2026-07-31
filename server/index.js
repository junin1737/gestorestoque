'use strict';
const express = require('express');
const path = require('path');
const routes = require('./routes');
const { PORT } = require('./config');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'Painel')));
app.use('/api', routes);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Painel', 'index.html'));
});

if (require.main === module || !process.versions.electron) {
  // When required by Electron, still listen; when `node server/index.js`, same.
}

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Gestor Estoque API em http://127.0.0.1:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Porta ${PORT} em uso — assumindo instância já ativa.`);
  } else {
    console.error(err);
  }
});

module.exports = { app, PORT };
