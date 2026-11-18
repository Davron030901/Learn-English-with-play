import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/design';
import { initI18n } from '@/i18n';

const i18n = initI18n('en');

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

const clients: QueryClient[] = [];

export function newQueryClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return client;
}

// Queries keep garbage-collection timers (useMe sets its own five-minute gcTime); clearing the
// clients after each test lets Jest exit as soon as the tests are done.
afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
});

/** Renders inside the app's providers: safe area, i18n (English), theme (light, reduced motion). */
export function renderUI(ui: ReactElement, queryClient: QueryClient = newQueryClient()) {
  // The providers go in as RNTL's `wrapper`, so `rerender` keeps them. RNTL 14: render is async.
  function Providers({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <ThemeProvider preference="light" face="nunito" reduceMotionPreference>
              {children}
            </ThemeProvider>
          </I18nextProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  }
  return render(ui, { wrapper: Providers });
}
