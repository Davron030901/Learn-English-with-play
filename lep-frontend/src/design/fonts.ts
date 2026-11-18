import { Andika_400Regular, Andika_700Bold } from '@expo-google-fonts/andika';
import {
  Lexend_400Regular,
  Lexend_600SemiBold,
  Lexend_700Bold,
  Lexend_800ExtraBold,
  Lexend_900Black,
} from '@expo-google-fonts/lexend';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
} from '@expo-google-fonts/nunito';

/**
 * Nunito for the interface, Andika for English being taught (brief §13: the switch is semantic,
 * not decorative), Lexend as the easier-to-read interface option (brief §12). React Native needs
 * one family name per weight, so a weight maps to the nearest file that exists.
 */
export const FONT_FILES = {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  Andika_400Regular,
  Andika_700Bold,
  Lexend_400Regular,
  Lexend_600SemiBold,
  Lexend_700Bold,
  Lexend_800ExtraBold,
  Lexend_900Black,
};

export type FontRole = 'ui' | 'learn';
export type UiFace = 'nunito' | 'lexend';

const NUNITO: Record<number, string> = {
  400: 'Nunito_400Regular',
  600: 'Nunito_600SemiBold',
  700: 'Nunito_700Bold',
  800: 'Nunito_800ExtraBold',
  900: 'Nunito_900Black',
};
const LEXEND: Record<number, string> = {
  400: 'Lexend_400Regular',
  600: 'Lexend_600SemiBold',
  700: 'Lexend_700Bold',
  800: 'Lexend_800ExtraBold',
  900: 'Lexend_900Black',
};
const ANDIKA: Record<number, string> = { 400: 'Andika_400Regular', 700: 'Andika_700Bold' };

function nearest(table: Record<number, string>, weight: number): string {
  const weights = Object.keys(table).map(Number);
  let best = weights[0] as number;
  for (const w of weights) if (Math.abs(w - weight) < Math.abs(best - weight)) best = w;
  return table[best] as string;
}

export function fontFamily(role: FontRole, weight: number, face: UiFace): string {
  if (role === 'learn') return nearest(ANDIKA, weight >= 600 ? 700 : 400);
  return nearest(face === 'lexend' ? LEXEND : NUNITO, weight);
}
