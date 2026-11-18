// Cryptographically strong random bytes on web and in Node (tests).
// The native build uses random.native.ts (expo-crypto), because Hermes has no Web Crypto.
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}
