import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from '@expo-google-fonts/instrument-sans';
import {
  Literata_400Regular,
  Literata_400Regular_Italic,
  Literata_500Medium,
} from '@expo-google-fonts/literata';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import "../global.css";

// moti still bundles an unused MotiSafeAreaView built on RN's deprecated
// SafeAreaView; importing anything from moti's barrel pulls that
// submodule in and fires this warning at startup. We never use
// MotiSafeAreaView — nothing to fix on our side, and no newer moti
// release drops it yet.
LogBox.ignoreLogs(['SafeAreaView has been deprecated']);

import { ONBOARDING_KEY } from '@/app/onboarding';
import { PendingProcessor } from '@/components/PendingProcessor';
import { UndoToastHost } from '@/components/ui/UndoToastHost';
import { MnemoStoreProvider } from '@/hooks/use-mnemo-store';
import { UndoToastProvider } from '@/hooks/use-undo-toast';
import { applyStoredThemePreference, PALETTE, useThemeName } from '@/hooks/use-theme';
import { loadStoredApiKey } from '@/lib/api-key';

// Load stored API key early on app start
loadStoredApiKey();

// Reminders (lib/reminders.ts) are scheduled local notifications — this
// controls how one is presented if it fires while the app is already
// open in the foreground (otherwise, on some platforms, it would be
// silently swallowed instead of shown).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Apply any persisted manual theme choice before first render.
applyStoredThemePreference();

// Navigation themes derived from the app palette (see hooks/use-theme.tsx).
export const NavThemes = {
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: PALETTE.dark.accent,
      background: PALETTE.dark.bg,
      card: PALETTE.dark.bg,
      text: PALETTE.dark.fg,
      border: PALETTE.dark.border,
      notification: PALETTE.dark.accentWarm,
    },
  },
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: PALETTE.light.accent,
      background: PALETTE.light.bg,
      card: PALETTE.light.bg,
      text: PALETTE.light.fg,
      border: PALETTE.light.border,
      notification: PALETTE.light.accentWarm,
    },
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Literata_400Regular,
    Literata_400Regular_Italic,
    Literata_500Medium,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const theme = useThemeName();

  // Redirect to onboarding on first launch.
  useEffect(() => {
    (async () => {
      try {
        const done =
          Platform.OS === 'web'
            ? localStorage.getItem(ONBOARDING_KEY)
            : await SecureStore.getItemAsync(ONBOARDING_KEY);
        if (done !== 'true') {
          router.replace('/onboarding');
        }
      } catch {
        // Fail open — show main app if storage unavailable.
      }
    })();
  }, []);

  // Tapping a reminder opens the note it was set for — the scheduled
  // notification's identifier is always the item's id (see
  // syncReminderForItem in lib/reminders.ts), so no lookup table is needed.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const itemId = response.notification.request.identifier;
      if (itemId) router.push(`/(tabs)/context?id=${itemId}` as any);
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <MnemoStoreProvider>
        <UndoToastProvider>
        <ThemeProvider value={NavThemes[theme]}>
          <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: PALETTE[theme].bg },
              animation: Platform.OS === 'android' ? 'fade_from_bottom' : 'default',
              fullScreenGestureEnabled: true,
              gestureEnabled: true,
            }}
          >
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="onboarding" />
            <Stack.Screen
              name="capture"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="dump"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="modal"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
          </Stack>
          <PendingProcessor />
          <UndoToastHost />
        </ThemeProvider>
        </UndoToastProvider>
      </MnemoStoreProvider>
    </SafeAreaProvider>
  );
}
