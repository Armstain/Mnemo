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

// Colors are the design system's six category hues (global.css --hue-*),
// paired up where two categories share a hue family. Dark values are the
// light-tone variant for legibility on Ink surfaces; light values are the
// deep counterpart, ≥4.5:1 on the Paper bg (#FAF8F3).
const CATEGORY_META: Record<
  Category,
  { label: string; icon: typeof Briefcase; colors: DualColor }
> = {
  work: {
    label: 'Work',
    icon: Briefcase,
    colors: {
      // hue-indigo
      dark: '#9AA9E8',
      light: '#4A5C9E',
      darkTint: 'rgba(154,169,232,0.14)',
      lightTint: 'rgba(74,92,158,0.12)',
    },
  },
  personal: {
    label: 'Personal',
    icon: Heart,
    colors: {
      // hue-clay
      dark: '#E0A17C',
      light: '#A4552F',
      darkTint: 'rgba(224,161,124,0.14)',
      lightTint: 'rgba(164,85,47,0.12)',
    },
  },
  study: {
    label: 'Study',
    icon: BookOpen,
    colors: {
      // hue-plum
      dark: '#D99EC0',
      light: '#8A4A6E',
      darkTint: 'rgba(217,158,192,0.14)',
      lightTint: 'rgba(138,74,110,0.12)',
    },
  },
  shopping: {
    label: 'Shopping',
    icon: ShoppingCart,
    colors: {
      // hue-sage
      dark: '#7FC79C',
      light: '#3F7A5A',
      darkTint: 'rgba(127,199,156,0.14)',
      lightTint: 'rgba(63,122,90,0.12)',
    },
  },
  health: {
    label: 'Health',
    icon: Activity,
    colors: {
      // hue-clay (shares with personal — both warm oranges)
      dark: '#E0A17C',
      light: '#A4552F',
      darkTint: 'rgba(224,161,124,0.14)',
      lightTint: 'rgba(164,85,47,0.12)',
    },
  },
  ideas: {
    label: 'Ideas',
    icon: Lightbulb,
    colors: {
      // hue-amber
      dark: '#D7B263',
      light: '#8A6314',
      darkTint: 'rgba(215,178,99,0.14)',
      lightTint: 'rgba(138,99,20,0.12)',
    },
  },
  errands: {
    label: 'Errands',
    icon: MapPin,
    colors: {
      // hue-teal
      dark: '#77C3C9',
      light: '#1F6F76',
      darkTint: 'rgba(119,195,201,0.14)',
      lightTint: 'rgba(31,111,118,0.12)',
    },
  },
  general: {
    label: 'General',
    icon: Inbox,
    colors: {
      // neutral — catch-all, not a hue
      dark: '#BDBAB0',
      light: '#4D4940',
      darkTint: 'rgba(189,186,176,0.14)',
      lightTint: 'rgba(77,73,64,0.12)',
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
      // --accent
      dark: '#5DDBA0',
      light: '#0D6B4A',
      darkTint: 'rgba(93,219,160,0.14)',
      lightTint: 'rgba(13,107,74,0.12)',
    },
  },
  paused: {
    label: 'Paused',
    colors: {
      // hue-amber — a warm, non-alarming "needs a look" cue
      dark: '#D7B263',
      light: '#8A6314',
      darkTint: 'rgba(215,178,99,0.14)',
      lightTint: 'rgba(138,99,20,0.12)',
    },
  },
  completed: {
    label: 'Done',
    colors: {
      // neutral — done means it no longer needs attention
      dark: '#BDBAB0',
      light: '#4D4940',
      darkTint: 'rgba(189,186,176,0.14)',
      lightTint: 'rgba(77,73,64,0.12)',
    },
  },
  archived: {
    label: 'Archived',
    colors: {
      // fg-tertiary — quieter than completed
      dark: '#8B887E',
      light: '#7D786C',
      darkTint: 'rgba(139,136,126,0.14)',
      lightTint: 'rgba(125,120,108,0.12)',
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
