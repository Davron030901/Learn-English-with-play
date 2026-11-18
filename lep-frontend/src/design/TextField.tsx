import { forwardRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Txt } from './Txt';
import { useTheme } from './theme';
import { radius } from './tokens.generated';

/**
 * Added to the design system (DECISIONS F9): the system has no text input. Built from its
 * tokens: surface-2 fill, 2 px line-2 border, radius-sm, the focus ring, danger for errors.
 * The error message is announced (live region) and never repeats the value that was typed.
 */
export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string | null;
  secure?: boolean;
  /** English the learner is producing: Andika, lang="en". */
  learn?: boolean;
  testID?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, secure, learn, testID, onFocus, onBlur, ...rest },
  ref,
) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const border = error ? theme.c.danger : focused ? theme.c.primary : theme.c['line-2'];
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="body-m" weight={800} nativeID={testID ? `${testID}-label` : undefined}>
        {label}
      </Txt>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
          borderRadius: radius.sm,
          borderWidth: 2,
          borderColor: border,
          backgroundColor: theme.c['surface-2'],
          boxShadow: focused ? theme.focusRing : 'none',
        }}
      >
        <TextInput
          ref={ref}
          {...rest}
          testID={testID}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          secureTextEntry={secure && !reveal}
          placeholderTextColor={theme.c['ink-4']}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...(learn ? ({ lang: 'en' } as object) : {})}
          style={{
            flex: 1,
            minHeight: 48,
            paddingHorizontal: 14,
            paddingVertical: 10,
            color: theme.c.ink,
            fontFamily: theme.font(learn ? 'learn' : 'ui', learn ? 400 : 600),
            fontSize: learn ? 20 : 17,
            outlineStyle: 'none',
          } as object}
        />
        {secure ? (
          <Pressable
            onPress={() => setReveal((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={reveal ? t('common.hidePassword') : t('common.showPassword')}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="eye" size={22} color={theme.c['ink-3']} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
          <Icon name="warning" size={18} color={theme.c['danger-ink']} />
          <Txt variant="body-s" color="danger-ink" style={{ flex: 1 }}>
            {error}
          </Txt>
        </View>
      ) : hint ? (
        <Txt variant="body-s" color="ink-3">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
});
