import { Stack } from 'expo-router';

import { useTheme } from '@/design';

export const unstable_settings = { initialRouteName: 'age' };

export default function OnboardingLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.c.bg } }} />;
}
