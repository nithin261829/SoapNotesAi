import { StyleSheet, Text, View } from 'react-native';

import { useStyles } from '@/theme/ThemeContext';
import { font, radii, type ThemeColors } from '@/theme/tokens';

interface Props {
  label: string;
}

export function Chip({ label }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

interface RowProps {
  items: string[];
  emptyHint?: string;
}

export function ChipRow({ items, emptyHint }: RowProps) {
  const styles = useStyles(makeStyles);
  if (items.length === 0) {
    return emptyHint ? <Text style={styles.empty}>{emptyHint}</Text> : null;
  }
  return (
    <View style={styles.row}>
      {items.map((it, i) => (
        <Chip key={`${i}-${it}`} label={it} />
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.sm,
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.border,
    },
    label: { fontSize: font.size.xs + 1, color: c.text, fontWeight: font.weight.medium as '500' },
    empty: { fontSize: font.size.xs + 1, color: c.textDim, fontStyle: 'italic' },
  });
