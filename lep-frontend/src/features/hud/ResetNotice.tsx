import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useEquippedOutfit } from '@/api/queries/assessment';
import { useAcknowledgeReset } from '@/api/queries/gamification';
import { Button, Txt, radius, useTheme } from '@/design';
import { DressedPip } from '@/design/Outfits';
import { usePrefs } from '@/state/prefs';

import { resetDays } from './format';

/**
 * The server's kind reset message (docs/10 §5, docs/16 E03 §3), shown once: the moment it is on
 * screen the server is told it was seen, and the card stays until the learner closes it. English
 * shows the server's exact words; Uzbek and Russian show the same sentence translated, with the
 * server's number. Pip waves — there is no sad Pip.
 */
export function ResetNotice({ message }: { message: string | null }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const lang = usePrefs((s) => s.interfaceLanguage);
  const outfit = useEquippedOutfit();
  const { mutate: acknowledge } = useAcknowledgeReset();
  // The message stays on screen after the server stops sending it (it was acknowledged) until
  // the learner closes it: kept in state, taken from the prop when a new one arrives.
  const [kept, setKept] = useState<{ message: string; closed: boolean } | null>(null);
  if (message && message !== kept?.message) setKept({ message, closed: false });
  const acked = useRef<string | null>(null);

  useEffect(() => {
    if (!message || acked.current === message) return;
    acked.current = message;
    acknowledge(undefined, { onError: () => undefined });
  }, [message, acknowledge]);

  const shown = kept && !kept.closed ? kept.message : null;
  if (!shown) return null;
  const days = resetDays(shown);
  const text = lang === 'en' || days === null ? shown : t('hud.reset.body', { count: days });
  return (
    <View
      testID="reset-notice"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: theme.c['primary-soft'], alignItems: 'center' }}
    >
      <DressedPip outfit={outfit} pose="wave" size={56} />
      <View style={{ flex: 1, gap: 10 }}>
        <Txt variant="body-s" weight={700} color="ink">
          {text}
        </Txt>
        <View style={{ alignSelf: 'flex-start' }}>
          <Button size="sm" onPress={() => setKept((k) => (k ? { ...k, closed: true } : k))} testID="reset-ok">
            {t('hud.reset.ok')}
          </Button>
        </View>
      </View>
    </View>
  );
}
