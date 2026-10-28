'use strict';

function minutos(hora) {
  const m = String(hora || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Quantos posts cabem entre o início e o fim, com o primeiro no início e os demais a cada intervalo. */
function capacidadeJanela(entrada) {
  const horaInicio = entrada?.horaInicio ?? entrada?.hora_inicio;
  const horaFim = entrada?.horaFim ?? entrada?.hora_fim;
  const intervaloMinutos = entrada?.intervaloMinutos ?? entrada?.intervalo_minutos;
  const postsPorDia = entrada?.postsPorDia ?? entrada?.posts_por_dia;
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

/** O dia da semana em que a campanha começa. A postagem manual nasce só nesse dia. */
function diaDaOferta(inicio) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(inicio || ''))) return [];
  const dia = new Date(`${inicio}T12:00:00`);
  if (Number.isNaN(dia.getTime())) return [];
  return [dia.getDay()];
}

function isoDia(data) {
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${m}-${d}`;
}

function horaDe(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Um horário por produto, dentro dos dias e da janela já configurados na publicação. */
function montarRotina({ inicio, fim, produtos, publicacao, fds }) {
  const ids = [];
  const porId = new Map();
  for (const item of produtos || []) {
    const id = String(item?.id || item || '').trim();
    if (!id || porId.has(id)) continue;
    porId.set(id, {
      id,
      descricao: String(item?.descricao || '').slice(0, 120),
      detalhe: String(item?.detalhe || '').slice(0, 200),
    });
    ids.push(id);
  }
  if (!ids.length) throw new Error('Inclua produtos na oferta antes de gerar a rotina.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(inicio || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(fim || ''))) {
    throw new Error('Informe o início e o fim da oferta.');
  }
  if (fim < inicio) throw new Error('O fim da oferta é anterior ao início.');
  const pub = publicacao || {};
  const janela = capacidadeJanela({
    horaInicio: pub.hora_inicio,
    horaFim: pub.hora_fim,
    intervaloMinutos: pub.intervalo_minutos,
    postsPorDia: pub.posts_por_dia,
  });
  if (!janela.cabe) throw new Error(janela.aviso || 'A janela de publicação não comporta a rotina.');
  const dias = new Set((pub.dias_semana || []).map(Number));
  const posts = Number(pub.posts_por_dia);
  const intervalo = Number(pub.intervalo_minutos);
  const ini = minutos(pub.hora_inicio);
  const rotina = [];
  const dia = new Date(`${inicio}T12:00:00`);
  const limite = new Date(`${fim}T12:00:00`);
  let idx = 0;
  let voltas = 0;
  while (dia <= limite && idx < ids.length && voltas < 120) {
    voltas += 1;
    if (dias.has(dia.getDay())) {
      for (let n = 0; n < posts && idx < ids.length; n += 1) {
        const produto = porId.get(ids[idx]);
        rotina.push({
          produto_id: produto.id,
          descricao: produto.descricao,
          detalhe: produto.detalhe,
          data: isoDia(dia),
          hora: horaDe(ini + n * intervalo),
        });
        idx += 1;
      }
    }
    dia.setDate(dia.getDate() + 1);
  }
  if (fds?.ativo) {
    const extra = new Date(`${inicio}T12:00:00`);
    const qtd = Math.min(10, Math.max(0, Number(fds.qtd) || 0));
    let guard = 0;
    while (extra <= limite && guard < 60) {
      guard += 1;
      const semana = extra.getDay();
      if ((semana === 0 || semana === 6) && qtd > 0) {
        for (let n = 0; n < qtd; n += 1) {
          rotina.push({
            produto_id: '',
            descricao: 'Engajamento',
            detalhe: fds.encarte && semana === 6 && n === 0 ? 'Encarte' : '',
            data: isoDia(extra),
            hora: pub.hora_inicio,
          });
        }
      }
      extra.setDate(extra.getDate() + 1);
    }
  }
  return {
    rotina,
    faltaram: Math.max(0, ids.length - idx),
    aviso: idx < ids.length ? 'A oferta termina antes de encaixar todos os produtos. Aumente o período ou os posts por dia.' : '',
  };
}

module.exports = { minutos, capacidadeJanela, montarRotina, diaDaOferta };
