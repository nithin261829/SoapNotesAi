import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useStyles } from '@/theme/ThemeContext';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

interface Props {
  isPaused: boolean;
  onPauseToggle: () => void;
  onConfirm: () => void;
  disabled?: boolean;
}

export function TransportControls({ isPaused, onPauseToggle, onConfirm, disabled }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPaused ? 'Resume recording' : 'Pause recording'}
        onPress={onPauseToggle}
        disabled={disabled}
        style={({ pressed }) => [styles.btn, styles.secondary, { opacity: pressed || disabled ? 0.6 : 1 }]}
      >
        <Text style={styles.secondaryLabel}>{(isPaused ? 'Resume' : 'Pause').toUpperCase()}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Confirm and end recording"
        onPress={onConfirm}
        disabled={disabled}
        style={({ pressed }) => [styles.btn, styles.primary, { opacity: pressed || disabled ? 0.75 : 1 }]}
      >
        <Text style={styles.primaryLabel}>CONFIRM →</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
    btn: {
      paddingVertical: space.md + 2,
      paddingHorizontal: space.xl,
      borderRadius: radii.md,
      minWidth: 130,
      alignItems: 'center',
      borderWidth: 1,
    },
    primary: { backgroundColor: c.accent, borderColor: c.accent },
    secondary: { backgroundColor: 'transparent', borderColor: c.borderStrong },
    primaryLabel: {
      color: c.textOnAccent,
      fontSize: font.size.sm,
      fontWeight: font.weight.bold as '700',
      letterSpacing: 1,
    },
    secondaryLabel: {
      color: c.text,
      fontSize: font.size.sm,
      fontWeight: font.weight.bold as '700',
      letterSpacing: 1,
    },
  });
