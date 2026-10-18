// Utilidades criptográficas con la Web Crypto API nativa (sin dependencias).

const PBKDF2_ITERATIONS = 100000; // máximo admitido por Workers
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePasswordBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, saltB64, hashB64] = String(stored).split("$");
  if (scheme !== "pbkdf2" || !iterations || !saltB64 || !hashB64) return false;
  const hash = await derivePasswordBits(password, fromBase64(saltB64), Number(iterations));
  return constantTimeEqual(hash, fromBase64(hashB64));
}

// Token aleatorio que se entrega al navegador dentro de una cookie HttpOnly.
export function createSessionToken() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

// En la base de datos solo se guarda el SHA-256 del token.
export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function derivePasswordBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
