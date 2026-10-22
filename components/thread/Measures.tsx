import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { TextInput } from '@/components/ui/TextInput';
import { Icon } from '@/components/ui/Icon';
import { noFocusRing } from '@/utils/web';
import { readMeasures, type KnownMetric } from '@/lib/understand';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { MotiView } from 'moti';

import { useCountUp } from '@/hooks/use-count-up';

import { Eyebrow } from '@/components/ui/Eyebrow';
import { useThemeColors, type ThemeColors } from '@/hooks/use-theme';
import { formatValue, ROLLUPS, type MetricSummary } from '@/lib/measures';
import type { Measure, Rollup } from '@/types/mnemo';
import { capitalize } from '@/utils/text';

/** Group colours, in order of size; the category hues share a lightness. */
function groupPalette(colors: ThemeColors): string[] {
  return [colors.hueSage, colors.hueClay, colors.hueIndigo, colors.hueAmber, colors.huePlum, colors.hueTeal];
}

/** The numbers one entry reported, as label · value rows. */
export function MeasureRows({ items }: { items: Measure[] }) {
  const colors = useThemeColors();
  // Name the metric only when one entry reports more than one kind of number.
  const mixed = new Set(items.map((m) => m.metric.toLowerCase())).size > 1;
  return (
    <View className="rounded-sm px-3.5 py-1" style={{ backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }}>
      {items.map((m, i) => (
        <View
          key={i}
          className="flex-row items-center py-2.5"
          style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
        >
          <Text className="flex-1 font-sans text-body mr-3" style={{ color: colors.fg }} numberOfLines={1}>
            {capitalize(m.label || m.metric)}
            {m.label && mixed ? (
              <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                {'  '}
                {m.metric}
              </Text>
            ) : null}
          </Text>
          <Text className="font-sans-semi text-body" style={{ color: colors.fg, fontVariant: ['tabular-nums'] }}>
            {formatValue(m.value, m.unit)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The same rows, correctable: fix a label or an amount, drop a number that
 * isn't one, or add one that was missed ("lunch 250 taka"), read the same
 * way the phone reads notes.
 */
export function MeasureEditor({
  items,
  onChange,
  known,
}: {
  items: Measure[];
  onChange: (items: Measure[]) => void;
  known?: KnownMetric[];
}) {
  const colors = useThemeColors();
  const [adding, setAdding] = React.useState('');
  const [addError, setAddError] = React.useState(false);
  // Amounts are edited as text so "12." can be typed on the way to "12.5".
  const [drafts, setDrafts] = React.useState<Record<number, string>>({});

  const update = (index: number, patch: Partial<Measure>) =>
    onChange(items.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  const add = () => {
    const found = readMeasures(adding, known);
    if (found.length === 0) {
      setAddError(true);
      return;
    }
    onChange([...items, ...found]);
    setAdding('');
    setAddError(false);
  };

  return (
    <View className="rounded-sm px-3.5 py-1" style={{ backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }}>
      {items.map((m, i) => (
        <View
          key={i}
          className="flex-row items-center py-1.5"
          style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
        >
          <TextInput
            value={m.label ?? ''}
            onChangeText={(label) => update(i, { label: label || undefined })}
            placeholder={capitalize(m.metric)}
            placeholderTextColor={colors.fgTertiary}
            accessibilityLabel="What this number was"
            selectionColor={colors.accent}
            className="flex-1 font-sans text-body mr-2 py-1"
            style={[{ color: colors.fg, minWidth: 0 }, noFocusRing]}
          />
          <TextInput
            value={drafts[i] ?? String(m.value)}
            onChangeText={(text) => {
              setDrafts((d) => ({ ...d, [i]: text }));
              const value = Number(text.replace(/,/g, ''));
              if (text.trim() && Number.isFinite(value)) update(i, { value });
            }}
            onEndEditing={() =>
              setDrafts((d) => {
                const next = { ...d };
                delete next[i];
                return next;
              })
            }
            keyboardType="decimal-pad"
            accessibilityLabel={`Amount${m.unit ? ` in ${m.unit}` : ''}`}
            selectionColor={colors.accent}
            className="font-sans-semi text-body text-right py-1"
            style={[{ color: colors.fg, width: 76, fontVariant: ['tabular-nums'] }, noFocusRing]}
          />
          {m.unit ? (
            <Text className="font-sans text-sm ml-1.5" style={{ color: colors.fgTertiary }}>
              {m.unit}
            </Text>
          ) : null}
          <Pressable
            onPress={() => onChange(items.filter((_, j) => j !== i))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${m.label || m.metric}`}
            className="p-1 ml-2 active:opacity-50"
          >
            <Icon name="x" size={14} color={colors.fgTertiary} />
          </Pressable>
        </View>
      ))}
      <View
        className="flex-row items-center py-1.5"
        style={items.length > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
      >
        <Icon name="plus" size={13} color={colors.fgTertiary} />
        <TextInput
          value={adding}
          onChangeText={(t) => {
            setAdding(t);
            setAddError(false);
          }}
          onSubmitEditing={add}
          returnKeyType="done"
          placeholder={addError ? 'Say what and how much, e.g. "lunch 250 taka"' : 'Add a number, e.g. "lunch 250 taka"'}
          placeholderTextColor={addError ? colors.error : colors.fgTertiary}
          accessibilityLabel="Add a number"
          selectionColor={colors.accent}
          className="flex-1 font-sans text-sm ml-2 py-1"
          style={[{ color: colors.fg, minWidth: 0 }, noFocusRing]}
        />
        {adding.trim() ? (
          <Pressable onPress={add} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add" className="px-2 active:opacity-60">
            <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
              Add
            </Text>
          </Pressable>
        ) : null}
      </View>
      {addError ? (
        <Text className="font-sans text-xs pb-2" style={{ color: colors.error }}>
          Couldn't find an amount with a unit in that.
        </Text>
      ) : null}
    </View>
  );
}

/** A small line of readings over time. */
function Sparkline({ values, color, width = 120, height = 36 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={last[0]} cy={last[1]} r={3.5} fill={color} />
    </Svg>
  );
}

/** One horizontal bar segment row: label, bar sized to its share, value. */
function BarRow({ label, value, share, color, unit, note }: { label: string; value: number; share: number; color: string; unit?: string; note?: string }) {
  const colors = useThemeColors();
  return (
    <View className="py-1.5">
      <View className="flex-row items-center mb-1.5">
        <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: color }} />
        <Text className="flex-1 font-sans text-sm" style={{ color: colors.fgSecondary }} numberOfLines={1}>
          {capitalize(label)}
          {note ? <Text style={{ color: colors.accent }}>{`  ${note}`}</Text> : null}
        </Text>
        <Text className="font-sans-medium text-sm" style={{ color: colors.fg, fontVariant: ['tabular-nums'] }}>
          {formatValue(value, unit)}
        </Text>
      </View>
      <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.surfaceHigh }}>
        {/* Grows in from the left: a transform, so it stays on the UI thread. */}
        <MotiView
          from={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(0.03, share) }}
          transition={{ type: 'spring', damping: 20, stiffness: 140 }}
          style={{ height: '100%', width: '100%', borderRadius: 999, backgroundColor: color, transformOrigin: 'left' }}
        />
      </View>
    </View>
  );
}

function signed(value: number, unit?: string): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatValue(Math.abs(value), unit)}`;
}

/** One tracked metric, laid out for how it combines. */
export type MetricFix = { metric?: string; rollup?: Rollup };

const ROLLUP_NAMES: Record<Rollup, string> = { sum: 'Add up', latest: 'Latest', average: 'Average', compare: 'Compare' };

export function MetricCard({ summary, onFix }: { summary: MetricSummary; onFix?: (fix: MetricFix) => void }) {
  const colors = useThemeColors();
  const [fixing, setFixing] = React.useState(false);
  const [name, setName] = React.useState(summary.metric);
  const palette = groupPalette(colors);
  const { unit } = summary;
  const values = summary.points.map((p) => p.value);
  const n = summary.points.length;

  // The headline figure counts up to its value rather than appearing.
  const headlineTarget =
    summary.rollup === 'sum'
      ? summary.total ?? 0
      : summary.rollup === 'latest'
        ? summary.latest ?? 0
        : summary.rollup === 'average'
          ? summary.average ?? 0
          : summary.options?.[0]?.value ?? 0;
  const counted = useCountUp(headlineTarget);
  const whole = Math.abs(headlineTarget % 1) < 0.005;
  const shown =
    Math.abs(counted - headlineTarget) < 0.005
      ? headlineTarget
      : whole
        ? Math.round(counted)
        : Math.round(counted * 100) / 100;

  let headline = '';
  let detail = '';
  let body: React.ReactNode = null;

  if (summary.rollup === 'sum') {
    headline = formatValue(shown, unit);
    detail = [
      `${n} ${n === 1 ? 'item' : 'items'}`,
      summary.days && summary.days > 1 ? `${summary.days} days` : '',
      summary.perDay !== undefined ? `about ${formatValue(summary.perDay, unit)} a day` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const groups = summary.byGroup ?? [];
    if (groups.length > 0) {
      const total = summary.total || 1;
      body = (
        <View className="mt-4">
          {/* Where it went, at a glance */}
          <MotiView
            from={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ type: 'spring', damping: 22, stiffness: 120 }}
            className="flex-row h-2.5 rounded-full overflow-hidden mb-3"
            style={{ backgroundColor: colors.surfaceHigh, transformOrigin: 'left' }}
          >
            {groups.map((g, i) => (
              <View key={g.group} style={{ flex: g.total / total, backgroundColor: palette[i % palette.length] }} />
            ))}
          </MotiView>
          {groups.map((g, i) => (
            <BarRow
              key={g.group}
              label={g.group}
              value={g.total}
              share={g.total / total}
              color={palette[i % palette.length]}
              unit={unit}
            />
          ))}
        </View>
      );
    }
  } else if (summary.rollup === 'latest') {
    headline = formatValue(shown, unit);
    detail =
      summary.change !== undefined
        ? `${signed(summary.change, unit)} since the first reading (${formatValue(summary.first ?? 0, unit)})`
        : 'First reading';
    body = n > 1 ? <View className="mt-3"><Sparkline values={values} color={colors.accent} width={260} height={44} /></View> : null;
  } else if (summary.rollup === 'average') {
    headline = formatValue(shown, unit);
    detail = `average of ${n} · ${formatValue(summary.min ?? 0, unit)} to ${formatValue(summary.max ?? 0, unit)}`;
    body = n > 1 ? <View className="mt-3"><Sparkline values={values} color={colors.accent} width={260} height={44} /></View> : null;
  } else {
    const options = summary.options ?? [];
    const max = Math.max(...options.map((o) => o.value), 1);
    headline = options.length > 0 ? formatValue(shown, unit) : '';
    detail = options.length > 1 ? `lowest of ${options.length} options` : 'one option so far';
    body = (
      <View className="mt-3">
        {options.map((o, i) => (
          <BarRow
            key={o.label}
            label={o.label}
            value={o.value}
            share={o.value / max}
            color={i === 0 ? colors.accent : colors.outline}
            unit={unit}
            note={i === 0 && options.length > 1 ? 'lowest' : undefined}
          />
        ))}
      </View>
    );
  }

  return (
    <View className="rounded-lg px-5 py-4" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      {fixing && onFix ? (
        // Rename it (an existing name merges the two) or change how it adds up.
        <View className="gap-3 mb-2">
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            selectionColor={colors.accent}
            accessibilityLabel="What this tracks"
            className="font-sans-semi text-body rounded-sm px-3 py-2"
            style={[{ color: colors.fg, backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }, noFocusRing]}
          />
          <View className="flex-row flex-wrap gap-2">
            {ROLLUPS.map((r) => {
              const on = r === summary.rollup;
              return (
                <Pressable
                  key={r}
                  onPress={() => onFix({ rollup: r })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  className="rounded-full px-3 h-8 items-center justify-center active:opacity-70"
                  style={{ backgroundColor: on ? colors.accentSoft : colors.surfaceHigh }}
                >
                  <Text className="font-sans-medium text-sm" style={{ color: on ? colors.accent : colors.fgSecondary }}>
                    {ROLLUP_NAMES[r]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View className="flex-row justify-end">
            <Pressable
              onPress={() => {
                if (name.trim() && name.trim() !== summary.metric) onFix({ metric: name.trim() });
                setFixing(false);
              }}
              accessibilityRole="button"
              hitSlop={6}
              className="px-2 active:opacity-60"
            >
              <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
                Done
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="flex-row items-center">
          <Text className="flex-1 font-sans-semi text-sm" style={{ color: colors.fgSecondary }}>
            {capitalize(summary.metric)}
          </Text>
          {onFix ? (
            <Pressable
              onPress={() => {
                setName(summary.metric);
                setFixing(true);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Fix ${summary.metric}`}
              className="active:opacity-50"
            >
              <Icon name="pencil" size={14} color={colors.fgTertiary} />
            </Pressable>
          ) : null}
        </View>
      )}
      <Text className="font-display mt-1" style={{ color: colors.fg, fontSize: 30, lineHeight: 36, fontVariant: ['tabular-nums'] }}>
        {headline}
      </Text>
      {detail ? (
        <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }}>
          {detail}
        </Text>
      ) : null}
      {body}
      {summary.others.length > 0 ? (
        <Text className="font-sans text-sm mt-3" style={{ color: colors.fgTertiary }}>
          Also {summary.others.map((o) => formatValue(o.total, o.unit)).join(', ')}, kept separate (not converted)
        </Text>
      ) : null}
    </View>
  );
}

/** The thread's "Numbers" section: one card per thing it tracks. */
export function NumbersSection({
  summaries,
  onFix,
}: {
  summaries: MetricSummary[];
  /** Applies a fix to every reading of one metric in the thread. */
  onFix?: (summary: MetricSummary, fix: MetricFix) => void;
}) {
  const colors = useThemeColors();
  if (summaries.length === 0) return null;
  return (
    <View>
      <Eyebrow>Numbers</Eyebrow>
      <View className="gap-3">
        {summaries.map((s) => (
          <MetricCard key={`${s.key}|${s.unit ?? ''}`} summary={s} onFix={onFix ? (fix) => onFix(s, fix) : undefined} />
        ))}
      </View>
      <Text className="font-sans text-sm mt-2.5" style={{ color: colors.fgTertiary }}>
        Added up on your phone from the numbers in your notes.
      </Text>
    </View>
  );
}
