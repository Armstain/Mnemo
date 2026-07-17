import React from 'react';
import { View, Text } from 'react-native';
import type { ItemStatus } from '@/types/mnemo';
import { useStatusConfig } from '@/utils/categories';
import { Circle, Pause, CheckCircle, Archive } from 'lucide-react-native';

const STATUS_ICONS = {
  active: Circle,
  paused: Pause,
  completed: CheckCircle,
  archived: Archive,
};

interface StatusBadgeProps {
  status: ItemStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const statusConfig = useStatusConfig();
  const config = statusConfig[status];
  const Icon = STATUS_ICONS[status];
  const isSmall = size === 'sm';

  return (
    <View
      className={`flex-row items-center rounded-full ${
        isSmall ? 'px-2 py-0.5' : 'px-3 py-1'
      }`}
      style={{ backgroundColor: config.bgTint }}
    >
      <Icon
        size={isSmall ? 9 : 12}
        color={config.color}
        strokeWidth={2}
      />
      <Text
        className={`font-sans-medium ml-1 ${
          isSmall ? 'text-[9px]' : 'text-[11px]'
        } uppercase tracking-tighter`}
        style={{ color: config.color }}
      >
        {config.label}
      </Text>
    </View>
  );
}
