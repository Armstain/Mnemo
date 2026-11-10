import type { Category, ItemStatus } from "@/types/mnemo";
import { PALETTE, type ThemeColors } from "@/utils/palette";
import {
  Activity,
  BookOpen,
  Briefcase,
  Heart,
  Inbox,
  Lightbulb,
  MapPin,
  ShoppingCart,
} from "lucide-react-native";

export interface CategoryConfig {
  label: string;
  icon: typeof Briefcase;
  color: string;
  bgTint: string;
}

type Swatch = keyof ThemeColors;

function swatch(
  theme: "light" | "dark",
  key: Swatch,
): { color: string; bgTint: string } {
  const color = PALETTE[theme][key];
  const hex = color.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return {
    color,
    bgTint: `rgba(${r},${g},${b},${theme === "dark" ? 0.14 : 0.12})`,
  };
}

const CATEGORY_META: Record<
  Category,
  { label: string; icon: typeof Briefcase; swatch: Swatch }
> = {
  work: { label: "Work", icon: Briefcase, swatch: "hueIndigo" },
  personal: { label: "Personal", icon: Heart, swatch: "hueClay" },
  study: { label: "Study", icon: BookOpen, swatch: "huePlum" },
  shopping: { label: "Shopping", icon: ShoppingCart, swatch: "hueSage" },
  health: { label: "Health", icon: Activity, swatch: "hueClay" },
  ideas: { label: "Ideas", icon: Lightbulb, swatch: "hueAmber" },
  errands: { label: "Errands", icon: MapPin, swatch: "hueTeal" },
  general: { label: "General", icon: Inbox, swatch: "fgSecondary" },
};

export interface StatusConfig {
  label: string;
  color: string;
  bgTint: string;
}

const STATUS_META: Record<ItemStatus, { label: string; swatch: Swatch }> = {
  active: { label: "Active", swatch: "accent" },
  paused: { label: "Paused", swatch: "hueAmber" },
  completed: { label: "Done", swatch: "fgSecondary" },
  archived: { label: "Archived", swatch: "fgTertiary" },
};

export function getCategories(
  theme: "light" | "dark",
): Record<Category, CategoryConfig> {
  const result = {} as Record<Category, CategoryConfig>;
  for (const key of Object.keys(CATEGORY_META) as Category[]) {
    const meta = CATEGORY_META[key];
    result[key] = {
      label: meta.label,
      icon: meta.icon,
      ...swatch(theme, meta.swatch),
    };
  }
  return result;
}

export function getStatusConfig(
  theme: "light" | "dark",
): Record<ItemStatus, StatusConfig> {
  const result = {} as Record<ItemStatus, StatusConfig>;
  for (const key of Object.keys(STATUS_META) as ItemStatus[]) {
    const meta = STATUS_META[key];
    result[key] = { label: meta.label, ...swatch(theme, meta.swatch) };
  }
  return result;
}
