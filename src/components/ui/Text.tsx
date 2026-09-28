import { Text as RNText, TextProps, TextStyle } from 'react-native';

import { colors, type as typeScale } from '@/theme';

type Variant = keyof typeof typeScale;

interface Props extends TextProps {
  v?: Variant;
  color?: string;
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
}

/** Typographic primitive. Uses the iOS system font (SF Pro). */
export function T({ v = 'body', color = colors.ink, weight, align, style, ...rest }: Props) {
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={1.3}
      style={[typeScale[v], { color }, weight ? { fontWeight: weight } : null, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}
