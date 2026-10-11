import { Platform, type TextStyle } from 'react-native';

/**
 * Removes the browser's default focus outline from a TextInput on web,
 * where it draws an orange box inside our own styled field. Native has no
 * such outline, so this is a no-op there.
 */
export const noFocusRing: TextStyle | null =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;
