import {
  Briefcase,
  Heart,
  BookOpen,
  ShoppingCart,
  Activity,
  Lightbulb,
  MapPin,
  Inbox,
} from 'lucide-react-native';
import type { Category, ItemStatus } from '@/types/mnemo';
import { useThemeName } from '@/hooks/use-theme';

export interface CategoryConfig {
  label: string;
  icon: typeof Briefcase;
  color: string;
  bgTint: string;
}

interface DualColor {
  light: string;
  dark: string;
  lightTint: string;
  darkTint: string;
}

// Dark colors are tuned for legibility on dark glass (L ≥ 0.65); light
// colors are their deep counterparts, ≥4.5:1 on the light bg (#F7FAF7).
const CATEGORY_META: Record<
  Category,
  { label: string; icon: typeof Briefcase; colors: DualColor }
> = {
  work: {
    label: 'Work',
    icon: Briefcase,
    colors: {
      dark: '#85B3E3',
      light: '#3F6FA8',
      darkTint: 'rgba(133,179,227,0.14)',
      lightTint: 'rgba(63,111,168,0.12)',
    },
  },
  personal: {
    label: 'Personal',
    icon: Heart,
    colors: {
      dark: '#EBA98C',
      light: '#A8542D',
      darkTint: 'rgba(235,169,140,0.14)',
      lightTint: 'rgba(168,84,45,0.12)',
    },
  },
  study: {
    label: 'Study',
    icon: BookOpen,
    colors: {
      dark: '#B3A5F0',
      light: '#6A55B8',
      darkTint: 'rgba(179,165,240,0.14)',
      lightTint: 'rgba(106,85,184,0.12)',
    },
  },
  shopping: {
    label: 'Shopping',
    icon: ShoppingCart,
    colors: {
      dark: '#8FD0B2',
      light: '#2E7D5B',
      darkTint: 'rgba(143,208,178,0.14)',
      lightTint: 'rgba(46,125,91,0.12)',
    },
  },
  health: {
    label: 'Health',
    icon: Activity,
    colors: {
      dark: '#F2A57E',
      light: '#AD5526',
      darkTint: 'rgba(242,165,126,0.14)',
      lightTint: 'rgba(173,85,38,0.12)',
    },
  },
  ideas: {
    label: 'Ideas',
    icon: Lightbulb,
    colors: {
      dark: '#E8CB70',
      light: '#84671C',
      darkTint: 'rgba(232,203,112,0.14)',
      lightTint: 'rgba(132,103,28,0.12)',
    },
  },
  errands: {
    label: 'Errands',
    icon: MapPin,
    colors: {
      dark: '#A9C394',
      light: '#54713C',
      darkTint: 'rgba(169,195,148,0.14)',
      lightTint: 'rgba(84,113,60,0.12)',
    },
  },
  general: {
    label: 'General',
    icon: Inbox,
    colors: {
      dark: '#BCB8B2',
      light: '#66625C',
      darkTint: 'rgba(188,184,178,0.14)',
      lightTint: 'rgba(102,98,92,0.12)',
    },
  },
};

export function getCategories(
  theme: 'light' | 'dark',
): Record<Category, CategoryConfig> {
  const result = {} as Record<Category, CategoryConfig>;
  for (const key of Object.keys(CATEGORY_META) as Category[]) {
    const meta = CATEGORY_META[key];
    result[key] = {
      label: meta.label,
      icon: meta.icon,
      color: theme === 'dark' ? meta.colors.dark : meta.colors.light,
      bgTint: theme === 'dark' ? meta.colors.darkTint : meta.colors.lightTint,
    };
  }
  return result;
}

/** Theme-resolved category config — the standard way to consume categories. */
export function useCategories(): Record<Category, CategoryConfig> {
  return getCategories(useThemeName());
}

/** All categories in display order. */
export const CATEGORY_LIST: Category[] = [
  'general',
  'work',
  'personal',
  'study',
  'shopping',
  'health',
  'ideas',
  'errands',
];

export interface StatusConfig {
  label: string;
  color: string;
  bgTint: string;
}

const STATUS_META: Record<ItemStatus, { label: string; colors: DualColor }> = {
  active: {
    label: 'Active',
    colors: {
      dark: '#34d399',
      light: '#0B7A52',
      darkTint: 'rgba(52,211,153,0.14)',
      lightTint: 'rgba(11,122,82,0.12)',
    },
  },
  paused: {
    label: 'Paused',
    colors: {
      dark: '#E8CB70',
      light: '#84671C',
      darkTint: 'rgba(232,203,112,0.14)',
      lightTint: 'rgba(132,103,28,0.12)',
    },
  },
  completed: {
    label: 'Done',
    colors: {
      dark: '#85B3E3',
      light: '#3F6FA8',
      darkTint: 'rgba(133,179,227,0.14)',
      lightTint: 'rgba(63,111,168,0.12)',
    },
  },
  archived: {
    label: 'Archived',
    colors: {
      dark: '#A3A7B3',
      light: '#6E7280',
      darkTint: 'rgba(163,167,179,0.14)',
      lightTint: 'rgba(110,114,128,0.12)',
    },
  },
};

export function getStatusConfig(
  theme: 'light' | 'dark',
): Record<ItemStatus, StatusConfig> {
  const result = {} as Record<ItemStatus, StatusConfig>;
  for (const key of Object.keys(STATUS_META) as ItemStatus[]) {
    const meta = STATUS_META[key];
    result[key] = {
      label: meta.label,
      color: theme === 'dark' ? meta.colors.dark : meta.colors.light,
      bgTint: theme === 'dark' ? meta.colors.darkTint : meta.colors.lightTint,
    };
  }
  return result;
}

/** Theme-resolved status config. */
export function useStatusConfig(): Record<ItemStatus, StatusConfig> {
  return getStatusConfig(useThemeName());
}
