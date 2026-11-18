import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, ChoiceCard, Notice, Switch, Txt } from '@/design';
import { OnboardingStep } from '@/features/onboarding/OnboardingStep';
import { clampToAllowed, remindersSupported } from '@/notifications/reminders';
import { useOnboarding, type OnboardingDraft } from '@/state/onboarding';

type Cue = NonNullable<OnboardingDraft['plan']>['cue'];
const CUES: readonly { cue: Cue; hour: number; minute: number }[] = [
  { cue: 'afterBreakfast', hour: 8, minute: 30 },
  { cue: 'commute', hour: 8, minute: 15 },
  { cue: 'lunch', hour: 13, minute: 0 },
  { cue: 'work', hour: 18, minute: 0 },
  { cue: 'dinner', hour: 19, minute: 30 },
];

export const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Step 6 — an implementation intention (docs/07 §4.2): a cue, a time, and a reminder at that
 * exact time with the learner's own cue in it. Times inside quiet hours cannot be chosen.
 */
export default function Plan() {
  const { t } = useTranslation();
  const plan = useOnboarding((s) => s.plan);
  const set = useOnboarding((s) => s.set);
  useEffect(() => {
    if (!plan) set({ plan: { cue: 'dinner', hour: 19, minute: 30, remind: remindersSupported } });
  }, [plan, set]);
  if (!plan) return null;
  const shift = (mins: number) => {
    const total = plan.hour * 60 + plan.minute + mins;
    const next = clampToAllowed(Math.floor(total / 60), ((total % 60) + 60) % 60);
    set({ plan: { ...plan, ...next } });
  };
  const time = `${pad2(plan.hour)}:${pad2(plan.minute)}`;
  return (
    <OnboardingStep
      step={6}
      testID="onboarding-plan"
      title={t('onboarding.plan.title')}
      body={t('onboarding.plan.body')}
      onContinue={() => router.push('/onboarding/expectations')}
    >
      <Txt variant="title-s">{t('onboarding.plan.after')}</Txt>
      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        {CUES.map((c) => (
          <ChoiceCard
            key={c.cue}
            font="ui"
            state={plan.cue === c.cue ? 'selected' : 'idle'}
            onPress={() => set({ plan: { ...plan, cue: c.cue, hour: c.hour, minute: c.minute } })}
            testID={`cue-${c.cue}`}
          >
            {t(`onboarding.plan.${c.cue}`)}
          </ChoiceCard>
        ))}
      </View>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Button variant="secondary" size="sm" icon="chevron-left" onPress={() => shift(-15)} accessibilityLabel={t('onboarding.plan.earlier')}>
            {t('onboarding.plan.earlier')}
          </Button>
          <Txt variant="stat" accessibilityLabel={`${t('onboarding.plan.at')} ${time}`} testID="plan-time">
            {time}
          </Txt>
          <Button variant="secondary" size="sm" iconRight="chevron-right" onPress={() => shift(15)} accessibilityLabel={t('onboarding.plan.later')}>
            {t('onboarding.plan.later')}
          </Button>
        </View>
        <Txt variant="caption" color="ink-3">
          {t('onboarding.plan.quietNote')}
        </Txt>
      </Card>
      {remindersSupported ? (
        <Switch label={t('onboarding.plan.remindMe')} sub={t('onboarding.plan.reminderText', { cue: t(`onboarding.plan.${plan.cue}`) })} value={plan.remind} onValueChange={(v) => set({ plan: { ...plan, remind: v } })} />
      ) : (
        <Notice icon="bell">{t('onboarding.plan.webNote')}</Notice>
      )}
    </OnboardingStep>
  );
}
