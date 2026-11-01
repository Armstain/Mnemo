import React from 'react';

import { mapHtml, type FromMap, type ToMap } from '@/lib/map-html';
import type { MapPickerProps } from '@/components/map/types';

/** The pin map on the web: the same Leaflet page in an iframe. */
export function MapPicker({ initial, radius, others, goTo, colors, onCenter, onOffline }: MapPickerProps) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = React.useState(false);
  const html = React.useMemo(() => mapHtml({ ...initial, radius, ...colors }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const post = (m: ToMap) => ref.current?.contentWindow?.postMessage(JSON.stringify(m), '*');
  const handlers = React.useRef({ onCenter, onOffline });
  handlers.current = { onCenter, onOffline };

  React.useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || typeof e.data !== 'string') return;
      try {
        const m = JSON.parse(e.data) as FromMap;
        if (m.type === 'ready') setReady(true);
        else if (m.type === 'offline') handlers.current.onOffline();
        else if (m.type === 'center') handlers.current.onCenter(m.lat, m.lng, m.zoom, m.byUser);
      } catch {
        // Not ours.
      }
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  React.useEffect(() => void (ready && post({ type: 'radius', radius })), [ready, radius]);
  React.useEffect(() => void (ready && post({ type: 'others', places: others })), [ready, others]);
  React.useEffect(() => void (ready && goTo && post({ type: 'goto', lat: goTo.lat, lng: goTo.lng, zoom: goTo.zoom })), [ready, goTo]);

  return (
    <iframe
      ref={ref}
      title="Map"
      srcDoc={html}
      sandbox="allow-scripts"
      style={{ border: 0, width: '100%', height: '100%', background: colors.bg }}
    />
  );
}
