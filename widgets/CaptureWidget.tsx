import React from 'react';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

// The home-screen widget: what to pick up next, and one tap to record or
// write. Drawn by Android from this description (no React Native views);
// colours are the app's palette, written out.

export interface WidgetSnapshot {
  id?: string;
  title?: string;
  nextStep?: string;
  /** This install's launch key (lib/launch-key), so Record starts listening. */
  launchKey?: string;
}

const THEMES = {
  light: { bg: '#FAF8F3', fg: '#1C1A15', muted: '#6B665B', accent: '#0D6B4A', ink: '#FFFFFF', chip: '#EAE5DA' },
  dark: { bg: '#121310', fg: '#ECE9E0', muted: '#9A978C', accent: '#5DDBA0', ink: '#00301C', chip: '#262822' },
} as const;

const micSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
const penSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;

function Button({ label, svg, uri, bg, fg }: { label: string; svg: string; uri: string; bg: string; fg: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{
        flex: 1,
        height: 44,
        borderRadius: 22,
        backgroundColor: bg as `#${string}`,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SvgWidget svg={svg} style={{ width: 18, height: 18 }} />
      <TextWidget text={label} style={{ fontSize: 15, fontWeight: '600', color: fg as `#${string}`, marginLeft: 8 }} />
    </FlexWidget>
  );
}

function Widget({ snapshot, theme }: { snapshot: WidgetSnapshot; theme: keyof typeof THEMES }) {
  const c = THEMES[theme];
  const hasThread = !!snapshot.id && !!snapshot.title;
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: c.bg,
        borderRadius: 24,
        padding: 16,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: hasThread ? `mnemo:///context?id=${snapshot.id}` : 'mnemo:///' }}
        style={{ width: 'match_parent', flexDirection: 'column' }}
      >
        <TextWidget
          text={hasThread ? 'PICK UP' : 'MNEMO'}
          style={{ fontSize: 11, fontWeight: '600', color: c.accent, letterSpacing: 0.08 }}
        />
        <TextWidget
          text={hasThread ? snapshot.title! : 'Nothing in progress'}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 17, fontWeight: '600', color: c.fg, marginTop: 2 }}
        />
        <TextWidget
          text={hasThread ? (snapshot.nextStep ? `Next: ${snapshot.nextStep}` : 'Open it to see where you left off') : 'Say or write what you’re on'}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 13, color: c.muted, marginTop: 2 }}
        />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 8 }}>
        <Button label="Record" svg={micSvg(c.ink)} uri={snapshot.launchKey ? `mnemo:///dump?autostart=1&key=${snapshot.launchKey}` : 'mnemo:///dump'} bg={c.accent} fg={c.ink} />
        <Button label="Write" svg={penSvg(c.fg)} uri="mnemo:///capture" bg={c.chip} fg={c.fg} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** Light and dark, so Android can follow the phone's theme. */
export function renderCaptureWidget(snapshot: WidgetSnapshot) {
  return { light: <Widget snapshot={snapshot} theme="light" />, dark: <Widget snapshot={snapshot} theme="dark" /> };
}
