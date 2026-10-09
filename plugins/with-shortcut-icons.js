// Config plugin: writes the Android home-screen shortcut icons used by
// app/(tabs)/_layout.tsx (shortcut_mic, shortcut_note, shortcut_resume) as
// vector drawables, so there are no PNGs to keep in sync. Glyphs are the
// same Lucide paths the app draws (mic, pen-line, play), on a circle in
// the theme's primaryContainer / onPrimaryContainer (hooks/use-theme.tsx),
// with a drawable-night variant for dark mode.
//
// iOS doesn't need this — its shortcuts use SF Symbols.

const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const COLORS = {
  light: { circle: '#CBE9D8', glyph: '#06301F' },
  dark: { circle: '#0D4A33', glyph: '#A8F0CC' },
};

// Lucide 24x24 path data, rects/polygons rewritten as paths.
const GLYPHS = {
  shortcut_mic: [
    'M12,19 v3',
    'M19,10 v2 a7,7 0 0,1 -14,0 v-2',
    'M12,2 a3,3 0 0,1 3,3 v7 a3,3 0 0,1 -6,0 V5 a3,3 0 0,1 3,-3 z',
  ],
  shortcut_note: [
    'M13,21 h8',
    'M21.174,6.812 a1,1 0 0,0 -3.986,-3.987 L3.842,16.174 a2,2 0 0,0 -0.5,0.83 l-1.321,4.352 a0.5,0.5 0 0,0 0.623,0.622 l4.353,-1.32 a2,2 0 0,0 0.83,-0.497 z',
  ],
  shortcut_resume: ['M6,3 L20,12 L6,21 z'],
};

function vectorXml(paths, { circle, glyph }) {
  const strokes = paths
    .map(
      (d) =>
        `    <path android:pathData="${d}" android:strokeColor="${glyph}" android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round"/>`,
    )
    .join('\n');
  // 48dp canvas with the 24-unit glyph centred (12 units of padding a side).
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="48dp" android:height="48dp"
  android:viewportWidth="48" android:viewportHeight="48">
  <path android:pathData="M24,0 a24,24 0 1,1 0,48 a24,24 0 1,1 0,-48 z" android:fillColor="${circle}"/>
  <group android:translateX="12" android:translateY="12">
${strokes}
  </group>
</vector>
`;
}

module.exports = function withShortcutIcons(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      for (const [folder, colors] of [
        ['drawable', COLORS.light],
        ['drawable-night', COLORS.dark],
      ]) {
        const dir = path.join(res, folder);
        fs.mkdirSync(dir, { recursive: true });
        for (const [name, paths] of Object.entries(GLYPHS)) {
          fs.writeFileSync(path.join(dir, `${name}.xml`), vectorXml(paths, colors));
        }
      }
      return cfg;
    },
  ]);
};
