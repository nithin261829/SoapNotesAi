import { StyleSheet, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeContext';

interface Props {
  level: number | null;
  bars?: number;
}

export function LevelMeter({ level, bars = 28 }: Props) {
  const c = useThemeColors();
  const value = level ?? 0;
  return (
    <View accessibilityElementsHidden style={styles.row}>
      {Array.from({ length: bars }, (_, i) => {
        const threshold = (i + 1) / bars;
        const active = value >= threshold * 0.6;
        const height = 4 + Math.round((i / bars) * 22);
        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height,
                backgroundColor: active ? c.recording : c.borderStrong,
                opacity: active ? 1 : 0.6,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    gap: 3,
  },
  bar: { width: 3, borderRadius: 1.5 },
});
