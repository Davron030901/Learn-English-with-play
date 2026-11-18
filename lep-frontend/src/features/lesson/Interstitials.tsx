import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Pressable, View, type PressableStateCallbackType } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { useEquippedOutfit } from '@/api/queries/assessment';
import { serverHasGamification, useGamificationSummary, useSessionSummary } from '@/api/queries/gamification';
import { useAuthStatus } from '@/api/queries/me';
import type { AwardsOut, GamificationSummary } from '@/api/types';
import { sfx } from '@/audio/sfx';
import type { Lexeme } from '@/content/model';
import { Button, Card, Chip, Icon, Notice, Txt, radius, tone, useTheme, type IconName, type Tone } from '@/design';
import { DressedPip } from '@/design/Outfits';
import { CelebrationHost } from '@/features/celebrate/CelebrationHost';
import { CountUp } from '@/features/hud/CountUp';
import { wholeMinutes } from '@/features/hud/format';
import { GoalRing } from '@/features/hud/GoalRing';
import { earnedState, lessonEarned, useCloseSync, type LessonEarned } from '@/features/hud/sessionAwards';
import { QuestRow } from '@/features/quests/QuestRow';
import { BREAK_SECONDS } from '@/runner/phases';
import { usePrefs } from '@/state/prefs';

type State = PressableStateCallbackType & { focused?: boolean };

/** docs/07 §3.3: past 12 minutes, one 15-second break with a stretch or breathe prompt. */
export function BreakView({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const outfit = useEquippedOutfit();
  const [left, setLeft] = useState(BREAK_SECONDS);
  useEffect(() => {
    if (left <= 0) {
      onDone();
      return;
    }
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left, onDone]);
  return (
    <View style={{ gap: 20, alignItems: 'center', paddingTop: 24 }} testID="break">
      <DressedPip outfit={outfit} pose="rest" size={140} />
      <Txt variant="display-m" align="center" accessibilityRole="header">
        {t('lesson.break.title')}
      </Txt>
      <Txt variant="body-l" color="ink-2" align="center">
        {t('lesson.break.body')}
      </Txt>
      <Txt variant="stat" accessibilityLiveRegion="polite">{String(left)}</Txt>
      <Button variant="secondary" onPress={onDone}>
        {t('lesson.break.skip')}
      </Button>
    </View>
  );
}

/** What the runner knows about the session that the summary needs from it. */
export interface CloseSession {
  /** The runner's session id: the `session_id` every answer carried to the server. */
  runId: string;
  learnerId: string | null;
  startedAt: number;
  /** Awards that arrived while the lesson was open, and the summary when it opened. */
  awards: readonly AwardsOut[];
  before: GamificationSummary | null;
  /** A node's title for the "tier done" lines (null when the node is not in the course). */
  nodeTitle: (nodeId: string) => string | null;
  /** A unit's number on the path. */
  unitNumber: (unitId: string) => number | null;
}

/**
 * CLOSE — the lesson-end summary (docs/16 E04, brief §6.1, §6.2). The closing sync runs the
 * moment it opens; while it runs the summary is calm and shows only what the device measured
 * itself. Then, from the server: the XP this lesson earned (with an honest line about how), the
 * daily goal ring filling to its new value, the streak (its flame ticks only the first time
 * today), quest bars moving, finished tiers and units. Offline it says the answers are saved and
 * will count later — it never guesses a number. "Finish for now" stays the primary action and
 * nothing moves on by itself (docs/07 §3.3). Rare celebrations open afterwards (docs/16 E12).
 */
export function CloseView({
  practised,
  introduced,
  nextTitle,
  withheld,
  withheldByProfile = 0,
  notSaved = false,
  onStop,
  onNext,
  session,
}: {
  practised: number;
  introduced: { lexemes: readonly Lexeme[]; grammar: readonly string[] };
  nextTitle: string | null;
  withheld: number;
  /** Items left out because the learner practises without audio (brief §12). */
  withheldByProfile?: number;
  /** Some answers could not be stored on the device: never claim they were. */
  notSaved?: boolean;
  onStop: () => void;
  onNext: (() => void) | null;
  /** Absent for a session that sent nothing (nothing practised): the summary stays local. */
  session?: CloseSession;
}) {
  const status = useAuthStatus();
  const available = !!session && serverHasGamification && status === 'signedIn' && practised > 0;
  const sync = useCloseSync(available ? (session?.learnerId ?? null) : null, available);
  const state = earnedState(sync.state, available);
  const summary = useGamificationSummary();
  const sessionSummary = useSessionSummary(state === 'online' && session ? session.runId : null);
  const after = summary.data && sync.doneAt > 0 && summary.dataUpdatedAt >= sync.doneAt ? summary.data : null;
  const earned = useMemo(
    () => lessonEarned({ state, awards: session?.awards ?? [], before: session?.before ?? null, after, session: sessionSummary.data ?? null }),
    [state, session?.awards, session?.before, after, sessionSummary.data],
  );
  const [minutes] = useState(() => (session ? Math.max(1, Math.round((Date.now() - session.startedAt) / 60_000)) : 0));
  return (
    <LessonEndView
      earned={earned}
      practised={practised}
      minutes={minutes}
      introduced={introduced}
      nextTitle={nextTitle}
      withheld={withheld}
      withheldByProfile={withheldByProfile}
      notSaved={notSaved}
      onStop={onStop}
      onNext={onNext}
      before={session?.before ?? null}
      nodeTitle={session?.nodeTitle ?? (() => null)}
      unitNumber={session?.unitNumber ?? (() => null)}
    />
  );
}

/** Timeline steps (docs/16 E04): 0 Pip and title · 1 stat tiles · 2 ring and streak · 3 quests · 4 the rest. */
const STEP_AT = [0, 0, 1_000, 1_900, 2_700] as const;

function StatTile({ icon, iconTone, label, a11y, children, testID }: { icon: IconName; iconTone: Tone; label: string; a11y: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  const tn = tone(theme, iconTone);
  return (
    <View
      accessible
      accessibilityLabel={a11y}
      testID={testID}
      style={{
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        gap: 4,
        paddingVertical: 12,
        paddingHorizontal: 6,
        borderRadius: radius.lg,
        backgroundColor: theme.c.surface,
        borderWidth: 2,
        borderColor: theme.c.line,
        boxShadow: theme.lip(theme.c.line, 4),
        marginBottom: 4,
      }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: tn.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={tn.ink} tone={icon === 'star' ? 'color' : 'current'} />
      </View>
      {children}
      <Txt variant="caption" color="ink-3" weight={800} align="center" numberOfLines={1} style={{ fontSize: 12 }}>
        {label}
      </Txt>
    </View>
  );
}

function StreakTick({ current, credited, play }: { current: number; credited: boolean; play: boolean }) {
  const theme = useTheme();
  const pop = useSharedValue(1);
  useEffect(() => {
    if (!credited || !play || theme.reduceMotion) return;
    pop.value = withSequence(withTiming(1.3, { duration: 160 }), withSpring(1, { damping: 12, stiffness: 220 }));
  }, [credited, play, pop, theme.reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Animated.View style={style}>
        <Icon name="flame" tone="color" size={30} />
      </Animated.View>
      <CountUp value={current} from={credited && play ? Math.max(0, current - 1) : current} animate={credited && play} durationMs={400} variant="stat" rawColor={theme.c['streak-ink']} />
    </View>
  );
}

export function LessonEndView({
  earned,
  practised,
  minutes,
  introduced,
  nextTitle,
  withheld,
  withheldByProfile,
  notSaved,
  onStop,
  onNext,
  before,
  nodeTitle,
  unitNumber,
}: {
  earned: LessonEarned;
  practised: number;
  minutes: number;
  introduced: { lexemes: readonly Lexeme[]; grammar: readonly string[] };
  nextTitle: string | null;
  withheld: number;
  withheldByProfile: number;
  notSaved: boolean;
  onStop: () => void;
  onNext: (() => void) | null;
  before: GamificationSummary | null;
  nodeTitle: (nodeId: string) => string | null;
  unitNumber: (unitId: string) => number | null;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const calm = usePrefs((s) => s.celebrations) === 'calm';
  const outfit = useEquippedOutfit();
  const [reader, setReader] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => alive && setReader(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  // Reduced motion, calm celebrations and screen readers get the final state at once.
  const instant = theme.reduceMotion || calm || reader;
  const ready = earned.state !== 'pending';
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const shown = instant || skipped ? 4 : step;
  const animate = !instant && !skipped;

  // The timeline only runs for an animated summary; an instant one is derived as complete above.
  useEffect(() => {
    if (!ready || instant) return;
    const ids = STEP_AT.map((ms, i) => setTimeout(() => setStep((s) => Math.max(s, i)), ms));
    return () => ids.forEach(clearTimeout);
  }, [ready, instant]);

  // Sounds, each once (docs/16 E04, E07): the ring closing, the first streak credit of the day, a
  // quest done (one sound even if two complete). A quiet summary plays only the most important.
  const played = useRef(new Set<string>());
  const goalMetNow = !!earned.goal?.metNow;
  const creditedNow = !!earned.streak?.creditedNow;
  const questDone = earned.quests.some((q) => q.completedNow);
  useEffect(() => {
    if (earned.state !== 'online') return;
    const once = (key: string, f: () => void) => {
      if (played.current.has(key)) return;
      played.current.add(key);
      f();
    };
    if (instant) {
      if (shown < 4) return;
      if (goalMetNow) once('ring', () => sfx('ring'));
      else if (creditedNow) once('streak', () => sfx('streak'));
      else if (questDone) once('quest', () => sfx('quest'));
      return;
    }
    if (shown >= 2 && goalMetNow) once('ring', () => sfx('ring'));
    if (shown >= 2 && creditedNow) {
      const id = setTimeout(() => once('streak', () => sfx('streak')), goalMetNow ? 550 : 0);
      return () => clearTimeout(id);
    }
    if (shown >= 3 && questDone) once('quest', () => sfx('quest'));
  }, [earned.state, shown, instant, goalMetNow, creditedNow, questDone]);

  const pip = useSharedValue(theme.reduceMotion ? 1 : 0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    pip.value = withSpring(1, { damping: 12, stiffness: 220 });
  }, [pip, theme.reduceMotion]);
  const pipStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, pip.value * 1.4), transform: [{ scale: 0.7 + 0.3 * pip.value }] }));

  const [details, setDetails] = useState(false);
  // Keyed by id (lexemes) or position (grammar): two lexemes can share a spelling.
  const learned = [
    ...introduced.lexemes.map((l) => ({ key: `lex:${l.id}`, label: l.lemma })),
    ...introduced.grammar.map((g, i) => ({ key: `g:${i}`, label: g })),
  ];
  const newWords = introduced.lexemes.length;
  const online = earned.state === 'online';
  const offline = earned.state === 'offline';
  const goal = earned.goal;
  const pendingGoal = offline && before ? before.goal : null;

  let xpTile: ReactNode;
  let xpA11y: string;
  if (online && earned.xp !== null) {
    xpTile = <CountUp value={earned.xp} animate={animate && shown >= 1} variant="stat" rawColor={theme.c['xp-ink']} testID="lesson-end-xp" />;
    xpA11y = t('lessonEnd.xpA11y', { count: earned.xp });
  } else if (earned.state === 'pending') {
    xpTile = (
      <Txt variant="stat" color="ink-4" accessible={false}>
        …
      </Txt>
    );
    xpA11y = t('lessonEnd.saving');
  } else if (offline) {
    xpTile = (
      <Txt variant="caption" weight={800} color="ink-2" align="center" style={{ fontSize: 12, lineHeight: 15 }} testID="lesson-end-xp-later">
        {t('lessonEnd.countsOnline')}
      </Txt>
    );
    xpA11y = `${t('lessonEnd.xpLabel')}: ${t('lessonEnd.countsOnline')}`;
  } else {
    xpTile = (
      <Txt variant="caption" weight={800} color="ink-2" align="center" style={{ fontSize: 12, lineHeight: 15 }}>
        {t('common.notAvailableYet')}
      </Txt>
    );
    xpA11y = `${t('lessonEnd.xpLabel')}: ${t('common.notAvailableYet')}`;
  }

  return (
    <View style={{ gap: 18 }} testID="close" onTouchEnd={() => ready && !skipped && !instant && setSkipped(true)}>
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 8 }}>
        <Animated.View style={pipStyle}>
          <DressedPip outfit={outfit} pose="cheer" size={120} />
        </Animated.View>
        <Txt variant="display-m" align="center" accessibilityRole="header">
          {t('lessonEnd.title')}
        </Txt>
        <Txt variant="body-l" color="ink-2" align="center" testID="close-practised">
          {t('lesson.close.practised', { count: practised })}
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }} testID="lesson-end-tiles">
        <StatTile icon="star" iconTone="xp" label={t('lessonEnd.xpLabel')} a11y={xpA11y} testID="tile-xp">
          {xpTile}
        </StatTile>
        <StatTile icon="clock" iconTone="primary" label={t('lessonEnd.timeLabel')} a11y={t('lessonEnd.timeA11y', { count: minutes })}>
          <Txt variant="stat" accessible={false}>
            {t('lessonEnd.timeValue', { count: minutes })}
          </Txt>
        </StatTile>
        <StatTile icon="letters" iconTone="success" label={t('lessonEnd.wordsLabel')} a11y={t('lessonEnd.wordsA11y', { count: newWords })}>
          <Txt variant="stat" accessible={false}>
            {t('lessonEnd.wordsValue', { count: newWords })}
          </Txt>
        </StatTile>
      </View>

      {earned.state === 'pending' ? (
        <View accessibilityLiveRegion="polite" style={{ alignItems: 'center' }}>
          <Txt variant="body-s" color="ink-3" testID="lesson-end-saving">
            {t('lessonEnd.saving')}
          </Txt>
        </View>
      ) : null}

      {online && earned.answers !== null && shown >= 1 ? (
        <Txt variant="body-s" color="ink-3" align="center" testID="lesson-end-breakdown">
          {t('lessonEnd.xpBreakdown', { count: earned.answers })}
        </Txt>
      ) : null}

      {online && shown >= 2 && (goal || earned.streak) ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {goal ? (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexGrow: 1, flexBasis: 150 }}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={t('lessonEnd.goalA11y', { done: wholeMinutes(goal.after), goal: goal.goalMin })}
                testID="lesson-end-goal"
              >
                <GoalRing size={64} stroke={8} from={goal.before / Math.max(1, goal.goalMin)} value={goal.after / Math.max(1, goal.goalMin)} met={goal.met} animate={animate} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="caption" color="ink-3" weight={800}>
                    {t('lessonEnd.goalTitle')}
                  </Txt>
                  <Txt variant="title-s" accessible={false}>
                    {t('lessonEnd.goalValue', { done: wholeMinutes(goal.after), goal: goal.goalMin })}
                  </Txt>
                </View>
              </View>
            ) : null}
            {earned.streak ? (
              <View
                style={{ flexGrow: 1, flexBasis: 130, gap: 2 }}
                accessible
                accessibilityLabel={[t('hud.streak.label', { count: earned.streak.current }), earned.streak.creditedNow ? t('lessonEnd.streakCredited') : null].filter(Boolean).join('. ')}
                testID="lesson-end-streak"
              >
                <Txt variant="caption" color="ink-3" weight={800}>
                  {t('lessonEnd.streakTitle')}
                </Txt>
                <StreakTick current={earned.streak.current} credited={earned.streak.creditedNow} play={animate} />
              </View>
            ) : null}
          </View>
          {goal?.metNow ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLiveRegion="polite">
              <Icon name="check-circle" size={20} color={theme.c['success-ink']} />
              <Txt variant="body-m" weight={800} color="success-ink" style={{ flex: 1 }} testID="lesson-end-goal-met">
                {t('lessonEnd.goalMet')}
              </Txt>
            </View>
          ) : earned.streak?.creditedNow ? (
            <Txt variant="body-s" color="ink-2">
              {t('lessonEnd.streakCredited')}
            </Txt>
          ) : null}
        </Card>
      ) : null}

      {pendingGoal ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessible accessibilityLabel={t('lessonEnd.goalWaiting', { count: minutes })} testID="lesson-end-goal-waiting">
          <GoalRing size={48} stroke={6} value={pendingGoal.minutes_today / Math.max(1, pendingGoal.goal_min)} pending={minutes / Math.max(1, pendingGoal.goal_min)} animate={false} />
          <Txt variant="body-s" color="ink-2" style={{ flex: 1 }}>
            {t('lessonEnd.goalWaiting', { count: minutes })}
          </Txt>
        </View>
      ) : null}

      {online && shown >= 3 && earned.quests.length ? (
        <Card>
          <Txt variant="overline" color="ink-3" accessibilityRole="header">
            {t('quests.today')}
          </Txt>
          {earned.quests.map((q, i) => (
            <QuestRow key={q.quest.id} quest={q.quest} before={q.before} animate={animate} delayMs={i * 120} />
          ))}
        </Card>
      ) : null}

      {online && shown >= 4 && (earned.tiersDone.length || earned.unitsDone.length || earned.gems > 0) ? (
        <Card soft>
          <Txt variant="overline" color="ink-3" accessibilityRole="header">
            {t('lessonEnd.progressTitle')}
          </Txt>
          {earned.unitsDone.map((u) => (
            <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="trophy" tone="color" size={20} />
              <Txt variant="body-m" weight={800} style={{ flex: 1 }}>
                {t('lessonEnd.unitDone', { n: unitNumber(u) ?? u })}
              </Txt>
            </View>
          ))}
          {earned.tiersDone.map((n) => {
            const title = nodeTitle(n.node_id);
            return title ? (
              <View key={`${n.node_id}:${n.tier}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="check-circle" size={20} color={theme.c['success-ink']} />
                <Txt variant="body-s" weight={700} style={{ flex: 1 }}>
                  {t('lessonEnd.tierDone', { title, tier: n.tier })}
                </Txt>
              </View>
            ) : null;
          })}
          {earned.gems > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="gem" tone="color" size={18} />
              <Txt variant="body-s" weight={800} rawColor={theme.c['gem-ink']}>
                {t('lessonEnd.gemsEarned', { count: earned.gems })}
              </Txt>
            </View>
          ) : null}
        </Card>
      ) : null}

      {learned.length ? (
        <Card>
          <Txt variant="overline" color="ink-3">
            {t('lesson.close.learned')}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {learned.map((w) => (
              <Chip key={w.key} tone="blue">
                {w.label}
              </Chip>
            ))}
          </View>
        </Card>
      ) : null}
      {nextTitle ? (
        <Card soft>
          <Txt variant="overline" color="ink-3">
            {t('lesson.close.next')}
          </Txt>
          <Txt variant="title-s">{nextTitle}</Txt>
        </Card>
      ) : null}
      {withheld > 0 ? <Notice icon="info">{t('lesson.withheld', { count: withheld })}</Notice> : null}
      {withheldByProfile > 0 ? <Notice icon="info">{t('lesson.withheldProfile', { count: withheldByProfile })}</Notice> : null}

      {online && earned.correct !== null && earned.graded !== null && earned.graded > 0 ? (
        <View>
          <Pressable
            onPress={() => setDetails((d) => !d)}
            accessibilityRole="button"
            accessibilityState={{ expanded: details }}
            testID="lesson-end-details"
            style={(s: State) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, borderRadius: 12, boxShadow: s.focused ? theme.focusRing : 'none' })}
          >
            <Txt variant="body-m" weight={800} color="primary-ink">
              {t('lessonEnd.details')}
            </Txt>
            <Icon name="chevron-down" size={18} color={theme.c['primary-ink']} style={{ transform: [{ rotate: details ? '180deg' : '0deg' }] }} />
          </Pressable>
          {details ? (
            <View style={{ gap: 4 }}>
              <Txt variant="body-s" color="ink-2">
                {t('lessonEnd.correctFirst', { correct: earned.correct, total: earned.graded })}
              </Txt>
              <Txt variant="body-s" color="ink-3">
                {t('lessonEnd.detailsNote')}
              </Txt>
            </View>
          ) : null}
        </View>
      ) : null}

      {notSaved ? (
        <Notice icon="warning" tone="orange">
          {t('lesson.outboxFull')}
        </Notice>
      ) : offline ? (
        <View testID="lesson-end-offline">
          <Notice icon="clock">{t('lessonEnd.offline')}</Notice>
        </View>
      ) : earned.state === 'unavailable' ? (
        <Txt variant="caption" color="ink-3" align="center">
          {t('lesson.close.savedLocal')}
        </Txt>
      ) : null}

      <View style={{ gap: 12 }}>
        {goalMetNow && online ? null : (
          <Txt variant="title-s" align="center" color="ink-2">
            {t('lesson.close.title')}
          </Txt>
        )}
        <Button size="lg" block onPress={onStop} testID="close-stop">
          {t('lesson.close.stop')}
        </Button>
        {onNext ? (
          <Button size="lg" block variant="secondary" onPress={onNext} testID="close-next">
            {t('lesson.close.keepGoing')}
          </Button>
        ) : null}
      </View>
      <CelebrationHost active={ready && shown >= 4} />
    </View>
  );
}
