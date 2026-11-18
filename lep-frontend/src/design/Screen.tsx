import { type ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { IconButton } from './Button';
import { Txt } from './Txt';
import { useTheme } from './theme';
import { space } from './tokens.generated';

/** App content column: phone gutters (space-5), centred and capped on wide screens. */
export const CONTENT_MAX = 720;

export function Screen({
  children,
  scroll = true,
  edges = ['top', 'bottom'],
  background = 'bg',
  contentStyle,
  footer,
  header,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  background?: 'bg' | 'bg-soft';
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactNode;
  header?: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const inner = (
    <View style={[{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: space['5'], gap: space['5'] }, contentStyle]}>
      {children}
    </View>
  );
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: theme.c[background] }} testID={testID}>
      {header}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: space['4'], paddingBottom: space['10'] }}
          keyboardShouldPersistTaps="handled"
        >
          {inner}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: space['4'] }}>{inner}</View>
      )}
      {footer ? (
        <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', paddingHorizontal: space['5'], paddingBottom: space['4'] }}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** A plain screen header: back button, title, optional trailing slot. */
export function ScreenHeader({
  title,
  onBack,
  backLabel,
  trailing,
}: {
  title?: string;
  onBack?: () => void;
  backLabel: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={{ width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space['2'], paddingTop: space['2'] }}>
      {onBack ? <IconButton icon="arrow-left" label={backLabel} onPress={onBack} testID="back" /> : <View style={{ width: 44 }} />}
      <Txt variant="title-s" style={{ flex: 1 }} numberOfLines={1} accessibilityRole="header">
        {title ?? ''}
      </Txt>
      {trailing}
    </View>
  );
}
