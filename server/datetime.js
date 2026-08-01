'use strict';

function pad2(n) {
  return String(Math.trunc(Number(n) || 0)).padStart(2, '0');
}

/** Data/hora local do servidor no momento da gravação */
function localNow() {
  const n = new Date();
  const y = n.getFullYear();
  const m = pad2(n.getMonth() + 1);
  const d = pad2(n.getDate());
  const hh = pad2(n.getHours());
  const mm = pad2(n.getMinutes());
  const ss = pad2(n.getSeconds());
  return {
    dataSql: `${y}-${m}-${d}`,
    horaSql: `${hh}:${mm}:${ss}`,
    display: `${d}/${m}/${y} ${hh}:${mm}:${ss}`,
  };
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
  localNow,
  extractTimeParts,
  extractDateParts,
  formatBrDateTime,
  mapExtractParts,
  sqlExtractDataHora,
};
