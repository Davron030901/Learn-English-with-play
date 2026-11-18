import * as Clipboard from 'expo-clipboard';
import { router, type ErrorBoundaryProps } from 'expo-router';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, isKnownProblemType, toApiProblem, type ApiProblem } from '@/api/problem';
import { AuthEndedError } from '@/api/session';
import { Button, Icon, Mascot, Notice, Screen, TextLink, Txt, useTheme } from '@/design';
import { log } from '@/lib/log';
import { isOnline, useOnlineStore } from '@/state/online';

/**
 * The one error surface (DECISIONS §7.2): copy is chosen by the problem's `type`, never from
 * `title` or `detail`; every error shows its request id with a copy button; an unknown type gets
 * generic copy. A 503 on sign-in is never "wrong password" (brief §4.3).
 */
export function problemMessage(
  t: TFunction,
  problem: ApiProblem,
  context: 'auth' | 'app' = 'app',
): string {
  const type = problem.type;
  if (type === 'dependency_unavailable' && context === 'auth')
    return t('errors.dependency_unavailable_auth');
  if (type === 'rate_limited')
    return t('errors.rate_limited', { seconds: problem.retryAfterS ?? 0 });
  if (isKnownProblemType(type) && problem.reason) {
    // a refusal with a reason the app has words for: said exactly; any other reason, generally
    const specific = t(`errors.${type}_${problem.reason}`, { defaultValue: '' });
    if (specific) return specific;
  }
  if (isKnownProblemType(type)) return t(`errors.${type}`);
  return t('errors.generic');
}

export function asProblem(e: unknown): ApiProblem {
  if (e instanceof ApiError) return e.problem;
  if (e instanceof AuthEndedError)
    return { type: 'invalid_token', status: 401, requestId: null, errors: [], retryAfterS: null };
  return toApiProblem(e);
}

export function RequestId({ id }: { id: string | null }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!id) return null;
  return (
    <View style={{ gap: 4 }}>
      <Txt variant="caption" color="ink-3" selectable>
        {t('errors.requestId', { id })}
      </Txt>
      <TextLink
        icon={copied ? 'check' : 'share'}
        onPress={() => {
          void Clipboard.setStringAsync(id).then(() => setCopied(true));
        }}
        accessibilityHint={t('errors.reportHelp')}
      >
        {copied ? t('common.copied') : t('errors.reportThis')}
      </TextLink>
    </View>
  );
}

/** An inline error block: our copy for the type, the request id, and an optional retry. */
export function ProblemNotice({
  problem,
  context = 'app',
  onRetry,
  testID,
}: {
  problem: ApiProblem;
  context?: 'auth' | 'app';
  onRetry?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <View accessibilityLiveRegion="polite" testID={testID} style={{ gap: 8 }}>
      <Notice icon="warning" tone="red">
        {problemMessage(t, problem, context)}
      </Notice>
      <RequestId id={problem.requestId} />
      {onRetry ? (
        <Button variant="secondary" size="sm" icon="refresh" onPress={onRetry}>
          {t('common.tryAgain')}
        </Button>
      ) : null}
    </View>
  );
}

/** Shown under every screen while the app is offline. Honest, calm, never a spinner. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnlineStore(isOnline);
  if (online) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      testID="offline-banner"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 16,
        backgroundColor: theme.c['orange-soft'],
      }}
    >
      <Icon name="warning" size={18} color={theme.c['orange-ink']} />
      <Txt variant="body-s" weight={700} rawColor={theme.c['orange-ink']} style={{ flex: 1 }}>
        {t('offline.banner')}
      </Txt>
    </View>
  );
}

/** The full-screen offline state (Phase 1 acceptance A6): what happened, nothing lost, retry. */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View testID="offline-screen" style={{ gap: 16, alignItems: 'center', paddingVertical: 24 }}>
      <Mascot pose="think" size={120} />
      <Txt variant="title-l" align="center" accessibilityRole="header">
        {t('offline.title')}
      </Txt>
      <Txt variant="body-l" color="ink-2" align="center">
        {t('offline.body')}
      </Txt>
      <Button icon="refresh" onPress={onRetry}>
        {t('offline.retry')}
      </Button>
    </View>
  );
}

/**
 * expo-router error boundary, exported by the root layout and by the heavier routes. It never
 * shows a stack trace; the error goes to the redacted local log only.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  log.error('ui.render_error', { name: error.name, message: error.message });
  return (
    <Screen>
      <View testID="error-boundary" style={{ gap: 16, alignItems: 'center', paddingTop: 48 }}>
        <Mascot pose="think" size={120} />
        <Txt variant="title-l" align="center" accessibilityRole="header">
          {t('errors.boundaryTitle')}
        </Txt>
        <Txt variant="body-l" color="ink-2" align="center">
          {t('errors.boundaryBody')}
        </Txt>
        <Button icon="refresh" onPress={() => void retry()}>
          {t('common.tryAgain')}
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
        >
          {t('errors.boundaryHome')}
        </Button>
      </View>
    </Screen>
  );
}
