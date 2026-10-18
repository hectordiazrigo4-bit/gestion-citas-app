import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeLike, parseIntegerInRange, requireText, optionalText } from "../src/http.js";

test("escapeLike neutraliza los comodines % y _ y la barra invertida", () => {
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
  assert.equal(escapeLike("normal"), "normal");
});

test("parseIntegerInRange acepta enteros dentro de rango y rechaza el resto", () => {
  assert.equal(parseIntegerInRange("30", "duración", 5, 720), 30);
  assert.equal(parseIntegerInRange(5, "duración", 5, 720), 5);
  assert.throws(() => parseIntegerInRange("2", "duración", 5, 720));
  assert.throws(() => parseIntegerInRange("30.5", "duración", 5, 720));
  assert.throws(() => parseIntegerInRange("abc", "duración", 5, 720));
});

test("requireText recorta espacios y rechaza vacíos o demasiado largos", () => {
  assert.equal(requireText("  Ana  ", "nombre", 10), "Ana");
  assert.throws(() => requireText("   ", "nombre", 10));
  assert.throws(() => requireText("x".repeat(11), "nombre", 10));
});

test("optionalText devuelve null cuando el campo está vacío", () => {
  assert.equal(optionalText("", "notas", 10), null);
  assert.equal(optionalText(undefined, "notas", 10), null);
  assert.equal(optionalText("  nota  ", "notas", 10), "nota");
});
