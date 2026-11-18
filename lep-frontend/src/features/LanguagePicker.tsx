import { useTranslation } from 'react-i18next';

import { Segmented } from '@/design';
import { INTERFACE_LANGUAGES, TEST_LANGUAGES, type InterfaceLanguage } from '@/i18n';
import { usePrefs } from '@/state/prefs';

/** The interface-language setting (separate from L1 — brief §14). */
export function LanguagePicker({ testID }: { testID?: string }) {
  const { t } = useTranslation();
  const value = usePrefs((s) => s.interfaceLanguage);
  const showTest = usePrefs((s) => s.showTestLanguages);
  const set = usePrefs((s) => s.set);
  const langs: InterfaceLanguage[] = [...INTERFACE_LANGUAGES, ...(showTest ? TEST_LANGUAGES : [])];
  return (
    <Segmented
      testID={testID}
      label={t('welcome.interfaceLanguage')}
      value={value}
      onChange={(v) => set({ interfaceLanguage: v, languageChosen: true })}
      options={langs.map((l) => ({ value: l, label: t(`languages.${l}`) }))}
    />
  );
}
