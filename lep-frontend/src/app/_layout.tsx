import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStatus } from '@/api/queries/me';
import { queryClient } from '@/api/queryClient';
import { ThemeProvider, useTheme } from '@/design';
import { FONT_FILES } from '@/design/fonts';
import { OfflineBanner, RouteErrorBoundary } from '@/features/errors';
import { useCosmeticSync } from '@/features/settings/useCosmeticSync';
import { useBootstrap } from '@/features/useBootstrap';
import { initI18n, RTL_LANGUAGES } from '@/i18n';
import { log } from '@/lib/log';
import { usePrefs } from '@/state/prefs';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export const ErrorBoundary = RouteErrorBoundary;


function Navigator() {
  useBootstrap();
  useCosmeticSync();
  const status = useAuthStatus();
  const theme = useTheme();
  const ready = status !== 'restoring';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready) return null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.c.bg }}>
      <StatusBar style={theme.name === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.c.bg } }}>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="unit/[unitId]" />
          <Stack.Screen name="lesson/[sessionId]" options={{ gestureEnabled: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="story/[textId]" />
          <Stack.Screen name="settings/[page]" />
          <Stack.Screen name="first-sentence" options={{ gestureEnabled: false }} />
          <Stack.Screen name="test-out/[unitId]" options={{ gestureEnabled: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="exam/[level]" options={{ gestureEnabled: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="writing/[level]" />
          <Stack.Screen name="audit" options={{ gestureEnabled: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="placement" options={{ gestureEnabled: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="review" options={{ gestureEnabled: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="shop" />
          <Stack.Screen name="chat/[characterId]" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* the reset letter's link opens whether or not someone is signed in here */}
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="arcade" />
      </Stack>
      <OfflineBanner />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const hydrated = usePrefs((s) => s.hydrated);
  const language = usePrefs((s) => s.interfaceLanguage);
  const themePref = usePrefs((s) => s.theme);
  const dyslexia = usePrefs((s) => s.dyslexiaFont);
  const reduceMotion = usePrefs((s) => s.reduceMotion);
  const accent = usePrefs((s) => s.accent);
  const i18n = useMemo(() => initI18n(language), [language]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.lang = language.startsWith('pseudo') ? 'en' : language;
      document.documentElement.dir = RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
    }
  }, [language]);

  useEffect(() => {
    // The system fonts are an acceptable fallback: a font that fails or times out (the web's
    // loader gives up after 12 s and never retries) must not leave a blank page.
    if (fontError) log.warn('fonts.load_failed', { error: String(fontError) });
  }, [fontError]);

  if (!(fontsLoaded || fontError) || !hydrated) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <ThemeProvider preference={themePref} face={dyslexia ? 'lexend' : 'nunito'} reduceMotionPreference={reduceMotion} accent={accent}>
              <Navigator />
            </ThemeProvider>
          </I18nextProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
