import React from 'react';
import { Platform, StyleSheet, TextInput as RNTextInput, type TextInputProps } from 'react-native';

import { BANGLA_LINE, hasBangla } from '@/components/ui/Text';

// The TextInput counterpart of components/ui/Text: while what's typed
// contains Bangla, phones draw it in Noto Sans Bengali rather than the
// cramped system face.

export const TextInput = React.forwardRef<RNTextInput, TextInputProps & { className?: string }>(
  function TextInput(props, ref) {
    const value = props.value ?? props.defaultValue ?? '';
    if (Platform.OS === 'web' || !hasBangla(value)) return <RNTextInput ref={ref} {...props} />;
    const flat = (StyleSheet.flatten(props.style) ?? {}) as { fontSize?: number; lineHeight?: number };
    const size = flat.fontSize ?? 15;
    return (
      <RNTextInput
        ref={ref}
        {...props}
        style={[
          props.style,
          {
            fontFamily: 'NotoSansBengali_400Regular',
            ...(props.multiline ? { lineHeight: Math.max(flat.lineHeight ?? 0, Math.round(size * BANGLA_LINE)) } : {}),
          },
        ]}
      />
    );
  },
);
