import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Txt, radius, useTheme } from '@/design';

/** The bottom sheet the HUD opens (the NodeSheet's shape): a scrim that closes, a header, a body. */
export function BottomSheet({
  title,
  overline,
  onClose,
  children,
  testID,
}: {
  title: string;
  overline?: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible animationType={theme.reduceMotion ? 'fade' : 'slide'} onRequestClose={onClose}>
      <Pressable accessibilityLabel={t('common.close')} onPress={onClose} style={{ flex: 1, backgroundColor: theme.c.scrim }} />
      <View
        testID={testID}
        accessibilityViewIsModal
        style={{
          maxHeight: '86%',
          backgroundColor: theme.c.surface,
          borderTopStartRadius: radius.xl,
          borderTopEndRadius: radius.xl,
          paddingTop: 16,
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 20),
          boxShadow: theme.floatShadow,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingBottom: 8 }}>
          <View style={{ flex: 1, gap: 2 }}>
            {overline ? (
              <Txt variant="overline" color="ink-3">
                {overline}
              </Txt>
            ) : null}
            <Txt variant="title-l" accessibilityRole="header">
              {title}
            </Txt>
          </View>
          <IconButton icon="close" label={t('common.close')} onPress={onClose} testID={testID ? `${testID}-close` : undefined} />
        </View>
        <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 4 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}
