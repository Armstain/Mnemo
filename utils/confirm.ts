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
  /** For a question rather than a warning: names the "no", and it isn't red. */
  cancelLabel?: string;
  onCancel?: () => void;
}): void {
  const { title, message, confirmLabel, onConfirm, cancelLabel, onCancel } = options;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    else onCancel?.();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel ?? 'Cancel', style: 'cancel', onPress: onCancel },
    { text: confirmLabel, style: cancelLabel ? 'default' : 'destructive', onPress: onConfirm },
  ]);
}
