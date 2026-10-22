// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*'],
  },
  {
    rules: {
      // Apostrophes and quotes in <Text> are fine in React Native.
      'react/no-unescaped-entities': 'off',
      // These guard code for the React Compiler, which Mnemo doesn't use.
      // The app relies on patterns they flag on purpose (a ref holding the
      // latest callback, Reanimated shared values, Date.now() for "how long
      // ago"), so they're shown as warnings, not failures.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    // Native modules loaded only where they exist (not in Expo Go, not on
    // the web): a static import would throw before the check could run.
    files: ['index.ts', 'components/ShareIntake.native.tsx', 'components/WidgetSync.android.tsx', 'lib/notifications.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
