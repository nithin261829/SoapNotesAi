import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { font, space, type ThemeColors } from '@/theme/tokens';

export type SubStepStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

export interface SubStep {
  key: string;
  label: string;
  status: SubStepStatus;
  detail?: string | null;
}

interface Props {
  steps: SubStep[];
}

const STATUS_TONE: Record<SubStepStatus, StatusTone> = {
  pending: 'neutral',
  in_progress: 'accent',
  done: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

const STATUS_LABEL: Record<SubStepStatus, string> = {
  pending: 'Idle',
  in_progress: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function ProcessingSteps({ steps }: Props) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const bulletFg = useMemo<Record<SubStepStatus, string>>(
    () => ({
      pending: c.textDim,
      in_progress: c.accent,
      done: c.success,
      failed: c.danger,
      skipped: c.textDim,
    }),
    [c],
  );
  return (
    <View style={styles.wrap}>
      {steps.map((s, i) => (
        <View key={s.key} style={styles.row}>
          <View style={styles.rail}>
            <View
              style={[
                styles.bullet,
                { borderColor: bulletFg[s.status] },
                s.status === 'done' || s.status === 'in_progress'
                  ? { backgroundColor: bulletFg[s.status] }
                  : null,
              ]}
            />
            {i < steps.length - 1 ? <View style={styles.connector} /> : null}
          </View>

          <View style={styles.content}>
            <View style={styles.headerRow}>
              <Text
                style={[
                  styles.label,
                  s.status === 'pending' || s.status === 'skipped' ? styles.labelMuted : null,
                ]}
              >
                {s.label}
              </Text>
              <StatusBadge tone={STATUS_TONE[s.status]} label={STATUS_LABEL[s.status]} />
            </View>
            {s.detail ? <Text style={styles.detail}>{s.detail}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const BULLET = 14;

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: { gap: space.base, marginTop: space.md },
    row: { flexDirection: 'row', gap: space.md },
    rail: { alignItems: 'center', width: BULLET, paddingTop: 5 },
    bullet: { width: BULLET, height: BULLET, borderRadius: BULLET / 2, borderWidth: 2 },
    connector: {
      width: 1,
      flex: 1,
      minHeight: 18,
      marginTop: 4,
      backgroundColor: c.border,
    },
    content: { flex: 1, paddingBottom: space.xs, gap: 4 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    label: {
      fontSize: font.size.md,
      fontWeight: font.weight.semibold as '600',
      color: c.text,
      letterSpacing: -0.1,
    },
    labelMuted: { color: c.textDim, fontWeight: font.weight.medium as '500' },
    detail: { fontSize: font.size.xs + 1, color: c.textMuted, lineHeight: 17 },
  });
