import React from 'react';
import { WebView } from 'react-native-webview';

import { mapHtml, type FromMap, type ToMap } from '@/lib/map-html';
import type { MapPickerProps } from '@/components/map/types';

/** The pin map on phones: the Leaflet page in a WebView (lib/map-html.ts). */
export function MapPicker({ initial, radius, others, goTo, colors, onCenter, onOffline }: MapPickerProps) {
  const ref = React.useRef<WebView>(null);
  const [ready, setReady] = React.useState(false);
  // Built once: later changes go in as messages, so the map never reloads.
  const html = React.useMemo(() => mapHtml({ ...initial, radius, ...colors }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const post = (m: ToMap) => ref.current?.postMessage(JSON.stringify(m));

  React.useEffect(() => void (ready && post({ type: 'radius', radius })), [ready, radius]);
  React.useEffect(() => void (ready && post({ type: 'others', places: others })), [ready, others]);
  React.useEffect(() => void (ready && goTo && post({ type: 'goto', lat: goTo.lat, lng: goTo.lng, zoom: goTo.zoom })), [ready, goTo]);

  return (
    <WebView
      ref={ref}
      originWhitelist={['*']}
      source={{ html, baseUrl: 'https://mnemo.local/' }}
      style={{ flex: 1, backgroundColor: colors.bg }}
      onError={onOffline}
      onMessage={(e) => {
        try {
          const m = JSON.parse(e.nativeEvent.data) as FromMap;
          if (m.type === 'ready') setReady(true);
          else if (m.type === 'offline') onOffline();
          else if (m.type === 'center') onCenter(m.lat, m.lng, m.zoom, m.byUser);
        } catch {
          // Not ours.
        }
      }}
    />
  );
}
