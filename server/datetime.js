'use strict';

function pad2(n) {
  return String(Math.trunc(Number(n) || 0)).padStart(2, '0');
}

/** Relógio civil de Brasília. Não segue o fuso configurado no Windows. */
const FUSO_BRASILIA = 'America/Sao_Paulo';
const DIAS_SEMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function partesBrasilia(instante = new Date()) {
  const data = instante instanceof Date ? instante : new Date(instante);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_BRASILIA,
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
  for (const parte of fmt.formatToParts(data)) {
    if (parte.type !== 'literal') p[parte.type] = parte.value;
  }
  let h = Number(p.hour);
  if (h === 24) h = 0;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h,
    min: Number(p.minute),
    s: Number(p.second),
    diaSemana: DIAS_SEMANA[p.weekday] ?? 0,
  };
}

/** Data/hora de Brasília no momento da gravação. */
function localNow(instante) {
  const p = partesBrasilia(instante);
  const y = p.y;
  const m = pad2(p.m);
  const d = pad2(p.d);
  const hh = pad2(p.h);
  const mm = pad2(p.min);
  const ss = pad2(p.s);
  return {
    dataSql: `${y}-${m}-${d}`,
    horaSql: `${hh}:${mm}:${ss}`,
    display: `${d}/${m}/${y} ${hh}:${mm}:${ss}`,
    dataBr: `${d}/${m}/${y}`,
    diaSemana: p.diaSemana,
  };
}

function isoHoje(instante) {
  return localNow(instante).dataSql;
}

function somarDias(iso, dias) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(dias || 0));
  return dt.toISOString().slice(0, 10);
}

/** Literal do Firebird com o relógio de Brasília, no instante em que a frase SQL é montada. */
function sqlTimestamp(instante) {
  const n = localNow(instante);
  return `TIMESTAMP '${n.dataSql} ${n.horaSql}'`;
}

function sqlDate(instante) {
  return `DATE '${localNow(instante).dataSql}'`;
}

function sqlTime(instante) {
  return `TIME '${localNow(instante).horaSql}'`;
}

function extractTimeParts(hora) {
  if (hora == null || hora === '') return null;

  if (hora instanceof Date && !Number.isNaN(hora.getTime())) {
    // TIME do Firebird costuma vir como 1970-01-01Txx:xx:xx.000Z
    if (hora.getUTCFullYear() <= 1970 || hora.getFullYear() <= 1970) {
      return {
        h: hora.getUTCHours(),
        m: hora.getUTCMinutes(),
        s: hora.getUTCSeconds(),
      };
    }
    return {
      h: hora.getHours(),
      m: hora.getMinutes(),
      s: hora.getSeconds(),
    };
  }

  const s = String(hora).trim();

  // ISO com T: 1970-01-01T10:50:35.000Z
  let match = s.match(/T(\d{2}):(\d{2}):(\d{2})/i);
  if (match) return { h: +match[1], m: +match[2], s: +match[3] };

  // Só hora: 10:50:35
  match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (match) return { h: +match[1], m: +match[2], s: +(match[3] || 0) };

  // Espaço: 1970-01-01 10:50:35
  match = s.match(/\s(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) return { h: +match[1], m: +match[2], s: +(match[3] || 0) };

  return null;
}

function extractDateParts(data) {
  if (data == null || data === '') return null;

  if (data instanceof Date && !Number.isNaN(data.getTime())) {
    const iso = data.toISOString();
    if (/T00:00:00/.test(iso) || data.getUTCFullYear() > 1980) {
      // DATE Firebird = meia-noite UTC
      if (/T00:00:00/.test(iso)) {
        return {
          y: data.getUTCFullYear(),
          m: data.getUTCMonth() + 1,
          d: data.getUTCDate(),
        };
      }
    }
    return {
      y: data.getFullYear(),
      m: data.getMonth() + 1,
      d: data.getDate(),
    };
  }

  const s = String(data).trim();
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return { y: +match[1], m: +match[2], d: +match[3] };
  match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return { y: +match[3], m: +match[2], d: +match[1] };
  return null;
}

/** Formata para dd/MM/yyyy HH:mm:ss — aceita Date, string ou partes EXTRACT do Firebird */
function formatBrDateTime(data, hora, parts) {
  if (parts && parts.y) {
    const datePart = `${pad2(parts.d)}/${pad2(parts.m)}/${parts.y}`;
    if (parts.h == null && parts.th == null) return datePart;
    const h = parts.h != null ? parts.h : parts.th;
    const mi = parts.min != null ? parts.min : parts.tm;
    const s = parts.s != null ? parts.s : parts.ts;
    return `${datePart} ${pad2(h)}:${pad2(mi)}:${pad2(Math.floor(Number(s) || 0))}`;
  }

  const dp = extractDateParts(data);
  if (!dp) return '—';
  const datePart = `${pad2(dp.d)}/${pad2(dp.m)}/${dp.y}`;
  const tp = extractTimeParts(hora);
  if (!tp) return datePart;
  return `${datePart} ${pad2(tp.h)}:${pad2(tp.m)}:${pad2(tp.s)}`;
}

function mapExtractParts(r) {
  const y = r.DY != null ? Number(r.DY) : null;
  if (!y) return null;
  return {
    y,
    m: Number(r.DM),
    d: Number(r.DD),
    h: r.TH != null ? Number(r.TH) : null,
    min: r.TM != null ? Number(r.TM) : null,
    s: r.TS != null ? Number(r.TS) : null,
  };
}

const SQL_EXTRACT_DATA_HORA = `
  EXTRACT(YEAR FROM %DATA%) AS DY,
  EXTRACT(MONTH FROM %DATA%) AS DM,
  EXTRACT(DAY FROM %DATA%) AS DD,
  EXTRACT(HOUR FROM %HORA%) AS TH,
  EXTRACT(MINUTE FROM %HORA%) AS TM,
  EXTRACT(SECOND FROM %HORA%) AS TS
`.replace(/\s+/g, ' ').trim();

function sqlExtractDataHora(dataAlias, horaAlias) {
  return SQL_EXTRACT_DATA_HORA
    .replace(/%DATA%/g, dataAlias)
    .replace(/%HORA%/g, horaAlias);
}

module.exports = {
  pad2,
  FUSO_BRASILIA,
  partesBrasilia,
  localNow,
  isoHoje,
  somarDias,
  sqlTimestamp,
  sqlDate,
  sqlTime,
  extractTimeParts,
  extractDateParts,
  formatBrDateTime,
  mapExtractParts,
  sqlExtractDataHora,
};
