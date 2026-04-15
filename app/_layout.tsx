import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Lora_700Bold } from '@expo-google-fonts/lora';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import "../global.css";

import { ONBOARDING_KEY } from '@/app/onboarding';
import { PendingProcessor } from '@/components/PendingProcessor';
import { useColorScheme } from '@/components/useColorScheme';

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

// Warm Zen navigation theme
const ZenLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#8B9E7E',
    background: '#F5F0EB',
    card: '#F5F0EB',
    text: '#3D3A36',
    border: '#DDD6CD',
    notification: '#C4856A',
  },
};

const ZenDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#A3B896',
    background: '#2A2826',
    card: '#2A2826',
    text: '#E8E4DF',
    border: '#3E3B38',
    notification: '#C4856A',
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

import { SafeAreaProvider } from 'react-native-safe-area-context';

function RootLayoutNav() {
  const colorScheme = useColorScheme();

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
      <ThemeProvider value={colorScheme === 'dark' ? ZenDarkTheme : ZenLightTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen
            name="modal"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
        </Stack>
        <PendingProcessor />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
