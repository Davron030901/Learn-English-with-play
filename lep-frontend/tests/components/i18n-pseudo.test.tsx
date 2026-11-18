import en from '@/i18n/locales/en.json';
import { initI18n, loadLanguage } from '@/i18n';

/**
 * The test locales (DECISIONS §8 A14, §27): every string of the catalogue formats in both, with
 * its placeholders filled. `pseudo-rtl` is no BCP 47 tag; given it, the ICU formatter threw and
 * the raw message — `{date}`, mirrored to `{etad}` — reached the screen.
 */

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${prefix}${k}`, v] as [string, string]]
      : leaves(v, `${prefix}${k}.`),
  );
}

const ARG = /\{(\w+)\s*(?:,|\})/g;

test.each(['pseudo', 'pseudo-rtl'] as const)(
  'every message with a placeholder formats in %s',
  (lng) => {
    const i18n = initI18n('en');
    loadLanguage(lng);
    expect(i18n.hasResourceBundle(lng, 'translation')).toBe(true);
    const t = i18n.getFixedT(lng);
    const broken: string[] = [];
    for (const [key, message] of leaves(en as Tree)) {
      const names = [...message.matchAll(ARG)].map((m) => m[1] as string);
      if (!names.length) continue;
      const args = Object.fromEntries(names.map((n) => [n, 2]));
      const out = t(key, args);
      if (names.some((n) => out.includes(`{${n}`))) broken.push(key);
    }
    expect(broken).toEqual([]);
  },
);

test('a plain message skips the ICU parser; one with an argument is still formatted', () => {
  const i18n = initI18n('en');
  expect(i18n.t('common.back')).toBe('Back');
  expect(i18n.t('pronunciation.headline', { value: 74 })).toBe('Pronunciation: 74 out of 100');
  expect(i18n.t('common.minutes', { count: 1 })).not.toContain('{');
});
