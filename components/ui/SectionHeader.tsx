import { Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';

interface SectionHeaderProps {
  title: string;
  icon?: IconName;
  meta?: string;
  action?: string;
  onAction?: () => void;
  eyebrow?: boolean;
  className?: string;
}

/** Labels a content section, with an optional leading icon and a right-aligned meta text or text-action. */
export function SectionHeader({
  title,
  icon,
  meta,
  action,
  onAction,
  eyebrow = false,
  className = '',
}: SectionHeaderProps) {
  const colors = useThemeColors();

  return (
    <View
      className={`flex-row items-center justify-between gap-3 mb-3 ${className}`}
    >
      <View className="flex-row items-center gap-2 flex-shrink min-w-0">
        {icon ? <Icon name={icon} size={17} color={colors.accent} /> : null}
        {eyebrow ? (
          <Text
            numberOfLines={1}
            className="font-sans-semi text-micro uppercase tracking-caps"
            style={{ color: colors.fgTertiary }}
          >
            {title}
          </Text>
        ) : (
          <Text
            numberOfLines={1}
            className="font-sans-semi text-body"
            style={{ color: colors.fg }}
          >
            {title}
          </Text>
        )}
      </View>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text className="font-sans-semi text-xs" style={{ color: colors.accent }}>
            {action}
          </Text>
        </Pressable>
      ) : meta ? (
        <Text className="text-xs" style={{ color: colors.fgTertiary }}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}
