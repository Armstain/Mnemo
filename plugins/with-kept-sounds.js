const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Release builds drop resources nothing refers to (enableShrinkResources in
// app.json). The reminder sounds are only ever looked up by name while the
// app runs, which the build can't see, so it emptied them, and Android
// played the phone's own sound instead. This tells the build to keep every
// sound listed under expo-notifications in app.json.
module.exports = function withKeptSounds(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const notifications = (cfg.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
      const sounds = (notifications?.[1]?.sounds ?? []).map((file) => path.basename(file).replace(/\.[^.]+$/, ''));
      if (sounds.length === 0) return cfg;
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'mnemo_keep.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
  tools:keep="${sounds.map((name) => `@raw/${name}`).join(',')}" />
`,
      );
      return cfg;
    },
  ]);
};
