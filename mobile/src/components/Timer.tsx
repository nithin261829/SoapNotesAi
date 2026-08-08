import { StyleSheet, Text, View } from 'react-native';

import { formatTime } from '@/recording/formatTime';
import { useStyles } from '@/theme/ThemeContext';
import { font, type ThemeColors } from '@/theme/tokens';

interface Props {
  ms: number;
  active?: boolean;
}

export function Timer({ ms, active = false }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      {active ? <View style={styles.dot} /> : null}
      <Text
        accessibilityLabel={`Elapsed ${formatTime(ms)}`}
        style={[styles.text, active && styles.textActive]}
      >
        {formatTime(ms)}
      </Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.recording },
    text: {
      fontSize: font.size.hero,
      fontVariant: ['tabular-nums'],
      color: c.text,
      fontWeight: font.weight.semibold as '600',
      letterSpacing: -1,
    },
    textActive: { color: c.recording },
  });
