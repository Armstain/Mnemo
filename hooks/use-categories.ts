import { useThemeName } from '@/hooks/use-theme';
import { getCategories, getStatusConfig, type CategoryConfig, type StatusConfig } from '@/utils/categories';
import type { Category, ItemStatus } from '@/types/mnemo';

export function useCategories(): Record<Category, CategoryConfig> {
  return getCategories(useThemeName());
}

export function useStatusConfig(): Record<ItemStatus, StatusConfig> {
  return getStatusConfig(useThemeName());
}
