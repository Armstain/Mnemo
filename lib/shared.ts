import { Platform } from 'react-native';

// What another app just shared in, handed from the share listener
// (components/ShareIntake) to the Save screen (app/share.tsx).

export interface IncomingShare {
  text?: string;
  url?: string;
  /** The page title the other app sent along, if any. */
  title?: string;
  /** Local copies of shared photos, as the share gave them. */
  photos: { uri: string; mimeType?: string }[];
}

let pending: IncomingShare | null = null;

export function setIncomingShare(share: IncomingShare): void {
  pending = share;
}

/** Takes the waiting share (once). */
export function takeIncomingShare(): IncomingShare | null {
  const share = pending ?? testShare();
  pending = null;
  return share;
}

// Lets the web build's tests stand in for a share sheet: a share put in
// sessionStorage survives the page load that opens the Save screen.
function testShare(): IncomingShare | null {
  if (!__DEV__ || Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem('mnemo-test-share');
  sessionStorage.removeItem('mnemo-test-share');
  return raw ? (JSON.parse(raw) as IncomingShare) : null;
}
