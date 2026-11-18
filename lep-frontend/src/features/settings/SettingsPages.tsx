import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, View, type PressableStateCallbackType } from 'react-native';

import type { AccessibilityProfile } from '@/a11y/profile';
import { api, unwrap } from '@/api/client';
import { API_BASE_URL } from '@/api/config';
import { apiVersion } from '@/api/paths.generated';
import {
  keepsA11yProfile,
  saveA11yProfile,
  serverHasSettings,
  useGamificationSummary,
  useUpdateSettings,
} from '@/api/queries/gamification';
import {
  fetchAccountExport,
  serverHasAccountDelete,
  serverHasAccountExport,
  serverHasRecordingsDelete,
  useAuthStatus,
  useDeleteAccount,
  useDeleteRecordings,
  useMe,
} from '@/api/queries/me';
import { serverHasLeagues } from '@/api/queries/leagues';
import { ApiError } from '@/api/problem';
import type { SettingsPatch } from '@/api/types';
import { releaseSfx } from '@/audio/sfx';
import { hasEnglishVoice } from '@/audio/speech';
import { content, useCourse } from '@/content/queries';
import { contentVersion } from '@/content/version.generated';
import {
  Button,
  Card,
  Chip,
  Icon,
  ListRow,
  Notice,
  SectionTitle,
  Segmented,
  Switch,
  TextField,
  TextLink,
  Txt,
  radius,
  useTheme,
} from '@/design';
import { ProblemNotice, RequestId, asProblem } from '@/features/errors';
import { LanguagePicker } from '@/features/LanguagePicker';
import { weekdayName } from '@/features/progress/serverState';
import { log } from '@/lib/log';
import {
  QUIET_FROM_HOUR,
  QUIET_TO_HOUR,
  applyReminders,
  cancelReminders,
  clampToAllowed,
  remindersSupported,
  type ScheduleResult,
} from '@/notifications/reminders';
import { useOutboxRows } from '@/outbox';
import { useLearner } from '@/state/learner';
import { isOnline, useOnlineStore } from '@/state/online';
import { usePrefs, type ReminderPrefs, type Speed, type TimerPreference } from '@/state/prefs';

import { ChangePassword } from './ChangePassword';
import { buildExport, deleteEverythingOnDevice, saveExport, type AccountCopy } from './deviceData';

export const SETTINGS_PAGES = [
  'learning',
  'display',
  'accessibility',
  'audio',
  'reminders',
  'privacy',
  'about',
] as const;
export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

export function isSettingsPage(x: string): x is SettingsPageId {
  return (SETTINGS_PAGES as readonly string[]).includes(x);
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

// ---------------------------------------------------------------- Learning
const GOALS = [5, 10, 20, 40] as const;
/** docs/08 §6 presets: the share of words you still recall when they come back for review. */
const RETENTION = [
  { value: 0.85, key: 'relaxed' },
  { value: 0.9, key: 'balanced' },
  { value: 0.94, key: 'thorough' },
] as const;
type Goal = (typeof GOALS)[number];
const isGoal = (v: number): v is Goal => (GOALS as readonly number[]).includes(v);
const MAX_REST_DAYS = 2;
const WEEK = [1, 2, 3, 4, 5, 6, 7] as const;

type FocusState = PressableStateCallbackType & { focused?: boolean };

/** The preset a stored retention belongs to (the server stores one of the three values). */
function retentionPreset(r: number): number {
  let best: number = RETENTION[1].value;
  for (const x of RETENTION) if (Math.abs(x.value - r) < Math.abs(best - r)) best = x.value;
  return best;
}

/**
 * While a change is on its way (and once the server has accepted it) a control shows the value
 * sent; after a failure it shows the server's value again, which never changed.
 */
function shown<T>(
  change: { isPending: boolean; isSuccess: boolean; variables: SettingsPatch | undefined },
  pick: (p: SettingsPatch) => T | null | undefined,
  server: T | undefined,
): T | undefined {
  if (change.isPending || change.isSuccess) {
    const sent = change.variables ? pick(change.variables) : undefined;
    if (sent !== undefined && sent !== null) return sent;
  }
  return server;
}

function DayToggle({
  iso,
  on,
  disabled,
  onPress,
}: {
  iso: number;
  on: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const language = usePrefs((s) => s.interfaceLanguage);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={weekdayName(iso, language)}
      hitSlop={4}
      testID={`rest-day-${iso}`}
      style={(s: FocusState) => ({
        flexGrow: 1,
        flexBasis: 40,
        minWidth: 40,
        minHeight: 48,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        backgroundColor: on ? theme.c['purple-soft'] : theme.c['bg-soft'],
        borderWidth: 2,
        borderColor: on ? theme.c['purple-ink'] : 'transparent',
        opacity: disabled && !on ? 0.6 : s.pressed ? 0.75 : 1,
        boxShadow: s.focused ? theme.focusRing : 'none',
      })}
    >
      <Txt
        variant="caption"
        weight={800}
        rawColor={on ? theme.c['purple-ink'] : theme.c['ink-2']}
        style={{ fontSize: 13 }}
      >
        {weekdayName(iso, language, 'short')}
      </Txt>
      {on ? <Icon name="moon" size={14} color={theme.c['purple-ink']} /> : null}
    </Pressable>
  );
}

function RetentionOption({
  label,
  help,
  on,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  help: string;
  on: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={`${label}. ${help}`}
      testID={testID}
      style={(s: FocusState) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: on ? theme.c.primary : theme.c.line,
        backgroundColor: on ? theme.c['primary-soft'] : theme.c.surface,
        opacity: disabled && !on ? 0.6 : s.pressed ? 0.8 : 1,
        boxShadow: s.focused ? theme.focusRing : 'none',
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.full,
          borderWidth: 2,
          borderColor: on ? theme.c.primary : theme.c['line-2'],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: radius.full,
              backgroundColor: theme.c.primary,
            }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="body-m" weight={800} rawColor={on ? theme.c['primary-ink'] : theme.c.ink}>
          {label}
        </Txt>
        <Txt variant="body-s" color="ink-2">
          {help}
        </Txt>
      </View>
    </Pressable>
  );
}

/**
 * Learning settings (docs/16 E03, docs/08 §6). The daily goal, rest days and how thoroughly to
 * review are the account's: shown from the server and changed with PATCH /v1/me/settings; a
 * failed change says so kindly and leaves everything as it was. Celebrations and the start point
 * on the path belong to this device.
 */
function LearningSettings() {
  const { t } = useTranslation();
  const me = useMe();
  const summary = useGamificationSummary();
  const course = useCourse();
  const online = useOnlineStore(isOnline);
  const celebrations = usePrefs((s) => s.celebrations);
  const setPrefs = usePrefs((s) => s.set);
  const startSection = useLearner((s) => s.data.startSection);
  const update = useLearner((s) => s.update);
  const goalChange = useUpdateSettings();
  const restChange = useUpdateSettings();
  const retentionChange = useUpdateSettings();
  const [restLimit, setRestLimit] = useState(false);
  const d = me.data;

  const editable = serverHasSettings && online && d !== undefined;
  const goal = shown(
    goalChange,
    (p) => p.daily_goal_min,
    summary.data?.goal.goal_min ?? d?.daily_goal_min,
  );
  const restDays =
    shown(
      restChange,
      (p) => p.rest_days,
      summary.data?.streak.rest_days ?? d?.settings.rest_days,
    ) ?? [];
  const retentionValue = shown(
    retentionChange,
    (p) => p.desired_retention,
    d?.settings.desired_retention,
  );
  const retention = retentionValue === undefined ? undefined : retentionPreset(retentionValue);
  const changes = [goalChange, restChange, retentionChange];
  const saving = changes.some((m) => m.isPending);
  const failed = goalChange.error ?? restChange.error ?? retentionChange.error;
  const saved = !saving && !failed && changes.some((m) => m.isSuccess);

  const toggleRest = (iso: number) => {
    if (!editable || restChange.isPending) return;
    const has = restDays.includes(iso);
    if (!has && restDays.length >= MAX_REST_DAYS) {
      setRestLimit(true);
      return;
    }
    setRestLimit(false);
    restChange.mutate({
      rest_days: (has ? restDays.filter((x) => x !== iso) : [...restDays, iso]).sort(
        (a, b) => a - b,
      ),
    });
  };

  return (
    <>
      {d && !serverHasSettings ? (
        <Notice icon="info">{t('learningSettings.unavailable')}</Notice>
      ) : d && !online ? (
        <Notice icon="info" tone="orange">
          {t('learningSettings.offline')}
        </Notice>
      ) : null}

      {d ? (
        <>
          <Card>
            <Segmented
              label={t('learningSettings.goalTitle')}
              value={goal ?? 0}
              onChange={(v) => {
                if (editable && !goalChange.isPending && v !== goal && isGoal(v))
                  goalChange.mutate({ daily_goal_min: v });
              }}
              options={GOALS.map((g) => ({
                value: g,
                label: t('learningSettings.goalOption', { count: g }),
              }))}
              testID="daily-goal"
            />
            <Txt variant="caption" color="ink-3">
              {t('learningSettings.goalHelp')}
            </Txt>
          </Card>

          <Card>
            <Txt variant="body-m" weight={800}>
              {t('learningSettings.restTitle')}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID="rest-days">
              {WEEK.map((iso) => (
                <DayToggle
                  key={iso}
                  iso={iso}
                  on={restDays.includes(iso)}
                  disabled={!editable}
                  onPress={() => toggleRest(iso)}
                />
              ))}
            </View>
            {restLimit ? (
              <Txt
                variant="body-s"
                color="ink-2"
                accessibilityLiveRegion="polite"
                testID="rest-days-max"
              >
                {t('learningSettings.restMax')}
              </Txt>
            ) : null}
            <Txt variant="caption" color="ink-3">
              {t('learningSettings.restHelp')}
            </Txt>
          </Card>

          <Card>
            <Txt variant="body-m" weight={800}>
              {t('learningSettings.retentionTitle')}
            </Txt>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('learningSettings.retentionTitle')}
              style={{ gap: 8 }}
              testID="retention"
            >
              {RETENTION.map((r) => (
                <RetentionOption
                  key={r.key}
                  label={t(`learningSettings.${r.key}`)}
                  help={t(`learningSettings.${r.key}Help`)}
                  on={retention === r.value}
                  disabled={!editable}
                  onPress={() => {
                    if (editable && !retentionChange.isPending && retention !== r.value)
                      retentionChange.mutate({ desired_retention: r.value });
                  }}
                  testID={`retention-${r.key}`}
                />
              ))}
            </View>
          </Card>
        </>
      ) : (
        <Card>
          <Txt color="ink-3">{t('me.loadingProfile')}</Txt>
        </Card>
      )}

      {saving || saved || failed ? (
        <View accessibilityLiveRegion="polite" style={{ gap: 6 }} testID="settings-status">
          {failed ? (
            <>
              <Notice icon="info" tone="orange">
                {t('learningSettings.saveFailed')}
              </Notice>
              <RequestId id={asProblem(failed).requestId} />
            </>
          ) : (
            <Chip size="sm" icon={saving ? 'clock' : 'check'} tone={saving ? undefined : 'success'}>
              {saving ? t('learningSettings.saving') : t('learningSettings.saved')}
            </Chip>
          )}
        </View>
      ) : null}

      <Card>
        <Segmented<'full' | 'calm'>
          label={t('learningSettings.celebrationsTitle')}
          value={celebrations}
          onChange={(v) => setPrefs({ celebrations: v })}
          options={[
            { value: 'full', label: t('learningSettings.celebrationsFull') },
            { value: 'calm', label: t('learningSettings.celebrationsCalm') },
          ]}
          testID="celebrations"
        />
        <Txt variant="caption" color="ink-3">
          {t('learningSettings.celebrationsHelp')}
        </Txt>
      </Card>

      <Card>
        <Segmented
          label={t('settings.startPoint')}
          value={startSection}
          onChange={(n) => update((x) => ({ ...x, startSection: n }))}
          options={(course.data?.sections ?? []).map((s, i) => ({
            value: i + 1,
            label: String(i + 1),
            caption: s.cefr,
          }))}
          testID="start-section"
        />
        <Txt variant="caption" color="ink-3">
          {t('settings.startPointHelp')}
        </Txt>
      </Card>

      {d ? (
        <Card>
          <SectionTitle>{t('learningSettings.accountTitle')}</SectionTitle>
          <ListRow
            title={t('me.spelling')}
            value={
              d.settings.spelling_variant === 'uk' ? t('onboarding.l1.uk') : t('onboarding.l1.us')
            }
          />
          <ListRow
            title={t('settings.leagues')}
            value={d.settings.leagues_opt_in ? t('settings.leaguesOn') : t('settings.leaguesOff')}
            onPress={serverHasLeagues && !d.is_minor ? () => router.push('/leagues') : undefined}
            testID="settings-leagues"
          />
          <ListRow
            title={t('settings.perfectionist')}
            value={d.settings.perfectionist_mode ? t('common.on') : t('common.off')}
          />
        </Card>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Display
function DisplaySettings() {
  const { t } = useTranslation();
  const theme = usePrefs((s) => s.theme);
  const showTest = usePrefs((s) => s.showTestLanguages);
  const set = usePrefs((s) => s.set);
  return (
    <>
      <Card>
        <LanguagePicker testID="interface-language" />
        <Txt variant="caption" color="ink-3">
          {t('settings.interfaceLanguageHelp')}
        </Txt>
      </Card>
      <Card>
        <Segmented
          label={t('settings.theme')}
          value={theme}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
          ]}
          testID="theme"
        />
      </Card>
      <Card>
        <Switch
          label={t('settings.testLanguages')}
          value={showTest}
          onValueChange={(v) => set({ showTestLanguages: v })}
          testID="test-languages"
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Accessibility
/**
 * Every switch here is this device's. The two profile switches also choose the server's exercises
 * (reviews, the offline window), so the account keeps a copy: sent in the background when signed
 * in, never waited for; a copy the server missed is sent again at the next start (useBootstrap),
 * or before the outbox next sends answers (a11yCopyFirst). Not to a server whose settings keep no
 * profile (an older one); before /v1/me has answered, the start-up sync sends it when it does.
 */
function AccessibilitySettings() {
  const { t } = useTranslation();
  const p = usePrefs();
  const status = useAuthStatus();
  const saved = useMe().data?.settings;
  const setProfile = (patch: Partial<AccessibilityProfile>) => {
    p.set(patch);
    if (!serverHasSettings || status !== 'signedIn' || !keepsA11yProfile(saved)) return;
    const { noAudio, noVision } = usePrefs.getState();
    void saveA11yProfile({ noAudio, noVision });
  };
  return (
    <>
      <Card>
        <Switch
          label={t('settings.dyslexiaFont')}
          sub={t('settings.dyslexiaFontHelp')}
          value={p.dyslexiaFont}
          onValueChange={(v) => p.set({ dyslexiaFont: v })}
          testID="dyslexia-font"
        />
        <Switch
          label={t('settings.reduceMotion')}
          sub={t('settings.reduceMotionHelp')}
          value={p.reduceMotion}
          onValueChange={(v) => p.set({ reduceMotion: v })}
          testID="reduce-motion"
        />
      </Card>
      <Card>
        <Segmented<TimerPreference>
          label={t('settings.timers')}
          value={p.timers}
          onChange={(v) => p.set({ timers: v })}
          options={[
            { value: 'default', label: t('settings.timersDefault') },
            { value: 'double', label: t('settings.timersDouble') },
            { value: 'off', label: t('settings.timersOff') },
          ]}
          testID="timers"
        />
        <Txt variant="caption" color="ink-3">
          {t('settings.timersHelp')}
        </Txt>
        <Switch
          label={t('settings.timedMode')}
          sub={t('settings.timedModeHelp')}
          value={p.timedMode}
          disabled={p.timers === 'off'}
          onValueChange={(v) => p.set({ timedMode: v })}
          testID="timed-mode"
        />
      </Card>
      <Card>
        <Switch
          label={t('settings.noAudio')}
          sub={t('settings.noAudioHelp')}
          value={p.noAudio}
          onValueChange={(v) => setProfile({ noAudio: v })}
          testID="no-audio"
        />
        <Switch
          label={t('settings.noVision')}
          sub={t('settings.noVisionHelp')}
          value={p.noVision}
          onValueChange={(v) => setProfile({ noVision: v })}
          testID="no-vision"
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Audio
function AudioSettings() {
  const { t } = useTranslation();
  const speed = usePrefs((s) => s.speed);
  const whisper = usePrefs((s) => s.whisper);
  const soundEffects = usePrefs((s) => s.soundEffects);
  const haptics = usePrefs((s) => s.haptics);
  const set = usePrefs((s) => s.set);
  const [voice, setVoice] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void hasEnglishVoice().then((v) => alive && setVoice(v));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <Notice icon="speaker" title={t('settings.voiceTitle')}>
        {t('settings.voiceNote')}
      </Notice>
      {voice === false ? (
        <Notice icon="warning" tone="orange">
          {t('audio.notOnDevice')}
        </Notice>
      ) : null}
      <Card>
        <Segmented<Speed>
          label={t('settings.speed')}
          value={speed}
          onChange={(v) => set({ speed: v })}
          options={[
            { value: 1, label: t('audio.normal') },
            { value: 0.75, label: t('audio.slow') },
            { value: 0.5, label: t('audio.slower') },
          ]}
          testID="speed"
        />
        <Switch
          label={t('settings.whisper')}
          sub={t('speak.whisperHelp')}
          value={whisper}
          onValueChange={(v) => set({ whisper: v })}
          testID="whisper"
        />
      </Card>
      <Card>
        <Switch
          label={t('settings.soundEffects')}
          sub={t('settings.soundEffectsHelp')}
          value={soundEffects}
          onValueChange={(v) => {
            set({ soundEffects: v });
            if (!v) releaseSfx();
          }}
          testID="sound-effects"
        />
        {Platform.OS === 'web' ? null : (
          <Switch
            label={t('settings.haptics')}
            sub={t('settings.hapticsHelp')}
            value={haptics}
            onValueChange={(v) => set({ haptics: v })}
            testID="haptics"
          />
        )}
      </Card>
      <Notice icon="lock">{t('settings.recordingsPrivate')}</Notice>
    </>
  );
}

// ---------------------------------------------------------------- Reminders
/**
 * Reminders (docs/10 §7): one a day by default, two if asked for (never for a learner who may be
 * under 18), never in quiet hours, cut to weekly after five unopened, and off in one tap.
 */
function ReminderSettings() {
  const { t } = useTranslation();
  const me = useMe();
  const r = usePrefs((s) => s.reminders);
  const setReminders = usePrefs((s) => s.setReminders);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  // Unknown age counts as a minor: the cautious reading (one reminder a day at most).
  const minor = me.data?.is_minor ?? true;

  const apply = (patch: Partial<ReminderPrefs>) => {
    const next = { ...usePrefs.getState().reminders, ...patch };
    setReminders(patch);
    const text = t('onboarding.plan.reminderText', { cue: t(`onboarding.plan.${next.cue}`) });
    void applyReminders(next, text, minor)
      .then((res) => {
        setResult(res);
        if (res === 'scheduled') setReminders({ lastScheduledAt: new Date().toISOString() });
      })
      .catch((e: unknown) => log.warn('reminders.apply_failed', e));
  };

  if (!remindersSupported) {
    return <Notice icon="bell">{t('settings.remindersWeb')}</Notice>;
  }

  const shift = (minutes: number) => {
    const total = r.hour * 60 + r.minute + minutes;
    const { hour, minute } = clampToAllowed(Math.floor(total / 60), ((total % 60) + 60) % 60);
    apply({ hour, minute });
  };

  return (
    <>
      <Card>
        <Switch
          label={t('settings.remindersOn')}
          value={r.enabled && !r.paused}
          onValueChange={(v) =>
            apply({ enabled: v, paused: false, weekly: v ? false : r.weekly, ignoredInARow: 0 })
          }
          testID="reminders-on"
        />
        {r.enabled && !r.paused ? (
          <>
            <View style={{ gap: 8 }}>
              <Txt variant="body-m" weight={800}>
                {t('settings.reminderTime')}
              </Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="chevron-left"
                  onPress={() => shift(-30)}
                >
                  {t('onboarding.plan.earlier')}
                </Button>
                <Txt
                  variant="stat"
                  style={{ minWidth: 80, textAlign: 'center' }}
                  testID="reminder-time"
                >
                  {clock(r.hour, r.minute)}
                </Txt>
                <Button
                  variant="secondary"
                  size="sm"
                  iconRight="chevron-right"
                  onPress={() => shift(30)}
                >
                  {t('onboarding.plan.later')}
                </Button>
              </View>
            </View>
            <Segmented<1 | 2>
              label={t('settings.reminderFrequency')}
              value={minor ? 1 : r.perDay}
              onChange={(v) => apply({ perDay: v })}
              options={
                minor
                  ? [{ value: 1, label: t('settings.freqOnce') }]
                  : [
                      { value: 1, label: t('settings.freqOnce') },
                      { value: 2, label: t('settings.freqTwice') },
                    ]
              }
            />
            <ListRow
              title={t('settings.quietHours')}
              value={t('settings.quietHoursValue', {
                from: clock(QUIET_FROM_HOUR, 0),
                to: clock(QUIET_TO_HOUR, 0),
              })}
            />
          </>
        ) : null}
      </Card>
      {result === 'denied' ? (
        <Notice icon="warning" tone="orange">
          {t('settings.remindersDenied')}
        </Notice>
      ) : null}
      {r.enabled && r.weekly && !r.paused ? (
        <Card>
          <Txt variant="body-m">{t('settings.remindersReduced')}</Txt>
          <Button variant="secondary" block onPress={() => apply({ paused: true })}>
            {t('settings.pause')}
          </Button>
          <Button
            variant="secondary"
            block
            onPress={() => {
              setReminders({ enabled: false, weekly: false, ignoredInARow: 0 });
              void cancelReminders();
            }}
          >
            {t('settings.unsubscribe')}
          </Button>
        </Card>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Privacy
type Dialog = null | 'device' | 'recordings' | 'account';

/**
 * docs/11 §10: what the account's data is used for (each choice the learner's own, sent to the
 * server), the data exit (export everything, the account's copy included), and deletion — the
 * recordings now, this device, or the whole account. Each server control appears only when the
 * server offers it and the learner is signed in; offline, the switches wait rather than pretend.
 */
function PrivacySettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const me = useMe();
  const online = useOnlineStore(isOnline);
  const learnerId = useLearner((s) => s.learnerId);
  const rows = useOutboxRows(learnerId);
  const pending = rows.filter((r) => r.status === 'pending').length;
  const rejected = rows.filter((r) => r.status === 'rejected');
  const change = useUpdateSettings();
  const removeRecordings = useDeleteRecordings();
  const removeAccount = useDeleteAccount();
  const [exportState, setExportState] = useState<
    'idle' | 'busy' | 'saved' | 'unavailable' | 'failed'
  >('idle');
  const [accountMissing, setAccountMissing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');

  const settings = me.data?.settings;
  const canChange = !!settings && serverHasSettings && online;
  const voice = shown(change, (p) => p.voice_consent, settings?.voice_consent) ?? false;
  const training = shown(change, (p) => p.training_opt_in, settings?.training_opt_in) ?? false;
  const paused =
    shown(change, (p) => p.data_collection_paused, settings?.data_collection_paused) ?? false;

  const doExport = async () => {
    setExportState('busy');
    let account: AccountCopy = { unavailable: 'not_offered' };
    if (serverHasAccountExport && me.data) {
      try {
        account = online ? { data: await fetchAccountExport() } : { unavailable: 'offline' };
      } catch (e) {
        log.warn('privacy.account_export_failed', e);
        account = { unavailable: 'failed' };
      }
    }
    setAccountMissing('unavailable' in account && account.unavailable !== 'not_offered');
    try {
      setExportState(await saveExport(await buildExport(new Date(), account)));
    } catch (e) {
      log.error('privacy.export_failed', e);
      setExportState('failed');
    }
  };

  const close = () => {
    setDialog(null);
    setPassword('');
    removeAccount.reset();
  };

  const deleteAccount = () => {
    removeAccount.mutate(password, {
      onSuccess: () => {
        // the account is gone on the server: everything on this device goes with it
        setDeleting(true);
        void deleteEverythingOnDevice().catch((e: unknown) => {
          log.error('privacy.delete_failed', e);
          setDeleting(false);
        });
      },
    });
  };

  const wrongPassword =
    removeAccount.error instanceof ApiError &&
    removeAccount.error.problem.type === 'invalid_credentials';

  return (
    <>
      <Card>
        <Txt variant="body-m" testID="pending-count">
          {t('settings.pending', { count: pending })}
        </Txt>
        {rejected.length ? (
          <View style={{ gap: 6 }}>
            <Txt variant="body-m" color="danger-ink">
              {t('settings.rejected', { count: rejected.length })}
            </Txt>
            {rejected.slice(0, 5).map((r) => (
              <Txt key={r.client_uuid} variant="caption" color="ink-3" selectable>
                {`${r.last_error?.type ?? ''} · ${r.last_error?.request_id ?? r.client_uuid}`}
              </Txt>
            ))}
          </View>
        ) : null}
        {settings && !serverHasSettings ? (
          <ListRow
            title={t('settings.dataPaused')}
            value={settings.data_collection_paused ? t('common.on') : t('common.off')}
          />
        ) : null}
      </Card>

      {settings && serverHasSettings ? (
        <Card>
          <SectionTitle>{t('settings.dataUse')}</SectionTitle>
          <Switch
            label={t('settings.voiceConsent')}
            sub={t('settings.voiceConsentHelp')}
            value={voice}
            disabled={!canChange || change.isPending}
            onValueChange={(v) => change.mutate({ voice_consent: v })}
            testID="voice-consent"
          />
          <Switch
            label={t('settings.trainingOptIn')}
            sub={t('settings.trainingOptInHelp')}
            value={training}
            disabled={!canChange || change.isPending}
            onValueChange={(v) => change.mutate({ training_opt_in: v })}
            testID="training-opt-in"
          />
          <Switch
            label={t('settings.pauseData')}
            sub={t('settings.pauseDataHelp')}
            value={paused}
            disabled={!canChange || change.isPending}
            onValueChange={(v) => change.mutate({ data_collection_paused: v })}
            testID="data-paused"
          />
          {!online ? (
            <Txt variant="caption" color="ink-3">
              {t('learningSettings.offline')}
            </Txt>
          ) : null}
          {change.error ? <ProblemNotice problem={asProblem(change.error)} /> : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t('settings.exportData')}</SectionTitle>
        <Txt variant="body-s" color="ink-2">
          {serverHasAccountExport && me.data
            ? t('settings.exportHelpAccount')
            : t('settings.exportHelp')}
        </Txt>
        <Button
          block
          icon="download"
          busy={exportState === 'busy'}
          onPress={() => void doExport()}
          testID="export-data"
        >
          {t('settings.exportData')}
        </Button>
        {exportState === 'saved' ? <Notice icon="check">{t('settings.exported')}</Notice> : null}
        {exportState === 'saved' && accountMissing ? (
          <View testID="export-account-missing">
            <Notice icon="warning" tone="orange">
              {t('settings.exportAccountMissing')}
            </Notice>
          </View>
        ) : null}
        {exportState === 'unavailable' ? (
          <Notice icon="warning" tone="orange">
            {t('settings.exportUnavailable')}
          </Notice>
        ) : null}
        {exportState === 'failed' ? (
          <Notice icon="warning" tone="red">
            {t('errors.client/unknown')}
          </Notice>
        ) : null}
        {!serverHasAccountExport ? (
          <Txt variant="caption" color="ink-3">
            {t('settings.exportAccount')}
          </Txt>
        ) : null}
      </Card>

      {serverHasRecordingsDelete && me.data ? (
        <Card>
          <SectionTitle>{t('settings.deleteRecordings')}</SectionTitle>
          <Txt variant="body-s" color="ink-2">
            {t('settings.deleteRecordingsHelp')}
          </Txt>
          <Button
            block
            variant="secondary"
            icon="trash"
            disabled={!online}
            onPress={() => setDialog('recordings')}
            testID="delete-recordings"
          >
            {t('settings.deleteRecordings')}
          </Button>
          {removeRecordings.isSuccess ? (
            <View testID="recordings-deleted">
              <Notice icon="check">
                {t('settings.recordingsDeleted', { count: removeRecordings.data })}
              </Notice>
            </View>
          ) : null}
          {removeRecordings.error ? (
            <ProblemNotice problem={asProblem(removeRecordings.error)} />
          ) : null}
        </Card>
      ) : null}

      {me.data ? <ChangePassword /> : null}

      <Card>
        <SectionTitle>{t('settings.deleteDevice')}</SectionTitle>
        <Txt variant="body-s" color="ink-2">
          {t('settings.deleteDeviceHelp')}
        </Txt>
        <Button
          block
          variant="danger"
          icon="trash"
          onPress={() => setDialog('device')}
          testID="delete-device"
        >
          {t('settings.deleteDevice')}
        </Button>
      </Card>

      {serverHasAccountDelete && me.data ? (
        <Card>
          <SectionTitle>{t('settings.deleteAccount')}</SectionTitle>
          <Txt variant="body-s" color="ink-2">
            {t('settings.deleteAccountServerHelp')}
          </Txt>
          <Button
            block
            variant="danger"
            icon="trash"
            disabled={!online}
            onPress={() => setDialog('account')}
            testID="delete-account"
          >
            {t('settings.deleteAccount')}
          </Button>
        </Card>
      ) : (
        <Card soft>
          <SectionTitle>{t('settings.deleteAccount')}</SectionTitle>
          <Txt variant="body-s" color="ink-2">
            {t('settings.deleteAccountHelp')}
          </Txt>
        </Card>
      )}

      {dialog ? (
        <Modal
          transparent
          visible
          animationType={theme.reduceMotion ? 'none' : 'fade'}
          onRequestClose={close}
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
              testID={dialog === 'device' ? 'delete-dialog' : `delete-${dialog}-dialog`}
              style={{
                width: '100%',
                maxWidth: 440,
                alignSelf: 'center',
                backgroundColor: theme.c.surface,
                borderRadius: radius.xl,
                padding: 22,
                gap: 14,
              }}
            >
              <Txt variant="title-l" accessibilityRole="header">
                {dialog === 'device'
                  ? t('settings.deleteDevice')
                  : dialog === 'recordings'
                    ? t('settings.deleteRecordings')
                    : t('settings.deleteAccount')}
              </Txt>
              <Txt variant="body-m" color="ink-2">
                {dialog === 'device'
                  ? t('settings.deleteDeviceHelp')
                  : dialog === 'recordings'
                    ? t('settings.deleteRecordingsHelp')
                    : t('settings.deleteAccountServerHelp')}
              </Txt>
              {dialog === 'account' ? (
                <TextField
                  label={t('settings.deleteAccountPassword')}
                  value={password}
                  onChangeText={setPassword}
                  secure
                  autoCapitalize="none"
                  autoComplete="current-password"
                  error={wrongPassword ? t('settings.wrongPassword') : null}
                  testID="delete-account-password"
                />
              ) : null}
              {dialog === 'account' && removeAccount.error && !wrongPassword ? (
                <ProblemNotice problem={asProblem(removeAccount.error)} />
              ) : null}
              <Button
                block
                variant="danger"
                busy={deleting || removeRecordings.isPending || removeAccount.isPending}
                disabled={dialog === 'account' && !password}
                testID={dialog === 'device' ? 'delete-confirm' : `delete-${dialog}-confirm`}
                onPress={() => {
                  if (dialog === 'device') {
                    setDeleting(true);
                    void deleteEverythingOnDevice().catch((e: unknown) => {
                      log.error('privacy.delete_failed', e);
                      setDeleting(false);
                    });
                  } else if (dialog === 'recordings') {
                    removeRecordings.mutate(undefined, { onSettled: close });
                  } else {
                    deleteAccount();
                  }
                }}
              >
                {dialog === 'device'
                  ? t('settings.deleteDeviceConfirm')
                  : dialog === 'recordings'
                    ? t('settings.deleteRecordings')
                    : t('settings.deleteAccountConfirm')}
              </Button>
              <Button block variant="secondary" onPress={close}>
                {t('common.cancel')}
              </Button>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- About
function AboutSettings() {
  const { t } = useTranslation();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => unwrap(await api.GET('/health')),
    retry: false,
    staleTime: 30_000,
  });
  const checks = useQuery({
    queryKey: ['content', 'checks'],
    queryFn: () => content.startupChecks(),
    staleTime: Infinity,
  });
  const [copied, setCopied] = useState(false);
  const entries = log.entries().slice(-40).reverse();
  const version = Constants.expoConfig?.version ?? '—';
  const host = API_BASE_URL.replace(/^https?:\/\//, '');

  return (
    <>
      <Card>
        <ListRow title={t('settings.version')} value={`${version} · ${Platform.OS}`} />
        <ListRow
          title={t('settings.contentVersion')}
          value={contentVersion.replace('sha256:', '')}
        />
        <ListRow
          title={t('settings.api')}
          sub={host}
          value={`${t('settings.apiVersion', { version: apiVersion })} · ${health.data ? (health.data.status ?? 'ok') : health.isError ? '✕' : '…'}`}
        />
        <ListRow
          title={t('settings.checks')}
          sub={
            checks.data
              ? checks.data.ok
                ? t('settings.checksOk')
                : t('settings.checksBad')
              : t('common.loading')
          }
        />
      </Card>
      <Card>
        <SectionTitle>{t('settings.diagnostics')}</SectionTitle>
        <Txt variant="body-s" color="ink-2">
          {t('settings.diagnosticsHelp')}
        </Txt>
        {entries.length ? (
          <View style={{ gap: 2 }}>
            {entries.slice(0, 12).map((e, i) => (
              <Txt
                key={i}
                variant="caption"
                color={e.level === 'error' ? 'danger-ink' : 'ink-3'}
                numberOfLines={1}
              >
                {`${e.at.slice(11, 19)} ${e.level} ${e.event}`}
              </Txt>
            ))}
          </View>
        ) : (
          <Txt variant="caption" color="ink-3">
            {t('settings.diagnosticsEmpty')}
          </Txt>
        )}
        <TextLink
          icon={copied ? 'check' : 'share'}
          onPress={() => {
            void Clipboard.setStringAsync(JSON.stringify(entries, null, 1)).then(() =>
              setCopied(true),
            );
          }}
        >
          {copied ? t('common.copied') : t('settings.sendDiagnostic')}
        </TextLink>
      </Card>
    </>
  );
}

export function SettingsPage({ page }: { page: SettingsPageId }) {
  switch (page) {
    case 'learning':
      return <LearningSettings />;
    case 'display':
      return <DisplaySettings />;
    case 'accessibility':
      return <AccessibilitySettings />;
    case 'audio':
      return <AudioSettings />;
    case 'reminders':
      return <ReminderSettings />;
    case 'privacy':
      return <PrivacySettings />;
    case 'about':
      return <AboutSettings />;
  }
}

export const PAGE_TITLE: Record<SettingsPageId, string> = {
  learning: 'me.learning',
  display: 'me.display',
  accessibility: 'me.accessibility',
  audio: 'me.audio',
  reminders: 'me.reminders',
  privacy: 'me.privacy',
  about: 'me.about',
};
