// One import per weight: the package roots pull in every weight they have.
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { Literata_400Regular } from '@expo-google-fonts/literata/400Regular';
import { Literata_400Regular_Italic } from '@expo-google-fonts/literata/400Regular_Italic';
import { Literata_500Medium } from '@expo-google-fonts/literata/500Medium';
// Bangla: the phone's own Bangla font is small beside these (see components/ui/Text).
import { NotoSansBengali_400Regular } from '@expo-google-fonts/noto-sans-bengali/400Regular';
import { NotoSansBengali_500Medium } from '@expo-google-fonts/noto-sans-bengali/500Medium';
import { NotoSansBengali_600SemiBold } from '@expo-google-fonts/noto-sans-bengali/600SemiBold';
import { NotoSerifBengali_400Regular } from '@expo-google-fonts/noto-serif-bengali/400Regular';
import { NotoSerifBengali_500Medium } from '@expo-google-fonts/noto-serif-bengali/500Medium';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Notifications, notificationsAvailable } from '@/lib/notifications';
import "../global.css";

// moti still bundles an unused MotiSafeAreaView built on RN's deprecated
// SafeAreaView; importing anything from moti's barrel pulls that
// submodule in and fires this warning at startup. We never use
// MotiSafeAreaView — nothing to fix on our side, and no newer moti
// release drops it yet.
LogBox.ignoreLogs(['SafeAreaView has been deprecated']);

import { ONBOARDING_KEY } from '@/app/onboarding';
import { NudgeScheduler } from '@/components/NudgeScheduler';
import { ReminderActions } from '@/components/ReminderActions';
import { PendingProcessor } from '@/components/PendingProcessor';
import { FilingNotifier } from '@/components/FilingNotifier';
import { UndoToastHost } from '@/components/ui/UndoToastHost';
import { MnemoStoreProvider } from '@/hooks/use-mnemo-store';
import { UndoToastProvider } from '@/hooks/use-undo-toast';
import { applyStoredThemePreference, PALETTE, useThemeName } from '@/hooks/use-theme';
import { appReady } from '@/lib/ai-mode';

// Reads the saved key and preferences (AI or offline) as early as possible.
void appReady;

// Reminders (lib/reminders.ts) are scheduled local notifications — this
// controls how one is presented if it fires while the app is already
// open in the foreground (otherwise, on some platforms, it would be
// silently swallowed instead of shown).
if (notificationsAvailable) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

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
    NotoSansBengali_400Regular,
    NotoSansBengali_500Medium,
    NotoSansBengali_600SemiBold,
    NotoSerifBengali_400Regular,
    NotoSerifBengali_500Medium,
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
          <FilingNotifier />
          {/* Tapping a reminder or a nudge opens its thread; reminder buttons act on it. */}
          <ReminderActions />
          <NudgeScheduler />
          <UndoToastHost />
        </ThemeProvider>
        </UndoToastProvider>
      </MnemoStoreProvider>
    </SafeAreaProvider>
  );
}
