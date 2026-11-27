/* Relógio civil de Brasília para as telas. Não usa o fuso do computador. */
(function (global) {
  const FUSO = 'America/Sao_Paulo';
  const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function partes(instante) {
    const data = instante instanceof Date ? instante : new Date(instante || Date.now());
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: FUSO,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const p = {};
    fmt.formatToParts(data).forEach((parte) => {
      if (parte.type !== 'literal') p[parte.type] = parte.value;
    });
    let h = Number(p.hour);
    if (h === 24) h = 0;
    return {
      y: Number(p.year),
      m: Number(p.month),
      d: Number(p.day),
      h,
      min: Number(p.minute),
      s: Number(p.second),
      diaSemana: DIAS[p.weekday] ?? 0,
    };
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function hoje() {
    const p = partes(new Date());
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }

  function somarDias(iso, dias) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    dt.setUTCDate(dt.getUTCDate() + Number(dias || 0));
    return dt.toISOString().slice(0, 10);
  }

  function dePartes(p, comSegundos) {
    const data = `${pad(p.d)}/${pad(p.m)}/${p.y}`;
    const hora = comSegundos ? `${pad(p.h)}:${pad(p.min)}:${pad(p.s)}` : `${pad(p.h)}:${pad(p.min)}`;
    return `${data} ${hora}`;
  }

  function texto(instante) {
    return dePartes(partes(instante || new Date()), false);
  }

  function textoCompleto(instante) {
    return dePartes(partes(instante || new Date()), true);
  }

  function data(instante) {
    const p = partes(instante || new Date());
    return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
  }

  global.GestorHora = { fuso: FUSO, partes, hoje, somarDias, texto, textoCompleto, data };
})(window);
