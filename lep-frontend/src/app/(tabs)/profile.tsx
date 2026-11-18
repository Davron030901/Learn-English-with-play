import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { session } from '@/api/client';
import { serverHasLeagues, useLeagueStatus } from '@/api/queries/leagues';
import { useMe } from '@/api/queries/me';
import {
  Avatar,
  Button,
  Card,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  Txt,
  type IconName,
} from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { useTierName } from '@/features/leagues/LeagueScreen';
import { icuLocale } from '@/i18n';
import { log } from '@/lib/log';
import { usePrefs } from '@/state/prefs';

const SETTINGS_PAGES: readonly { page: string; icon: IconName; label: string }[] = [
  { page: 'learning', icon: 'target', label: 'me.learning' },
  { page: 'display', icon: 'sliders', label: 'me.display' },
  { page: 'accessibility', icon: 'eye', label: 'me.accessibility' },
  { page: 'audio', icon: 'speaker', label: 'me.audio' },
  { page: 'reminders', icon: 'bell', label: 'me.reminders' },
  { page: 'privacy', icon: 'shield', label: 'me.privacy' },
  { page: 'about', icon: 'info', label: 'me.about' },
];

/**
 * Me: the account as the server describes it (GET /v1/me — read-only until the server offers
 * PATCH), the settings, and signing out. `is_minor` is only ever read from the live response
 * (brief §4.1): it changes copy here and is never stored.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const language = usePrefs((s) => s.interfaceLanguage);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await session.signOut('user');
    } catch (e) {
      // Signing out always succeeds locally; a failed server call only means the token expires on its own.
      log.warn('auth.sign_out_failed', e);
    } finally {
      setSigningOut(false);
    }
  };

  const d = me.data;
  // leagues are never offered to a learner who might be under 18 (docs/10 §8.8)
  const leaguesOffered = serverHasLeagues && d !== undefined && !d.is_minor;
  const leagues = useLeagueStatus(leaguesOffered);
  const tierName = useTierName();
  const leaguesSub = leagues.data?.result
    ? t('leagues.rowResult')
    : leagues.data?.opted_in
      ? t('leagues.rowOn', { tier: tierName(leagues.data.tier) })
      : t('leagues.rowOff');
  const since = d
    ? new Intl.DateTimeFormat(icuLocale(language), { year: 'numeric', month: 'long' }).format(
        new Date(d.created_at),
      )
    : null;

  return (
    <Screen edges={['top']} testID="profile">
      <Txt variant="display-m" accessibilityRole="header">
        {t('me.title')}
      </Txt>

      {d ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={d.email} size="lg" />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="title-s" numberOfLines={1} testID="me-email">
                {d.email}
              </Txt>
              {since ? (
                <Txt variant="body-s" color="ink-3">
                  {t('me.memberSince', { date: since })}
                </Txt>
              ) : null}
            </View>
          </View>
          <View style={{ gap: 0 }}>
            <ListRow title={t('me.l1')} value={t(`languages.${d.l1}`, { defaultValue: d.l1 })} />
            <ListRow title={t('me.goal')} value={t('me.goalValue', { count: d.daily_goal_min })} />
            <ListRow
              title={t('me.spelling')}
              value={
                d.settings.spelling_variant === 'uk' ? t('onboarding.l1.uk') : t('onboarding.l1.us')
              }
            />
            <ListRow title={t('me.timezone')} value={d.tz} />
          </View>
          <Txt variant="caption" color="ink-3">
            {t('settings.serverOwned')}
          </Txt>
        </Card>
      ) : me.error ? (
        <ProblemNotice problem={asProblem(me.error)} onRetry={() => void me.refetch()} />
      ) : (
        <Txt color="ink-3">{t('me.loadingProfile')}</Txt>
      )}

      {d?.is_minor ? <Notice icon="shield">{t('me.minorNote')}</Notice> : null}

      <Card padded={false}>
        <ListRow
          icon="gem"
          iconTone="color"
          title={t('shop.profileRow')}
          sub={t('shop.profileRowSub')}
          chevron
          onPress={() => router.push('/shop')}
          testID="profile-shop"
        />
        <ListRow
          icon="target"
          title={t('placementCheck.profileRow')}
          sub={t('placementCheck.profileRowSub')}
          chevron
          onPress={() => router.push('/placement')}
          testID="profile-placement"
        />
        {leaguesOffered ? (
          <ListRow
            icon="trophy"
            title={t('leagues.title')}
            sub={leaguesSub}
            chevron
            onPress={() => router.push('/leagues')}
            testID="profile-leagues"
          />
        ) : null}
      </Card>

      <View style={{ gap: 10 }}>
        <SectionTitle>{t('me.settings')}</SectionTitle>
        <Card padded={false}>
          {SETTINGS_PAGES.map((p) => (
            <ListRow
              key={p.page}
              icon={p.icon}
              title={t(p.label)}
              chevron
              onPress={() =>
                router.push({ pathname: '/settings/[page]', params: { page: p.page } })
              }
              testID={`settings-${p.page}`}
            />
          ))}
        </Card>
      </View>

      <Button
        variant="secondary"
        block
        icon="arrow-right"
        busy={signingOut}
        onPress={() => void signOut()}
        testID="sign-out"
      >
        {signingOut ? t('me.signingOut') : t('me.signOut')}
      </Button>
    </Screen>
  );
}
