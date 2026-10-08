'use strict';

/** Chave do dia se o horário já chegou e ainda está na janela de 90s. Vazio se não deve desligar. */
function chaveRotinaDesligamento(rotinas, agora) {
  if (!rotinas || rotinas.ativo !== true) return '';
  const horas = rotinas.horas && typeof rotinas.horas === 'object' ? rotinas.horas : null;
  let hora = '';
  if (horas) hora = String(horas[String(agora.getDay())] || '');
  else if (Array.isArray(rotinas.dias) && rotinas.dias.map(Number).includes(agora.getDay())) hora = String(rotinas.hora || '');
  if (!/^\d{2}:\d{2}$/.test(hora)) return '';
  const [hh, mm] = hora.split(':').map(Number);
  const alvo = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), hh, mm, 0, 0);
  const delta = agora.getTime() - alvo.getTime();
  if (delta < 0 || delta >= 90 * 1000) return '';
  return `${agora.getFullYear()}-${agora.getMonth()}-${agora.getDate()} ${hora}`;
}

module.exports = { chaveRotinaDesligamento };
