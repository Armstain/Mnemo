import { useEffect, useState } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

/**
 * How far the keyboard covers the bottom of `ref`'s view, so a bar docked
 * at its bottom can sit just above it. Measured, not assumed: on phones
 * where the window already shrinks for the keyboard this is 0, and with
 * Android's edge-to-edge (where it doesn't) it's the overlap. 0 on the web.
 */
export function useKeyboardInset(ref: React.RefObject<View | null>): { inset: number; open: boolean; lastHeight: number } {
  const [inset, setInset] = useState(0);
  const [open, setOpen] = useState(false);
  // The keyboard's last height, so a panel opened in its place is as tall.
  const [lastHeight, setLastHeight] = useState(300);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      const top = e.endCoordinates.screenY;
      setLastHeight(e.endCoordinates.height);
      setOpen(true);
      const view = ref.current;
      if (!view) return setInset(e.endCoordinates.height);
      view.measureInWindow((_x, y, _w, h) => setInset(Math.max(0, y + h - top)));
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      setOpen(false);
      setInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ref]);

  return { inset, open, lastHeight };
}
