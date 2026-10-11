import React from 'react';
import { TextInput, View } from 'react-native';

import { Eyebrow } from '@/components/ui/Eyebrow';
import { useThemeColors } from '@/hooks/use-theme';
import { noFocusRing } from '@/utils/web';

interface LabeledInputProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}

/** A labelled single field — the same look on every form in the app. */
export function LabeledInput({ label, value, onChangeText, placeholder, multiline = true }: LabeledInputProps) {
  const colors = useThemeColors();
  return (
    <View>
      <Eyebrow className="mb-2">{label}</Eyebrow>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.fgTertiary}
        selectionColor={colors.accent}
        multiline={multiline}
        className="font-sans text-body rounded-sm px-4 py-3"
        style={[
          { color: colors.fg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
          noFocusRing,
        ]}
      />
    </View>
  );
}
