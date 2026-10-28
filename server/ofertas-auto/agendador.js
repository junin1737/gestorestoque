'use strict';

const { pulso } = require('./publicador');

let timer = null;

function iniciar() {
  if (timer) return;
  const rodar = () => {
    pulso().catch((err) => console.warn('Publicação da oferta:', err.message));
  };
  setTimeout(rodar, 8000).unref?.();
  timer = setInterval(rodar, 30000);
  timer.unref?.();
}

module.exports = { iniciar };
