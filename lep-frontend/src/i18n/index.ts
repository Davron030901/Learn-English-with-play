import './polyfills';

import { createInstance } from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ru from './locales/ru.json';
import uz from './locales/uz.json';
import { pseudoize } from './pseudo';

/**
 * Interface language — a setting of its own, separate from the learner's L1 (brief §14,
 * DECISIONS F5). English by default; Uzbek and Russian ship now (machine-drafted, flagged for a
 * native reviewer in DECISIONS); the pseudo-locales exist for layout testing. Every count string
 * is ICU (Uzbek and Russian plurals are not `n === 1`).
 */
export const INTERFACE_LANGUAGES = ['en', 'uz', 'ru'] as const;
export const TEST_LANGUAGES = ['pseudo', 'pseudo-rtl'] as const;
export type InterfaceLanguage =
  (typeof INTERFACE_LANGUAGES)[number] | (typeof TEST_LANGUAGES)[number];

export const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'fa', 'he', 'ur', 'pseudo-rtl']);

type Tree = { [k: string]: string | Tree };

/** The shipped catalogues. The test locales are built from English when one is chosen. */
export const resources = {
  en: { translation: en },
  uz: { translation: uz },
  ru: { translation: ru },
} as const;

const isTestLanguage = (lng: string): lng is (typeof TEST_LANGUAGES)[number] =>
  (TEST_LANGUAGES as readonly string[]).includes(lng);

/** One instance for the app, created here rather than i18next's global default. */
const i18n = createInstance();
let initialised = false;

/**
 * i18next-icu runs every message through the ICU parser, the plain ones too — at start-up that
 * was about a tenth of a second of parsing for strings with nothing to format (DECISIONS §28). A
 * message without `{` has no argument, plural or select, and the catalogues use no ICU quoting,
 * so it is returned as it is.
 */
type Parse = (res: unknown, ...rest: unknown[]) => unknown;
function fastIcu() {
  const icu = new ICU() as unknown as { parse: Parse };
  const parse = icu.parse.bind(icu);
  icu.parse = (res, ...rest) =>
    typeof res === 'string' && !res.includes('{') ? res : parse(res, ...rest);
  return icu as unknown as InstanceType<typeof ICU>;
}

/** Builds a test locale the first time it is wanted — never for a learner who does not pick one. */
export function loadLanguage(lng: string): void {
  if (isTestLanguage(lng) && !i18n.hasResourceBundle(lng, 'translation')) {
    i18n.addResourceBundle(lng, 'translation', pseudoize(en as Tree, lng === 'pseudo-rtl'));
  }
}

export function initI18n(lng: InterfaceLanguage = 'en') {
  if (!initialised) {
    initialised = true;
    const first = isTestLanguage(lng)
      ? { ...resources, [lng]: { translation: pseudoize(en as Tree, lng === 'pseudo-rtl') } }
      : resources;
    void i18n
      .use(fastIcu())
      .use(initReactI18next)
      .init({
        resources: first,
        lng,
        fallbackLng: 'en',
        interpolation: { escapeValue: false },
        returnNull: false,
        initAsync: false,
        // `pseudo-rtl` is no BCP 47 tag: given it, the formatter threw and every string with a
        // placeholder showed its raw ICU text (seen in the A14 screenshots, DECISIONS §27)
        i18nFormat: { parseLngForICU: icuLocale },
      });
  } else if (i18n.language !== lng) {
    loadLanguage(lng);
    void i18n.changeLanguage(lng);
  }
  return i18n;
}

/** The ICU locale for plurals and formatting: the pseudo-locales follow English. */
export function icuLocale(lng: string): string {
  return lng.startsWith('pseudo') ? 'en' : lng;
}

export { i18n };
