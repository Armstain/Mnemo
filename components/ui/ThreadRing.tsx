import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

// ─── Geometry ───────────────────────────────────────────────────
// Angles are in degrees, 0 = 3 o'clock, increasing clockwise (SVG's y
// axis points down).

function point(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path for a clockwise arc from `startDeg` sweeping `sweepDeg`. */
function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const sweep = Math.min(Math.max(sweepDeg, 0.01), 359.99);
  const a = point(cx, cy, r, startDeg);
  const b = point(cx, cy, r, startDeg + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${largeArc} 1 ${b.x} ${b.y}`;
}

// ─── ThreadRing ─────────────────────────────────────────────────

interface ThreadRingProps {
  /** Outer box size in px. */
  size: number;
  /** 0..1 — how much of the ring is drawn (see utils/time `freshness`). */
  progress: number;
  color: string;
  trackColor: string;
  strokeWidth?: number;
  children?: React.ReactNode;
}

/**
 * The logo's open ring, used as data: an arc from 12 o'clock whose length
 * is how warm a thread still is, ending in the logo's dot. A thread you
 * touched this morning is almost a closed loop; one going cold is a short
 * stub with its dot drifting free. Content (usually a category icon) sits
 * in the middle.
 */
export function ThreadRing({ size, progress, color, trackColor, strokeWidth = 2.5, children }: ThreadRingProps) {
  const c = size / 2;
  const dotR = strokeWidth * 1.1;
  const r = c - dotR - 0.5;
  // Never fully closed (the logo's ring never is) and never invisible.
  const sweep = 24 + Math.min(Math.max(progress, 0), 1) * 300;
  const start = -90;
  const end = point(c, c, r, start + sweep);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={c} cy={c} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Path d={arcPath(c, c, r, start, sweep)} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
        <Circle cx={end.x} cy={end.y} r={dotR} fill={color} />
      </Svg>
      {children}
    </View>
  );
}

// ─── OpenRing (brand mark) ──────────────────────────────────────

interface OpenRingProps {
  size: number;
  color: string;
  /** Color for the centre dot and the escaped dot; defaults to `color`. */
  dotColor?: string;
  /** Ring thickness as a fraction of size. The logo uses ~0.16. */
  weight?: number;
  /** Draw the centre dot. Off for large decorative use. */
  core?: boolean;
}

/**
 * Vector version of the Mnemo mark: a ring broken at the top right, with
 * one dot escaped through the gap — a thought that slipped out of the
 * loop. Used large and cropped as decoration, and small as the logo.
 */
export function OpenRing({ size, color, dotColor, weight = 0.16, core = true }: OpenRingProps) {
  const c = size / 2;
  const stroke = size * weight;
  const r = c - stroke / 2 - size * 0.02;
  const dot = dotColor ?? color;
  // Gap between -78° and -12° (top right), like the logo.
  const escaped = point(c, c, r + stroke * 0.15, -45);

  return (
    <Svg width={size} height={size}>
      <Path d={arcPath(c, c, r, -12, 294)} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" />
      {/* Thin decorative rings still need a dot you can see. */}
      <Circle cx={escaped.x} cy={escaped.y} r={Math.max(stroke * 0.5, size * 0.018)} fill={dot} />
      {core && <Circle cx={c} cy={c} r={size * 0.16} fill={dot} />}
    </Svg>
  );
}
