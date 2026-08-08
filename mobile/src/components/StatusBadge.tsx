import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeContext';
import { font, radii, type ThemeColors } from '@/theme/tokens';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

interface Props {
  tone?: StatusTone;
  label: string;
}

export function StatusBadge({ tone = 'neutral', label }: Props) {
  const c = useThemeColors();
  const palette = useMemo(() => makePalette(c), [c]);
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg[tone], borderColor: palette.border[tone] }]}>
      <View style={[styles.dot, { backgroundColor: palette.fg[tone] }]} />
      <Text style={[styles.label, { color: palette.fg[tone] }]}>{label}</Text>
    </View>
  );
}

function makePalette(c: ThemeColors) {
  return {
    fg: {
      neutral: c.textMuted,
      info: c.accent,
      success: c.success,
      warning: c.warning,
      danger: c.danger,
      accent: c.accent,
    } satisfies Record<StatusTone, string>,
    bg: {
      neutral: 'transparent',
      info: c.accentSoft,
      success: c.successSoft,
      warning: c.warningSoft,
      danger: c.dangerSoft,
      accent: c.accentSoft,
    } satisfies Record<StatusTone, string>,
    border: {
      neutral: c.border,
      info: c.accent,
      success: c.success,
      warning: c.warning,
      danger: c.danger,
      accent: c.accent,
    } satisfies Record<StatusTone, string>,
  };
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  label: {
    fontSize: font.size.xs - 1,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
