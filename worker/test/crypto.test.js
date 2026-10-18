import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, createSessionToken, hashToken } from "../src/crypto.js";

test("la contraseña se verifica correctamente y rechaza otra", async () => {
  const stored = await hashPassword("contraseña-segura-1");
  assert.equal(await verifyPassword("contraseña-segura-1", stored), true);
  assert.equal(await verifyPassword("contraseña-incorrecta", stored), false);
});

test("dos hashes de la misma contraseña son distintos (sal aleatoria)", async () => {
  const a = await hashPassword("contraseña-segura-1");
  const b = await hashPassword("contraseña-segura-1");
  assert.notEqual(a, b);
});

test("un hash mal formado no verifica y no lanza error", async () => {
  assert.equal(await verifyPassword("x", "texto-raro"), false);
});

test("los tokens de sesión son únicos y su hash es determinista", async () => {
  const t1 = createSessionToken();
  const t2 = createSessionToken();
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await hashToken(t1), await hashToken(t1));
  assert.match(await hashToken(t1), /^[0-9a-f]{64}$/);
});
