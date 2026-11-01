export interface MapPickerProps {
  /** Where the map starts. Later moves go through `goTo`. */
  initial: { lat: number; lng: number; zoom: number };
  /** The circle around the pin, in metres. */
  radius: number;
  /** Other saved places, drawn dashed so overlaps show. */
  others: { name: string; lat: number; lng: number; radius: number }[];
  /** A new object each time the map should move there ("Center on me"). */
  goTo?: { lat: number; lng: number; zoom?: number };
  colors: { accent: string; other: string; bg: string };
  /** The map stopped moving with the pin here, at this zoom; `byUser` if they dragged it. */
  onCenter: (lat: number, lng: number, zoom: number, byUser: boolean) => void;
  /** The map can't load (no connection). */
  onOffline: () => void;
}
