import { Link, Stack } from 'expo-router';
import { View, Text } from 'react-native';
import { MotiView } from 'moti';
import { Icon } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';
import { useEnter } from '@/utils/motion';

export default function NotFoundScreen() {
  const enter = useEnter();
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Not found', headerShown: false }} />
      <View className="flex-1 items-center justify-center p-8">
        <MotiView {...enter.rise(0)}
          className="items-center"
        >
          <View className="mb-6 opacity-60">
            <Icon name="mic" size={48} color={colors.accent} stroke={1.5} />
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
    </View>
  );
}
