import {
  Home,
  Search,
  Layers,
  Settings,
  Mic,
  Plus,
  Clock,
  ArrowUpRight,
  ArrowRight,
  Sparkles,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Trash2,
  Pencil,
  Share2,
  Copy,
  Play,
  Pause,
  Archive,
  Pin,
  Calendar,
  Hash,
  Volume2,
  MoreHorizontal,
} from 'lucide-react-native';

type IconComponent = typeof Home;

export type IconName =
  | 'home'
  | 'search'
  | 'layers'
  | 'settings'
  | 'mic'
  | 'plus'
  | 'clock'
  | 'arrowUpRight'
  | 'arrowRight'
  | 'sparkles'
  | 'check'
  | 'x'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'chevronUp'
  | 'trash'
  | 'pencil'
  | 'share'
  | 'copy'
  | 'play'
  | 'pause'
  | 'archive'
  | 'pin'
  | 'calendar'
  | 'hash'
  | 'volume'
  | 'more';

/**
 * Mnemo's interface-chrome icon vocabulary — a name-keyed wrapper over
 * lucide-react-native so every call site shares one default size/stroke
 * instead of picking ad hoc values. Category glyphs (Briefcase, Heart, …
 * in utils/categories.ts) are a separate concern and stay as direct
 * lucide imports.
 */
const ICONS: Record<IconName, IconComponent> = {
  home: Home,
  search: Search,
  layers: Layers,
  settings: Settings,
  mic: Mic,
  plus: Plus,
  clock: Clock,
  arrowUpRight: ArrowUpRight,
  arrowRight: ArrowRight,
  sparkles: Sparkles,
  check: Check,
  x: X,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  trash: Trash2,
  pencil: Pencil,
  share: Share2,
  copy: Copy,
  play: Play,
  pause: Pause,
  archive: Archive,
  pin: Pin,
  calendar: Calendar,
  hash: Hash,
  volume: Volume2,
  more: MoreHorizontal,
};

export interface IconProps {
  name: IconName;
  /** Rendered box in px. Default 20. */
  size?: number;
  /** Stroke width. Default 1.7; use 2 for active/selected states. */
  stroke?: number;
  /** Defaults to currentColor's RN equivalent — pass explicitly. */
  color?: string;
}

export function Icon({ name, size = 20, stroke = 1.7, color }: IconProps) {
  const LucideComponent = ICONS[name];
  return <LucideComponent size={size} strokeWidth={stroke} color={color} />;
}
