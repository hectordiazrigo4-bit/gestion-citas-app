import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToUtc, parseDateTime, parseDate, dayBounds, localParts } from "../src/tiempo.js";

const MADRID = "Europe/Madrid";

test("hora local de invierno (UTC+1) se convierte bien", () => {
  // 15 de enero de 2026, 10:00 en Madrid = 09:00 UTC
  assert.equal(zonedToUtc(MADRID, 2026, 1, 15, 10, 0), Date.UTC(2026, 0, 15, 9, 0));
});

test("hora local de verano (UTC+2) se convierte bien", () => {
  // 1 de julio de 2026, 10:00 en Madrid = 08:00 UTC
  assert.equal(zonedToUtc(MADRID, 2026, 7, 1, 10, 0), Date.UTC(2026, 6, 1, 8, 0));
});

test("el día del cambio de horario de primavera tiene 23 horas", () => {
  // 29 de marzo de 2026: el día empieza a las 00:00 (+1) y termina a las 00:00 del 30 (+2)
  const inicio = dayBounds(MADRID, "2026-03-29");
  const fin = dayBounds(MADRID, "2026-03-29").end;
  assert.equal((fin - inicio.start) / 3600000, 23);
});

test("parseDateTime acepta hora local y también ISO con zona", () => {
  assert.equal(parseDateTime("2026-07-01T10:00", MADRID), Date.UTC(2026, 6, 1, 8, 0));
  assert.equal(parseDateTime("2026-07-01T08:00:00.000Z", MADRID), Date.UTC(2026, 6, 1, 8, 0));
});

test("parseDateTime rechaza fechas que no existen", () => {
  assert.throws(() => parseDateTime("2026-02-31T10:00", MADRID));
  assert.throws(() => parseDateTime("2026-03-29T02:30", MADRID), /no existen/);
  assert.throws(() => parseDateTime("ayer", MADRID));
});

test("parseDate valida el calendario", () => {
  assert.deepEqual(parseDate("2026-10-18"), { y: 2026, mo: 10, d: 18 });
  assert.throws(() => parseDate("2026-02-30"));
  assert.throws(() => parseDate("18/10/2026"));
});

test("localParts devuelve la hora de la zona, no la de UTC", () => {
  const p = localParts(MADRID, Date.UTC(2026, 6, 1, 8, 0));
  assert.deepEqual([p.y, p.mo, p.d, p.h, p.mi], [2026, 7, 1, 10, 0]);
});
