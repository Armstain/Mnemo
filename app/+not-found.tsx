import { Link, Stack } from 'expo-router';
import { View, Text } from 'react-native';
import { MotiView } from 'moti';
import { Mic } from 'lucide-react-native';
import { AmbientGlow } from '@/components/ui/AmbientGlow';
import { useThemeColors } from '@/hooks/use-theme';

export default function NotFoundScreen() {
  const colors = useThemeColors();
  return (
    <AmbientGlow>
      <Stack.Screen options={{ title: 'Not found', headerShown: false }} />
      <View className="flex-1 items-center justify-center p-8">
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500 }}
          className="items-center"
        >
          <View className="mb-6 opacity-60">
            <Mic size={48} color={colors.accent} strokeWidth={1.5} />
          </View>
          <Text className="text-2xl font-sans-medium text-fg mb-3">
            Page not found
          </Text>
          <Text className="font-sans text-sm text-fg-muted text-center mb-8 leading-relaxed">
            This path doesn't seem to lead anywhere.
          </Text>

          <Link href="/" className="px-6 py-3 rounded-full bg-accent">
            <Text className="font-sans-semi text-sm text-accent-ink">
              Return home
            </Text>
          </Link>
        </MotiView>
      </View>
    </AmbientGlow>
  );
}
