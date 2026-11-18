import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';

import {
  displayNameProblem,
  serverHasLeagues,
  useJoinLeagues,
  useLeagueResultSeen,
  useLeagueStatus,
  useLeaveLeagues,
  useRenameForLeagues,
} from '@/api/queries/leagues';
import { useMe } from '@/api/queries/me';
import type { LeagueResultOut, LeagueRow, LeagueStatusOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import {
  Avatar,
  Button,
  Card,
  Icon,
  ListRow,
  Mascot,
  Notice,
  PendingStat,
  Screen,
  ScreenHeader,
  TextField,
  TextLink,
  Txt,
  radius,
  tone,
  useTheme,
} from '@/design';
import { ProblemNotice, asProblem } from '@/features/errors';
import { icuLocale } from '@/i18n';
import { usePrefs } from '@/state/prefs';

/** The tier's name in the interface language: 1 Clay … 10 Diamond (docs/16 E23). */
export function useTierName() {
  const { t } = useTranslation();
  return (tier: number) => t(`leagues.tier.${tier}`, { defaultValue: String(tier) });
}

function useWeekEnd(iso: string | undefined): string {
  const language = usePrefs((s) => s.interfaceLanguage);
  if (!iso) return '';
  return new Intl.DateTimeFormat(icuLocale(language), {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Leagues (docs/16 E23, docs/10 §6): a weekly XP ladder for the learners who want one. Off until
 * the learner joins, with a display name; never offered to a learner who might be under 18. The
 * explainer says plainly that some people find it stressful. The week ends at the same stated
 * time for everyone, with no countdown, and a finished week's result is shown here once — there
 * is no push about rank or demotion. Leaving is one tap and a neutral confirmation.
 */
export function LeagueScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const status = useLeagueStatus();
  const header = (
    <ScreenHeader title={t('leagues.title')} onBack={onBack} backLabel={t('common.back')} />
  );

  if (!serverHasLeagues) {
    return (
      <Screen header={header} testID="leagues">
        <PendingStat icon="trophy" title={t('leagues.title')} body={t('leagues.unavailable')} />
      </Screen>
    );
  }

  const s = status.data;
  return (
    <Screen header={header} testID="leagues">
      {status.error ? (
        <ProblemNotice problem={asProblem(status.error)} onRetry={() => void status.refetch()} />
      ) : null}
      {!s && !status.error ? <Txt color="ink-3">{t('common.loading')}</Txt> : null}
      {s?.result ? <WeekResult result={s.result} /> : null}
      {s && !s.eligible ? (
        <View testID="leagues-minor">
          <Notice icon="shield">{t('leagues.minor')}</Notice>
        </View>
      ) : null}
      {s && s.eligible && !s.opted_in ? <JoinCard current={me.data?.display_name ?? ''} /> : null}
      {s && s.eligible && s.opted_in ? (
        <League status={s} displayName={me.data?.display_name ?? ''} />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- joining

function JoinCard({ current }: { current: string }) {
  const { t } = useTranslation();
  const join = useJoinLeagues();
  const [name, setName] = useState(current);
  const [touched, setTouched] = useState(false);
  const problem = displayNameProblem(name);
  const fieldError =
    touched && problem
      ? t(problem === 'length' ? 'leagues.nameLength' : 'leagues.nameCharacters')
      : null;
  const submit = () => {
    setTouched(true);
    if (!problem) join.mutate(name);
  };
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="trophy" tone="color" size={36} />
        <Txt variant="title-m" accessibilityRole="header" style={{ flex: 1 }}>
          {t('leagues.explainerTitle')}
        </Txt>
      </View>
      <Txt variant="body-m" testID="leagues-explainer">
        {t('leagues.explainer')}
      </Txt>
      <Txt variant="body-s" color="ink-3">
        {t('leagues.seenBy')}
      </Txt>
      <TextField
        label={t('leagues.nameLabel')}
        hint={t('leagues.nameHint')}
        error={fieldError}
        value={name}
        onChangeText={setName}
        onBlur={() => setTouched(true)}
        autoCapitalize="words"
        autoComplete="off"
        maxLength={40}
        testID="leagues-name"
      />
      {join.error ? (
        <ProblemNotice problem={asProblem(join.error)} onRetry={() => join.reset()} />
      ) : null}
      <Button block icon="trophy" busy={join.isPending} onPress={submit} testID="leagues-join">
        {t('leagues.join')}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------- the week's table

function League({ status, displayName }: { status: LeagueStatusOut; displayName: string }) {
  const { t } = useTranslation();
  const tierName = useTierName();
  const ends = useWeekEnd(status.week_ends_at);
  const league = status.league;
  const mine = league?.members.find((r) => r.you);
  return (
    <>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Icon name="gem" tone="color" size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title-l" accessibilityRole="header" testID="leagues-tier">
              {t('leagues.leagueTitle', { tier: tierName(league?.tier ?? status.tier) })}
            </Txt>
            <Txt variant="body-s" color="ink-3" testID="leagues-week-ends">
              {t('leagues.weekEnds', { when: ends })}
            </Txt>
          </View>
        </View>
        {mine && league ? (
          <Txt variant="body-m" weight={800} testID="leagues-your-place">
            {t('leagues.yourPlace', { rank: mine.rank, members: league.members.length })}
          </Txt>
        ) : null}
      </Card>

      {league ? (
        <View testID="leagues-table">
          <Card padded={false}>
            {league.members.map((row, i) => (
              <Place key={row.rank} row={row} previous={league.members[i - 1]} />
            ))}
          </Card>
        </View>
      ) : (
        <View testID="leagues-no-group">
          <Notice icon="users">{t('leagues.noGroupYet')}</Notice>
        </View>
      )}

      <Txt variant="caption" color="ink-3" align="center">
        {t('leagues.countsOnly')}
      </Txt>

      <NameRow current={displayName} />
      <LeaveLink />
    </>
  );
}

function Place({ row, previous }: { row: LeagueRow; previous: LeagueRow | undefined }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const band =
    row.zone === 'up' ? tone(theme, 'green') : row.zone === 'down' ? tone(theme, 'orange') : null;
  const name = row.display_name ?? t('leagues.unnamed');
  const label = t(
    row.zone === 'up'
      ? 'leagues.rowLabelUp'
      : row.zone === 'down'
        ? 'leagues.rowLabelDown'
        : 'leagues.rowLabel',
    { rank: row.rank, name: row.you ? `${name} (${t('leagues.you')})` : name, xp: row.weekly_xp },
  );
  const bandStarts = row.zone && row.zone !== previous?.zone;
  return (
    <View>
      {bandStarts && band ? (
        <View style={{ backgroundColor: band.soft, paddingHorizontal: 16, paddingTop: 8 }}>
          <Txt variant="caption" weight={800} style={{ color: band.ink }}>
            {t(row.zone === 'up' ? 'leagues.movesUp' : 'leagues.movesDown')}
          </Txt>
        </View>
      ) : null}
      <View
        accessible
        accessibilityLabel={label}
        testID={`leagues-row-${row.rank}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: band ? band.soft : undefined,
          borderWidth: row.you ? 2 : 0,
          borderColor: theme.c.primary,
          borderRadius: row.you ? radius.md : 0,
        }}
      >
        <Txt variant="body-m" weight={800} style={{ width: 26, textAlign: 'right' }}>
          {String(row.rank)}
        </Txt>
        <Avatar name={name} size="sm" />
        <Txt variant="body-m" weight={row.you ? 800 : 600} numberOfLines={1} style={{ flex: 1 }}>
          {row.you ? `${name} · ${t('leagues.you')}` : name}
        </Txt>
        <Txt variant="body-m" weight={800} color="ink-2">
          {t('leagues.xp', { xp: row.weekly_xp })}
        </Txt>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- the name, and leaving

function NameRow({ current }: { current: string }) {
  const { t } = useTranslation();
  const rename = useRenameForLeagues();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current);
  const problem = displayNameProblem(name);
  if (!editing) {
    return (
      <Card padded={false}>
        <ListRow
          icon="user"
          title={t('leagues.nameRow')}
          sub={current}
          onPress={() => {
            setName(current);
            setEditing(true);
          }}
          testID="leagues-name-row"
        />
      </Card>
    );
  }
  return (
    <Card>
      <TextField
        label={t('leagues.nameLabel')}
        hint={t('leagues.nameHint')}
        error={
          problem ? t(problem === 'length' ? 'leagues.nameLength' : 'leagues.nameCharacters') : null
        }
        value={name}
        onChangeText={setName}
        autoComplete="off"
        maxLength={40}
        testID="leagues-rename"
      />
      {rename.error ? (
        <ProblemNotice problem={asProblem(rename.error)} onRetry={() => rename.reset()} />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => {
            rename.reset();
            setEditing(false);
          }}
        >
          {t('leagues.cancel')}
        </Button>
        <Button
          style={{ flex: 1 }}
          disabled={problem !== null}
          busy={rename.isPending}
          onPress={() => rename.mutate(name, { onSuccess: () => setEditing(false) })}
          testID="leagues-rename-save"
        >
          {t('leagues.saveName')}
        </Button>
      </View>
    </Card>
  );
}

function LeaveLink() {
  const { t } = useTranslation();
  const theme = useTheme();
  const leave = useLeaveLeagues();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <View style={{ alignItems: 'center' }}>
        <TextLink onPress={() => setAsking(true)} testID="leagues-leave">
          {t('leagues.leave')}
        </TextLink>
      </View>
      {leave.error ? (
        <ProblemNotice problem={asProblem(leave.error)} onRetry={() => leave.reset()} />
      ) : null}
      {asking ? (
        <Modal
          transparent
          visible
          animationType={theme.reduceMotion ? 'none' : 'fade'}
          onRequestClose={() => setAsking(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: theme.c.scrim,
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <View
              accessibilityViewIsModal
              testID="leagues-leave-confirm"
              style={{
                width: '100%',
                maxWidth: 400,
                alignSelf: 'center',
                backgroundColor: theme.c.surface,
                borderRadius: radius.xl,
                padding: 22,
                gap: 14,
              }}
            >
              <Txt variant="title-l" accessibilityRole="header">
                {t('leagues.leaveTitle')}
              </Txt>
              <Txt variant="body-m" color="ink-2">
                {t('leagues.leaveBody')}
              </Txt>
              <Button
                block
                variant="secondary"
                busy={leave.isPending}
                onPress={() => leave.mutate(undefined, { onSettled: () => setAsking(false) })}
                testID="leagues-leave-yes"
              >
                {t('leagues.leaveConfirm')}
              </Button>
              <Button block variant="ghost" onPress={() => setAsking(false)}>
                {t('leagues.stay')}
              </Button>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- last week's result

/**
 * Shown once, on the next visit after the week ended. Pip is happy or cheering, never sad; moving
 * down is said as plainly as the tier next week.
 */
function WeekResult({ result }: { result: LeagueResultOut }) {
  const { t } = useTranslation();
  const tierName = useTierName();
  const seen = useLeagueResultSeen();
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    if (result.moved > 0) sfx('promote');
  }, [result.moved]);
  const tier = tierName(result.tier_after);
  const headline =
    result.moved > 0
      ? t('leagues.resultUp', { tier })
      : result.moved < 0
        ? t('leagues.resultDown', { tier })
        : t('leagues.resultStay', { tier });
  return (
    <View testID="leagues-result">
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Mascot pose={result.moved > 0 ? 'cheer' : 'happy'} size={72} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="title-m" accessibilityRole="header" testID="leagues-result-headline">
              {headline}
            </Txt>
            <Txt variant="body-s" color="ink-3">
              {t('leagues.resultPlace', {
                rank: result.rank,
                members: result.members,
                xp: result.weekly_xp,
              })}
            </Txt>
          </View>
        </View>
        <Button
          block
          variant="secondary"
          busy={seen.isPending}
          onPress={() => seen.mutate()}
          testID="leagues-result-ok"
        >
          {t('leagues.resultOk')}
        </Button>
      </Card>
    </View>
  );
}
