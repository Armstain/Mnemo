import { Alert, Platform } from 'react-native';

/**
 * Asks before doing something that can't be undone. Alert's buttons don't
 * render on the web, so the browser's own confirm() asks there.
 */
export function confirmAction(options: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}): void {
  const { title, message, confirmLabel, onConfirm } = options;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
