import { Stack } from 'expo-router';

import { useTheme } from '@/design';

export const unstable_settings = { initialRouteName: 'welcome' };

export default function AuthLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.c.bg } }} />;
}
