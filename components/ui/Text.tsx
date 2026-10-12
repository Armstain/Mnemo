import React from 'react';
import { Platform, StyleSheet, Text as RNText, type TextProps } from 'react-native';

// Notes come in Bangla, English or both, and the app's fonts (Instrument
// Sans, Literata) have no Bangla letters. The web falls back letter by
// letter to the Noto Bengali faces listed in global.css. Phones don't: they
// draw Bangla in the system's compact UI font, small and cramped beside the
// Latin. So text that contains Bangla switches to the matching Noto Bengali
// face, with room for the marks above and below the line.
//
// A drop-in for react-native's Text; use it wherever the person's own
// words (or a mix) can appear.

const BENGALI = /[ঀ-৿]/;

/** True if any plain-text child contains Bangla letters. */
export function hasBangla(children: React.ReactNode): boolean {
  if (typeof children === 'string') return BENGALI.test(children);
  if (Array.isArray(children)) return children.some(hasBangla);
  return false;
}

const FACES: [RegExp, string][] = [
  [/\bfont-display\b/, 'NotoSerifBengali_500Medium'],
  [/\bfont-(?:serif|quote)\b/, 'NotoSerifBengali_400Regular'],
  [/\bfont-sans-semi\b/, 'NotoSansBengali_600SemiBold'],
  [/\bfont-sans-medium\b/, 'NotoSansBengali_500Medium'],
];

const SIZES: [RegExp, number][] = [
  [/\btext-display\b/, 34],
  [/\btext-title\b/, 26],
  [/\btext-heading\b/, 19],
  [/\btext-body\b/, 15],
  [/\btext-sm\b/, 13],
  [/\btext-xs\b/, 11],
  [/\btext-micro\b/, 10],
];

function faceFor(className: string | undefined, fontFamily: unknown): string {
  if (typeof fontFamily === 'string' && fontFamily.startsWith('Noto')) return fontFamily;
  if (typeof fontFamily === 'string') {
    if (fontFamily.startsWith('Literata_500')) return 'NotoSerifBengali_500Medium';
    if (fontFamily.startsWith('Literata')) return 'NotoSerifBengali_400Regular';
    if (fontFamily.includes('600')) return 'NotoSansBengali_600SemiBold';
    if (fontFamily.includes('500')) return 'NotoSansBengali_500Medium';
  }
  for (const [re, face] of FACES) if (className && re.test(className)) return face;
  return 'NotoSansBengali_400Regular';
}

/** Bangla needs about half its size again between lines. */
export const BANGLA_LINE = 1.5;

export const Text = React.forwardRef<RNText, TextProps & { className?: string }>(function Text(props, ref) {
  if (Platform.OS === 'web' || !hasBangla(props.children)) return <RNText ref={ref} {...props} />;
  const flat = (StyleSheet.flatten(props.style) ?? {}) as { fontSize?: number; lineHeight?: number; fontFamily?: string };
  const size = flat.fontSize ?? SIZES.find(([re]) => props.className && re.test(props.className))?.[1] ?? 15;
  const lineHeight = Math.max(flat.lineHeight ?? 0, Math.round(size * BANGLA_LINE));
  return (
    <RNText
      ref={ref}
      {...props}
      style={[props.style, { fontFamily: faceFor(props.className, flat.fontFamily), fontStyle: 'normal', lineHeight }]}
    />
  );
});
