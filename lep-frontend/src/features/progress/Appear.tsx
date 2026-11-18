import type { ReactNode } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useTheme } from '@/design';

/**
 * Server figures fade in when they arrive (320 ms, the motion system's "slow"), so a number
 * never pops. A fade is all it does, so it stays with reduced motion too (shorter).
 */
export function Appear({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(theme.reduceMotion ? 120 : 320)} testID={testID}>
      {children}
    </Animated.View>
  );
}
