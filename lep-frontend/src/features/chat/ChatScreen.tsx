import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useAiStatus,
  useCast,
  useDeleteConversation,
  useEndConversation,
  useSendTurn,
  useStartConversation,
  type ChatMode,
} from '@/api/queries/ai';
import { ApiError } from '@/api/problem';
import type { ConversationOut, RecastOut, SummaryOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import {
  Button,
  CONTENT_MAX,
  Card,
  CastPortrait,
  Chip,
  Icon,
  IconButton,
  LevelBadge,
  Notice,
  Screen,
  ScreenHeader,
  Segmented,
  SectionTitle,
  Txt,
  castTone,
  radius,
  space,
  tone,
  useTheme,
} from '@/design';
import { useLexicon } from '@/content/queries';
import { ProblemNotice, asProblem } from '@/features/errors';
import { uuidv7 } from '@/lib/uuid';
import { useLearner } from '@/state/learner';
import { usePrefs } from '@/state/prefs';

import { focusWords } from './focusWords';

/**
 * Talk with the story's characters (docs/16 E21). Three steps on one screen: a pre-chat card
 * (who, the scenario's goals, fluency or accuracy), the chat itself (goal chips tick as the
 * server detects them, recasts are underlined in the reply), and an end card with two things to
 * work on. Every word the character says comes from our server; the app never talks to a model.
 */

type Message = {
  key: string;
  role: 'character' | 'learner';
  text: string;
  recasts: RecastOut[];
  /** a learner turn that has not been answered yet: its id is reused on retry */
  pending?: { clientUuid: string; rtMs: number | null };
  failed?: boolean;
  /** why it failed: kept with the message, not read from the latest mutation */
  error?: unknown;
};

const MAX_CHARS = 500;

export function ChatScreen({
  characterId,
  unitId,
  onBack,
}: {
  characterId: string;
  unitId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const language = usePrefs((s) => s.interfaceLanguage);
  const status = useAiStatus();
  const cast = useCast(unitId);
  const start = useStartConversation();
  const [mode, setMode] = useState<ChatMode>('accuracy');
  // one id per start: a retried start (after a timeout) gets the same chat back, charged once
  const [startId, setStartId] = useState(() => uuidv7());
  const [conversation, setConversation] = useState<ConversationOut | null>(null);
  const [summary, setSummary] = useState<SummaryOut | null>(null);

  const character = cast.data?.characters.find((c) => c.id === characterId) ?? null;
  const scenario = cast.data?.scenarios.find((s) => s.unit_id === unitId) ?? null;
  const name = character?.name ?? characterId;
  const header = (
    <ScreenHeader title={t('chat.title', { name })} onBack={onBack} backLabel={t('common.back')} />
  );

  if (summary && conversation) {
    return (
      <ChatSummary
        summary={summary}
        conversation={conversation}
        name={name}
        header={header}
        onAgain={() => {
          setSummary(null);
          setConversation(null);
          setStartId(uuidv7());
          start.reset();
        }}
        onDone={onBack}
      />
    );
  }
  if (conversation) {
    return (
      <ChatRoom conversation={conversation} name={name} onEnded={setSummary} onBack={onBack} />
    );
  }

  const allowance = status.data;
  const spent = allowance ? allowance.used_today >= allowance.daily_limit : false;
  const ceiling =
    spent || (start.error instanceof ApiError && start.error.problem.type === 'ai_allowance');

  return (
    <Screen header={header} testID="chat-setup">
      <Card>
        <View style={{ alignItems: 'center', gap: space['3'] }}>
          <CastPortrait id={characterId} size={96} label={name} />
          <Txt variant="title-l" align="center">
            {name}
          </Txt>
          {character ? (
            <Txt variant="body-m" color="ink-2" align="center">
              {character.role[language] ?? character.role.en ?? ''}
            </Txt>
          ) : null}
          <Chip icon="bulb" tone={castTone(characterId)} size="sm">
            {t('chat.aiCharacter')}
          </Chip>
        </View>
      </Card>

      {scenario ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <LevelBadge level={scenario.cefr} size="sm" />
            <Txt variant="title-s" style={{ flex: 1 }}>
              {scenario.title[language] ?? scenario.title.en ?? unitId}
            </Txt>
          </View>
          <SectionTitle>{t('chat.goals')}</SectionTitle>
          {scenario.can_do.slice(0, 3).map((g) => (
            <View key={g} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="target" size={20} />
              <Txt variant="body-m" lang="en" style={{ flex: 1 }}>
                {g}
              </Txt>
            </View>
          ))}
        </Card>
      ) : null}

      {cast.error ? (
        <ProblemNotice problem={asProblem(cast.error)} onRetry={() => void cast.refetch()} />
      ) : null}

      <Segmented<ChatMode>
        label={t('chat.modeLabel')}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setStartId(uuidv7());
        }}
        options={[
          {
            value: 'accuracy',
            label: t('chat.mode.accuracy'),
            caption: t('chat.mode.accuracySub'),
          },
          { value: 'fluency', label: t('chat.mode.fluency'), caption: t('chat.mode.fluencySub') },
        ]}
        testID="chat-mode"
      />

      <Notice icon="shield" tone="lagoon">
        <View style={{ gap: 4 }}>
          <Txt variant="body-s" color="ink-2">
            {t('chat.notHuman')}
          </Txt>
          <Txt variant="body-s" color="ink-2">
            {t('chat.retention', { days: allowance?.retention_days ?? 30 })}
          </Txt>
        </View>
      </Notice>

      {ceiling ? (
        <Notice icon="moon" tone="purple" title={t('chat.ceilingTitle')}>
          {t('chat.ceiling')}
        </Notice>
      ) : null}
      {start.error && !ceiling ? <ProblemNotice problem={asProblem(start.error)} /> : null}

      {allowance ? (
        <Txt variant="body-s" color="ink-3" align="center" testID="chat-allowance">
          {t('chat.allowance', { used: allowance.used_today, limit: allowance.daily_limit })}
        </Txt>
      ) : null}
      <Button
        size="lg"
        icon="chat"
        disabled={ceiling || !character}
        busy={start.isPending}
        onPress={() =>
          start.mutate(
            { characterId, unitId, mode, clientUuid: startId },
            {
              onSuccess: (c) => {
                sfx('page');
                setConversation(c);
              },
            },
          )
        }
        testID="chat-start"
      >
        {t('chat.start')}
      </Button>
    </Screen>
  );
}

// ------------------------------------------------------------------- the chat itself

function ChatRoom({
  conversation,
  name,
  onEnded,
  onBack,
}: {
  conversation: ConversationOut;
  name: string;
  onEnded: (s: SummaryOut) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const send = useSendTurn();
  const end = useEndConversation();
  const [messages, setMessages] = useState<Message[]>([
    { key: 'opening', role: 'character', text: conversation.opening_line, recasts: [] },
  ]);
  const [draft, setDraft] = useState('');
  const [met, setMet] = useState<string[]>([]);
  const [turn, setTurn] = useState(0);
  const [over, setOver] = useState(false);
  const [help, setHelp] = useState(false);
  const [explain, setExplain] = useState<RecastOut | null>(null);
  // every goal met: the end card is offered (docs/16 E21 screen 4); the learner may keep going
  const [goalPrompt, setGoalPrompt] = useState<'hidden' | 'shown' | 'dismissed'>('hidden');
  // when the latest reply appeared (0 until the first effect runs): the learner's thinking time
  const shownAt = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const accent = castTone(conversation.character_id);

  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => scroll.current?.scrollToEnd({ animated: !theme.reduceMotion }), 50);
    return () => clearTimeout(id);
  }, [messages.length, send.isPending, explain, goalPrompt, theme.reduceMotion]);

  // One turn in flight at a time: the server answers turns in order, and a second mutate on the
  // same observer would drop the first one's callbacks.
  const deliver = (m: Message) => {
    if (!m.pending || send.isPending) return;
    setMessages((all) =>
      all.map((x) => (x.key === m.key ? { ...x, failed: false, error: undefined } : x)),
    );
    send.mutate(
      {
        conversationId: conversation.id,
        clientUuid: m.pending.clientUuid,
        text: m.text,
        rtMs: m.pending.rtMs,
      },
      {
        onSuccess: (r) => {
          const fresh = r.subgoals_met.filter((g) => !met.includes(g));
          if (fresh.length) sfx('quest');
          setMet(r.subgoals_met);
          setTurn(r.turn);
          setOver(r.ended);
          if (r.goal_met && !r.ended) setGoalPrompt((p) => (p === 'hidden' ? 'shown' : p));
          shownAt.current = Date.now();
          setMessages((all) => [
            ...all.map((x) =>
              x.key === m.key ? { ...x, pending: undefined, failed: false, error: undefined } : x,
            ),
            {
              key: `c-${m.pending?.clientUuid ?? all.length}`,
              role: 'character',
              text: r.reply,
              recasts: r.recasts,
            },
          ]);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.problem.type === 'ai_ended') {
            setOver(true);
            setMessages((all) => all.filter((x) => x.key !== m.key));
            return;
          }
          if (e instanceof ApiError && e.problem.type === 'validation_error') {
            // refused before anything was stored, and the same message would be refused again:
            // it goes back into the input instead of blocking the chat
            setMessages((all) => all.filter((x) => x.key !== m.key));
            setDraft((d) => d || m.text);
            return;
          }
          setMessages((all) =>
            all.map((x) => (x.key === m.key ? { ...x, failed: true, error: e } : x)),
          );
        },
      },
    );
  };

  // An unsent message is tried again (same id) before anything new is said: the server may
  // still be answering it, or may have answered it already, and its reply belongs before the
  // next message.
  const failed = messages.find((m) => m.failed);

  const submit = () => {
    const text = draft.trim().slice(0, MAX_CHARS);
    if (!text || send.isPending || over || failed) return;
    const clientUuid = uuidv7();
    const m: Message = {
      key: `l-${clientUuid}`,
      role: 'learner',
      text,
      recasts: [],
      // never negative: the device clock may have been set back since the reply appeared
      pending: {
        clientUuid,
        rtMs: shownAt.current ? Math.max(0, Math.min(600_000, Date.now() - shownAt.current)) : null,
      },
    };
    setDraft('');
    setHelp(false);
    setExplain(null);
    setMessages((all) => [...all, m]);
    sfx('tap');
    deliver(m);
  };

  const finish = () => {
    // a reply still being written would change the goals and XP after the summary
    if (send.isPending) return;
    end.mutate(conversation.id, {
      onSuccess: (s) => {
        sfx(s.goal_met ? 'complete' : 'page');
        onEnded(s);
      },
    });
  };

  const goals = conversation.subgoals;

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: theme.c.bg }}
      testID="chat-room"
    >
      <ScreenHeader
        title={name}
        onBack={onBack}
        backLabel={t('common.back')}
        trailing={
          <Button
            size="sm"
            variant="ghost"
            busy={end.isPending}
            disabled={send.isPending}
            onPress={finish}
            testID="chat-end"
          >
            {t('chat.end')}
          </Button>
        }
      />
      <View
        style={{
          width: '100%',
          maxWidth: CONTENT_MAX,
          alignSelf: 'center',
          paddingHorizontal: space['5'],
          gap: 8,
          paddingBottom: 8,
        }}
      >
        {/* the speaker is labelled an AI wherever it speaks (docs/16 E21 ethics check) */}
        <View style={{ flexDirection: 'row' }} testID="chat-ai-label">
          <Chip icon="bulb" tone={accent} size="sm">
            {t('chat.aiCharacter')}
          </Chip>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {goals.map((g) => {
            const done = met.includes(g.id);
            return (
              <View
                key={g.id}
                testID={`chat-goal-${g.id}`}
                accessible
                accessibilityLabel={t(done ? 'chat.goalDone' : 'chat.goalOpen', { goal: g.text })}
                accessibilityState={{ checked: done }}
              >
                <Chip
                  icon={done ? 'check' : 'target'}
                  tone={done ? 'success' : undefined}
                  size="sm"
                >
                  {g.text}
                </Chip>
              </View>
            );
          })}
        </View>
        <Txt variant="caption" color="ink-3" testID="chat-turn">
          {t('chat.turn', { n: turn, max: conversation.max_turns })}
        </Txt>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{
            width: '100%',
            maxWidth: CONTENT_MAX,
            alignSelf: 'center',
            paddingHorizontal: space['5'],
            gap: 12,
            paddingBottom: 16,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((m) =>
            m.role === 'character' ? (
              <CharacterBubble
                key={m.key}
                id={conversation.character_id}
                name={name}
                message={m}
                accent={accent}
                onRecast={setExplain}
              />
            ) : (
              <LearnerBubble key={m.key} message={m} />
            ),
          )}
          {send.isPending ? <Typing id={conversation.character_id} name={name} /> : null}
          {explain ? (
            <View accessibilityLiveRegion="polite">
              <Notice icon="bulb" tone="primary" title={t('chat.recastTitle')}>
                <Txt variant="body-m" lang="en" testID="chat-explain">
                  {t('chat.recast', { said: explain.original, better: explain.corrected })}
                </Txt>
              </Notice>
            </View>
          ) : null}
          {goalPrompt === 'shown' && !over ? (
            <View accessibilityLiveRegion="polite" testID="chat-goal-prompt">
              <Notice icon="flag" tone="green" title={t('chat.goalReached')}>
                <View style={{ gap: 8 }}>
                  <Txt variant="body-m">{t('chat.goalReachedPrompt')}</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Button
                      size="sm"
                      icon="flag"
                      busy={end.isPending}
                      disabled={send.isPending}
                      onPress={finish}
                      testID="chat-goal-finish"
                    >
                      {t('chat.seeSummary')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => setGoalPrompt('dismissed')}
                      testID="chat-goal-continue"
                    >
                      {t('chat.keepChatting')}
                    </Button>
                  </View>
                </View>
              </Notice>
            </View>
          ) : null}
          {over ? (
            <Notice icon="flag" tone="green" title={t('chat.overTitle')}>
              {t('chat.over')}
            </Notice>
          ) : null}
          {failed ? (
            <View style={{ gap: 8 }}>
              <ProblemNotice problem={asProblem(failed.error)} />
              <Button
                variant="secondary"
                size="sm"
                icon="refresh"
                disabled={send.isPending}
                onPress={() => deliver(failed)}
                testID="chat-retry"
              >
                {t('common.tryAgain')}
              </Button>
            </View>
          ) : null}
          {end.error ? <ProblemNotice problem={asProblem(end.error)} onRetry={finish} /> : null}
        </ScrollView>

        {help && conversation.starters.length ? (
          <View
            style={{
              width: '100%',
              maxWidth: CONTENT_MAX,
              alignSelf: 'center',
              paddingHorizontal: space['5'],
              gap: 6,
              paddingBottom: 6,
            }}
            testID="chat-starters"
          >
            <Txt variant="caption" color="ink-3">
              {t('chat.helpTitle')}
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {conversation.starters.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => {
                    setDraft(s);
                    setHelp(false);
                  }}
                  accessibilityRole="button"
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: radius.full,
                    backgroundColor: theme.c['primary-soft'],
                  }}
                >
                  <Txt variant="body-s" weight={800} color="primary-ink" lang="en">
                    {s}
                  </Txt>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {over ? (
          <View
            style={{
              width: '100%',
              maxWidth: CONTENT_MAX,
              alignSelf: 'center',
              paddingHorizontal: space['5'],
              paddingBottom: space['4'],
            }}
          >
            <Button
              size="lg"
              icon="flag"
              busy={end.isPending}
              onPress={finish}
              testID="chat-finish"
            >
              {t('chat.seeSummary')}
            </Button>
          </View>
        ) : (
          <View
            style={{
              width: '100%',
              maxWidth: CONTENT_MAX,
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 8,
              paddingHorizontal: space['4'],
              paddingVertical: space['3'],
              borderTopWidth: 1,
              borderColor: theme.c.line,
            }}
          >
            {conversation.starters.length ? (
              <IconButton
                icon="bulb"
                label={t('chat.help')}
                onPress={() => setHelp((h) => !h)}
                testID="chat-help"
              />
            ) : null}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={theme.c['ink-4']}
              accessibilityLabel={t('chat.placeholder')}
              maxLength={MAX_CHARS}
              multiline
              autoCapitalize="sentences"
              autoCorrect={false}
              onSubmitEditing={submit}
              blurOnSubmit
              testID="chat-input"
              style={{
                flex: 1,
                minHeight: 48,
                maxHeight: 120,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderColor: theme.c['line-2'],
                backgroundColor: theme.c['surface-2'],
                color: theme.c.ink,
                fontFamily: theme.font('learn', 400),
                fontSize: 17,
              }}
            />
            <IconButton
              icon="arrow-right"
              variant="primary"
              label={t('chat.send')}
              onPress={submit}
              disabled={!draft.trim() || send.isPending || !!failed}
              testID="chat-send"
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CharacterBubble({
  id,
  name,
  message,
  accent,
  onRecast,
}: {
  id: string;
  name: string;
  message: Message;
  accent: ReturnType<typeof castTone>;
  onRecast: (r: RecastOut) => void;
}) {
  const theme = useTheme();
  const ink = tone(theme, 'primary').ink;
  // Split the reply around the underlined recast spans, in order. The server counts the offsets
  // in UTF-16 code units, which is what String.slice counts.
  const parts = useMemo(() => {
    const spans = message.recasts
      .filter(
        (r): r is RecastOut & { start: number; end: number } =>
          r.start != null && r.end != null && r.start < r.end && r.end <= message.text.length,
      )
      .sort((a, b) => a.start - b.start);
    const out: { text: string; recast?: RecastOut }[] = [];
    let at = 0;
    for (const r of spans) {
      if (r.start < at) continue;
      if (r.start > at) out.push({ text: message.text.slice(at, r.start) });
      out.push({ text: message.text.slice(r.start, r.end), recast: r });
      at = r.end;
    }
    if (at < message.text.length) out.push({ text: message.text.slice(at) });
    return out;
  }, [message]);
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', maxWidth: '88%' }}>
      <CastPortrait id={id} size={36} />
      <View
        style={{
          flexShrink: 1,
          gap: 2,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 18,
          borderBottomStartRadius: 4,
          backgroundColor: theme.c['surface-2'],
          borderWidth: 2,
          borderColor: tone(theme, accent).soft,
        }}
      >
        <Txt variant="caption" weight={800} rawColor={tone(theme, accent).ink}>
          {name}
        </Txt>
        <Txt variant="learn-m" lang="en" testID="chat-reply">
          {parts.map((p, i) =>
            p.recast ? (
              <Txt
                key={i}
                variant="learn-m"
                lang="en"
                rawColor={ink}
                style={{ textDecorationLine: 'underline' }}
                onPress={() => onRecast(p.recast as RecastOut)}
                // a nested Text is reachable by TalkBack only as a link (Android makes no
                // accessible span for role "button"); VoiceOver lists both
                accessibilityRole="link"
                testID="chat-recast"
              >
                {p.text}
              </Txt>
            ) : (
              p.text
            ),
          )}
        </Txt>
      </View>
    </View>
  );
}

function LearnerBubble({ message }: { message: Message }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '85%', gap: 2 }}>
      <View
        style={{
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 18,
          borderBottomEndRadius: 4,
          backgroundColor: theme.c['primary-soft'],
          opacity: message.pending && !message.failed ? 0.75 : 1,
        }}
      >
        <Txt variant="learn-m" lang="en" testID="chat-mine">
          {message.text}
        </Txt>
      </View>
      {message.failed ? (
        <Txt variant="caption" color="danger-ink" align="right">
          {t('chat.notSent')}
        </Txt>
      ) : null}
    </View>
  );
}

/** The character "is typing": the portrait talks every 300 ms; with reduced motion, a still "…". */
function Typing({ id, name }: { id: string; name: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (theme.reduceMotion) return;
    const timer = setInterval(() => setOpen((o) => !o), 300);
    return () => clearInterval(timer);
  }, [theme.reduceMotion]);
  return (
    <View
      style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('chat.typing', { name })}
      testID="chat-typing"
    >
      <CastPortrait id={id} size={36} expression={open ? 'talk' : 'smile'} />
      <Txt variant="title-m" color="ink-3">
        …
      </Txt>
    </View>
  );
}

// ------------------------------------------------------------------- the end card

function ChatSummary({
  summary,
  conversation,
  name,
  header,
  onAgain,
  onDone,
}: {
  summary: SummaryOut;
  conversation: ConversationOut;
  name: string;
  header: ReactNode;
  onAgain: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const remove = useDeleteConversation();
  const lexicon = useLexicon(summary.focus_items.length > 0);
  const saved = useLearner((s) => s.data.savedWords);
  const toggleSaved = useLearner((s) => s.toggleSavedWord);
  return (
    <Screen header={header} testID="chat-summary">
      <Card>
        <View style={{ alignItems: 'center', gap: space['3'] }}>
          <CastPortrait id={conversation.character_id} size={96} label={name} />
          <Txt
            variant="display-m"
            align="center"
            accessibilityRole="header"
            testID="chat-summary-title"
          >
            {summary.goal_met ? t('chat.goalReached') : t('chat.goodPractice')}
          </Txt>
          <View
            style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}
          >
            <Chip icon="chat" size="sm">
              {t('chat.turns', { count: summary.turns })}
            </Chip>
            {summary.xp > 0 ? (
              <Chip icon="bolt" tone="xp" size="sm">
                {t('chat.xp', { xp: summary.xp })}
              </Chip>
            ) : null}
          </View>
        </View>
      </Card>

      {conversation.subgoals.length ? (
        <Card>
          <SectionTitle>{t('chat.goals')}</SectionTitle>
          {conversation.subgoals.map((g) => {
            const done = summary.subgoals_met.includes(g.id);
            return (
              <View
                key={g.id}
                style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
                accessible
                accessibilityLabel={t(done ? 'chat.goalDone' : 'chat.goalOpen', { goal: g.text })}
                testID={`chat-summary-goal-${g.id}`}
              >
                <Icon name={done ? 'check-circle' : 'target'} size={22} />
                <Txt variant="body-m" lang="en" color={done ? 'ink' : 'ink-3'} style={{ flex: 1 }}>
                  {g.text}
                </Txt>
              </View>
            );
          })}
        </Card>
      ) : null}

      {summary.focus_items.length ? (
        <Card>
          <SectionTitle>{t('chat.workOn')}</SectionTitle>
          {lexicon.data &&
          summary.focus_items.some(
            (f) => lexicon.data && focusWords(f.original, f.corrected, lexicon.data).length,
          ) ? (
            <Txt variant="body-s" color="ink-3">
              {t('chat.saveHint')}
            </Txt>
          ) : null}
          {summary.focus_items.map((f) => {
            // the course words the correction brought in can be kept, like words from a story
            const keep = lexicon.data ? focusWords(f.original, f.corrected, lexicon.data) : [];
            return (
              <View key={`${f.original}|${f.corrected}`} style={{ gap: 2 }} testID="chat-focus">
                <Txt
                  variant="body-s"
                  color="ink-3"
                  lang="en"
                  style={{ textDecorationLine: 'line-through' }}
                >
                  {f.original}
                </Txt>
                <Txt variant="learn-m" lang="en" weight={700}>
                  {f.corrected}
                </Txt>
                {keep.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
                    {keep.map((w) => {
                      const on = saved.some((x) => x.lexemeId === w.id);
                      return (
                        <Pressable
                          key={w.id}
                          onPress={() => toggleSaved({ lexemeId: w.id, lemma: w.lemma })}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={
                            on
                              ? t('chat.savedWord', { word: w.lemma })
                              : t('chat.saveWord', { word: w.lemma })
                          }
                          style={{ minHeight: 44, justifyContent: 'center' }}
                          testID={`chat-save-${w.lemma}`}
                        >
                          <Chip
                            size="sm"
                            icon={on ? 'check' : 'plus'}
                            tone={on ? 'green' : undefined}
                          >
                            {w.lemma}
                          </Chip>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : (
        <Notice icon="star" tone="green">
          {t('chat.noCorrections')}
        </Notice>
      )}

      {summary.words_used.length ? (
        <Card>
          <SectionTitle>{t('chat.wordsUsed')}</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {summary.words_used.map((w) => (
              <Chip key={w} tone="lagoon" size="sm">
                {w}
              </Chip>
            ))}
          </View>
        </Card>
      ) : null}

      {remove.error ? <ProblemNotice problem={asProblem(remove.error)} /> : null}
      <Button size="lg" icon="refresh" onPress={onAgain} testID="chat-again">
        {t('chat.again')}
      </Button>
      <Button variant="secondary" onPress={onDone} testID="chat-done">
        {t('common.done')}
      </Button>
      <Button
        variant="ghost"
        icon="trash"
        busy={remove.isPending}
        onPress={() => remove.mutate(conversation.id, { onSuccess: onDone })}
        testID="chat-delete"
      >
        {t('chat.delete')}
      </Button>
    </Screen>
  );
}
