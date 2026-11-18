import type { BottomTabBarProps } from 'expo-router/tabs';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type PressableStateCallbackType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Txt, useTheme, type IconName } from '@/design';
import { useOnboarding } from '@/state/onboarding';

type State = PressableStateCallbackType & { focused?: boolean };

const TABS: readonly { name: string; icon: IconName; label: string }[] = [
  { name: 'index', icon: 'route', label: 'tabs.learn' },
  { name: 'practice', icon: 'cards', label: 'tabs.practice' },
  { name: 'library', icon: 'library', label: 'tabs.library' },
  { name: 'progress', icon: 'chart', label: 'tabs.progress' },
  { name: 'profile', icon: 'user', label: 'tabs.me' },
];

/** The design system's TabBar: five tabs, the active one in a primary-soft pill. */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        paddingTop: 8,
        paddingHorizontal: 6,
        paddingBottom: Math.max(insets.bottom, 12),
        backgroundColor: theme.c.surface,
        borderTopWidth: 2,
        borderTopColor: theme.c.line,
      }}
    >
      {state.routes.map((route, i) => {
        const tab = TABS.find((x) => x.name === route.name);
        if (!tab) return null;
        const active = state.index === i;
        const color = active ? theme.c['primary-ink'] : theme.c['ink-3'];
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(tab.label)}
            testID={`tab-${route.name}`}
            onPress={() => {
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!active && !e.defaultPrevented) navigation.navigate(route.name);
            }}
            style={(s: State) => ({
              flex: 1,
              minHeight: 52,
              alignItems: 'center',
              gap: 3,
              borderRadius: 12,
              boxShadow: s.focused ? theme.focusRing : 'none',
            })}
          >
            <View style={{ width: 56, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.c['primary-soft'] : 'transparent' }}>
              <Icon name={tab.icon} size={26} color={color} />
            </View>
            <Txt variant="caption" weight={800} rawColor={color} style={{ fontSize: 11, lineHeight: 13 }} numberOfLines={1}>
              {t(tab.label)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const pending = useOnboarding((s) => s.pendingFirstSentence);
  if (pending) return <Redirect href="/first-sentence" />;
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}
