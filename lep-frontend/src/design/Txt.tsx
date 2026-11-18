import { forwardRef } from 'react';
import { Platform, Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from './theme';
import { typeStyles, type ColorToken, type TypeStyle } from './tokens.generated';

export interface TxtProps extends TextProps {
  /** A type token from the design system (display-l, title-m, body-m, learn-l, ipa …). */
  variant?: TypeStyle;
  color?: ColorToken;
  /** Override the colour with a resolved value (tone ink etc.); prefer `color`. */
  rawColor?: string;
  weight?: number;
  align?: TextStyle['textAlign'];
  /**
   * Language of the text. English being *taught* is always `en` (and uses Andika); a screen
   * reader switches voice on web (`lang`) and iOS (`accessibilityLanguage`) — DECISIONS §7.7.
   */
  lang?: string;
}

/** The only Text the app uses: type tokens, colour tokens, the ui/learn font switch. */
export const Txt = forwardRef<Text, TxtProps>(function Txt(
  { variant = 'body-m', color = 'ink', rawColor, weight, align, lang, style, ...rest },
  ref,
) {
  const theme = useTheme();
  const t = typeStyles[variant];
  const w = weight ?? t.weight;
  const base: TextStyle = {
    fontFamily: theme.font(t.family, w),
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    color: rawColor ?? theme.c[color],
    textAlign: align,
    ...(t.uppercase ? { textTransform: 'uppercase' } : null),
  };
  const langProps: Record<string, string> = {};
  if (lang) {
    if (Platform.OS === 'web') langProps.lang = lang;
    else if (Platform.OS === 'ios') langProps.accessibilityLanguage = lang;
  }
  return <Text ref={ref} {...rest} {...langProps} style={[base, style]} />;
});
