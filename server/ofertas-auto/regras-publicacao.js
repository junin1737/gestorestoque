'use strict';

function minutos(hora) {
  const m = String(hora || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Quantos posts cabem entre o início e o fim, com o primeiro no início e os demais a cada intervalo. */
function capacidadeJanela({ horaInicio, horaFim, intervaloMinutos, postsPorDia }) {
  const ini = minutos(horaInicio);
  const fim = minutos(horaFim);
  const intervalo = Number(intervaloMinutos);
  const pedidos = Number(postsPorDia);
  if (ini == null || fim == null) {
    return { cabe: false, vagas: 0, aviso: 'Informe o início e o fim da janela no formato HH:MM.' };
  }
  if (fim <= ini) {
    return { cabe: false, vagas: 0, aviso: 'O fim da janela precisa ser depois do início.' };
  }
  if (!Number.isFinite(intervalo) || intervalo < 1) {
    return { cabe: false, vagas: 0, aviso: 'O intervalo mínimo precisa ser de pelo menos 1 minuto.' };
  }
  const vagas = Math.floor((fim - ini) / intervalo) + 1;
  const cabe = Number.isFinite(pedidos) && pedidos >= 1 && pedidos <= vagas;
  return {
    cabe,
    vagas,
    aviso: cabe ? '' : `A janela comporta ${vagas} post(s) com esse intervalo, e a quantidade pedida é ${pedidos}.`,
  };
}

module.exports = { minutos, capacidadeJanela };
