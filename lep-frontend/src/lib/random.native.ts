import { getRandomBytes } from 'expo-crypto';

// Hermes has no Web Crypto; expo-crypto reads the platform's secure random source.
export function randomBytes(n: number): Uint8Array {
  return getRandomBytes(n);
}
