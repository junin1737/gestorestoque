'use strict';

const { partesBrasilia } = require('./datetime');

/** Chave do dia se o horário de Brasília já chegou e ainda está na janela de 90s. Vazio se não deve desligar. */
function chaveRotinaDesligamento(rotinas, agora) {
  if (!rotinas || rotinas.ativo !== true) return '';
  const p = partesBrasilia(agora instanceof Date ? agora : new Date());
  const horas = rotinas.horas && typeof rotinas.horas === 'object' ? rotinas.horas : null;
  let hora = '';
  if (horas) hora = String(horas[String(p.diaSemana)] || '');
  else if (Array.isArray(rotinas.dias) && rotinas.dias.map(Number).includes(p.diaSemana)) hora = String(rotinas.hora || '');
  if (!/^\d{2}:\d{2}$/.test(hora)) return '';
  const [hh, mm] = hora.split(':').map(Number);
  const delta = (p.h * 3600 + p.min * 60 + p.s) - (hh * 3600 + mm * 60);
  if (delta < 0 || delta >= 90) return '';
  return `${p.y}-${p.m}-${p.d} ${hora}`;
}

module.exports = { chaveRotinaDesligamento };
