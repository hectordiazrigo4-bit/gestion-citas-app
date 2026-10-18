// Conversión entre horas locales del negocio (zona horaria IANA) y milisegundos UTC.
// Usa la API Intl del runtime, que incluye las reglas de horario de verano.

import { HttpError } from "./http.js";

const MINUTO = 60 * 1000;
const FORMATO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const FORMATO_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// Acepta "AAAA-MM-DDTHH:MM" (hora local del negocio) o una fecha ISO con zona (p. ej. la que devuelve la disponibilidad).
export function parseDateTime(text, timezone) {
  if (typeof text !== "string") throw new HttpError(400, "Indica la fecha y la hora");
  if (FORMATO_ISO.test(text)) {
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) throw new HttpError(400, "La fecha y hora no son válidas");
    return ms;
  }
  const m = text.match(FORMATO_LOCAL);
  if (!m) throw new HttpError(400, "La fecha y hora no son válidas (formato AAAA-MM-DDTHH:MM)");
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) {
    throw new HttpError(400, "La fecha y hora no son válidas");
  }
  const ms = zonedToUtc(timezone, y, mo, d, h, mi);
  // Rechaza horas que no existen (p. ej. 31 de febrero o la hora que se salta el cambio de horario).
  const ida = localParts(timezone, ms);
  if (ida.y !== y || ida.mo !== mo || ida.d !== d || ida.h !== h || ida.mi !== mi) {
    throw new HttpError(400, "Esa fecha y hora no existen en el calendario");
  }
  return ms;
}

// Valida "AAAA-MM-DD" y devuelve sus partes.
export function parseDate(text) {
  const m = typeof text === "string" && text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new HttpError(400, "La fecha debe tener el formato AAAA-MM-DD");
  const [y, mo, d] = m.slice(1).map(Number);
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) {
    throw new HttpError(400, "La fecha no existe en el calendario");
  }
  return { y, mo, d };
}

// Inicio y fin de un día local, más su día de la semana (0 = domingo).
export function dayBounds(timezone, dateText) {
  const { y, mo, d } = parseDate(dateText);
  const siguiente = new Date(Date.UTC(y, mo - 1, d + 1));
  return {
    start: zonedToUtc(timezone, y, mo, d, 0, 0),
    end: zonedToUtc(timezone, siguiente.getUTCFullYear(), siguiente.getUTCMonth() + 1, siguiente.getUTCDate(), 0, 0),
    weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
    parts: { y, mo, d },
  };
}

// Hora local de la zona indicada -> milisegundos UTC.
export function zonedToUtc(timezone, y, mo, d, h, mi) {
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const primera = local - offsetMs(timezone, local);
  return local - offsetMs(timezone, primera);
}

export function localParts(timezone, ms) {
  const partes = formatter(timezone).formatToParts(new Date(ms));
  const valor = (tipo) => Number(partes.find((p) => p.type === tipo).value);
  return {
    y: valor("year"),
    mo: valor("month"),
    d: valor("day"),
    h: valor("hour") % 24,
    mi: valor("minute"),
  };
}

const formateadores = new Map();
function formatter(timezone) {
  if (!formateadores.has(timezone)) {
    formateadores.set(
      timezone,
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }
  return formateadores.get(timezone);
}

// Desfase en milisegundos de la zona respecto a UTC en ese instante.
function offsetMs(timezone, ms) {
  const p = localParts(timezone, ms);
  const segundos = Math.floor(ms / 1000);
  const comoUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, segundos % 60);
  return comoUtc - segundos * 1000;
}

export function minutesToTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function parseTime(text, campo) {
  const m = typeof text === "string" && text.match(/^(\d{2}):(\d{2})$/);
  if (!m) throw new HttpError(400, `La hora de ${campo} debe tener el formato HH:MM`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) throw new HttpError(400, `La hora de ${campo} no es válida`);
  return h * 60 + mi;
}

export { MINUTO };
