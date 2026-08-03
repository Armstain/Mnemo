import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Lora_700Bold } from '@expo-google-fonts/lora';
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
import "../global.css";

// moti still bundles an unused MotiSafeAreaView built on RN's deprecated
// SafeAreaView; importing anything from moti's barrel pulls that
// submodule in and fires this warning at startup. We never use
// MotiSafeAreaView — nothing to fix on our side, and no newer moti
// release drops it yet.
LogBox.ignoreLogs(['SafeAreaView has been deprecated']);

import { ONBOARDING_KEY } from '@/app/onboarding';
import { PendingProcessor } from '@/components/PendingProcessor';
import { MnemoStoreProvider } from '@/hooks/use-mnemo-store';
import { applyStoredThemePreference, PALETTE, useThemeName } from '@/hooks/use-theme';
import { loadStoredApiKey } from '@/lib/api-key';

// Load stored API key early on app start
loadStoredApiKey();

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
    Lora_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
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
        </ThemeProvider>
      </MnemoStoreProvider>
    </SafeAreaProvider>
  );
}
