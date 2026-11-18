import { useEffect } from 'react';

import { useShop } from '@/api/queries/assessment';
import type { ShopOut } from '@/api/types';
import { usePrefs, type AccentPreference } from '@/state/prefs';

/** The shop's app themes (docs/16 E17) and the accent hue each one gives the app. */
export const THEME_ACCENT: Readonly<Record<string, Exclude<AccentPreference, 'default'>>> = {
  'theme.samarkand': 'lagoon',
  'theme.chorsu': 'orange',
  'theme.night_tashkent': 'purple',
};

/** The accent the server's equipped theme asks for; null while the shop has not been loaded. */
export function accentFromShop(shop: Pick<ShopOut, 'items'> | undefined): AccentPreference | null {
  if (!shop) return null;
  const equipped = shop.items.find((i) => i.kind === 'theme' && i.equipped);
  return (equipped && THEME_ACCENT[equipped.id]) ?? 'default';
}

/**
 * Keeps the device's accent preference in step with the theme equipped on the server (the
 * record). The preference is only a copy, so the chosen theme also applies at start-up and
 * offline; with no shop data (signed out, unreachable, an older server) it is left as it is.
 */
export function useCosmeticSync(): void {
  const shop = useShop();
  const accent = accentFromShop(shop.data);
  useEffect(() => {
    if (accent === null) return;
    const prefs = usePrefs.getState();
    if (prefs.accent !== accent) prefs.set({ accent });
  }, [accent]);
}
