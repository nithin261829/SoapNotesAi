import { StyleSheet, Text, View } from 'react-native';

import { useStyles } from '@/theme/ThemeContext';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

export function TranscriptCard({ text }: { text: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.card}>
      <View style={styles.tagPill}>
        <Text style={styles.tagPillText}>Source · verbatim</Text>
      </View>
      <Text style={styles.title}>Transcript</Text>
      <Text style={styles.body}>{text || '— no transcript —'}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.lg,
      gap: space.sm,
    },
    tagPill: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.sm,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
    },
    tagPillText: {
      fontSize: font.size.xs - 1,
      color: c.accent,
      fontWeight: font.weight.bold as '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    title: {
      fontSize: font.size.xl,
      fontWeight: font.weight.bold as '700',
      color: c.text,
      letterSpacing: -0.4,
      marginTop: 4,
    },
    body: {
      fontSize: font.size.base - 1,
      color: c.textMuted,
      lineHeight: 22,
      marginTop: space.sm,
    },
  });
