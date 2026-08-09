import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useStyles, useTheme, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

type Mode = 'light' | 'dark' | 'system';
const MODE_OPTIONS: { value: Mode; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'smartphone' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const c = useThemeColors();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
              hitSlop={10}
              style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Feather name="chevron-left" size={24} color={c.text} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.pageTitle}>Settings</Text>

        {/* Payments & plans — wallet top-ups, subscription tiers (Razorpay) */}
        <Pressable
          onPress={() => router.push('/payments' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open payments and plans"
          style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="credit-card" size={18} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.linkLabel}>Payments & Plans</Text>
            <Text style={styles.linkHint}>Wallet, subscriptions, and top-ups</Text>
          </View>
          <Feather name="chevron-right" size={20} color={c.textSubtle} />
        </Pressable>

        {/* Doctor verification — medical-council proof upload, verified PDF badge */}
        <Pressable
          onPress={() => router.push('/verification' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open doctor verification"
          style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="shield" size={18} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.linkLabel}>Doctor Verification</Text>
            <Text style={styles.linkHint}>Get the verified badge on your PDFs</Text>
          </View>
          <Feather name="chevron-right" size={20} color={c.textSubtle} />
        </Pressable>

        {/* Letterhead — clinic branding printed on every PDF */}
        <Pressable
          onPress={() => router.push('/letterhead' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open letterhead settings"
          style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="file-text" size={18} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.linkLabel}>Letterhead</Text>
            <Text style={styles.linkHint}>Clinic branding printed on every PDF</Text>
          </View>
          <Feather name="chevron-right" size={20} color={c.textSubtle} />
        </Pressable>

        <View style={styles.card}>
          <View style={styles.tagPill}>
            <Text style={styles.tagPillText}>Appearance</Text>
          </View>
          <Text style={styles.hint}>
            Choose light, dark, or follow your iPhone setting.
          </Text>
          <View style={styles.segRow}>
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setMode(opt.value)}
                  style={[styles.segBtn, active && styles.segBtnActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Appearance: ${opt.label}`}
                >
                  <Feather
                    name={opt.icon}
                    size={16}
                    color={active ? c.textOnAccent : c.textMuted}
                  />
                  <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scroll: { padding: space.lg, gap: space.lg, paddingBottom: 60 },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
    backText: {
      fontFamily: fonts.displaySemi,
      color: c.text,
      fontSize: font.size.base,
      marginLeft: -2,
    },
    pageTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 34,
      lineHeight: 40,
      color: c.text,
      letterSpacing: -1,
    },
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
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs - 1,
      color: c.accent,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    hint: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
      lineHeight: 18,
    },
    segRow: {
      flexDirection: 'row',
      gap: 6,
      padding: 4,
      backgroundColor: c.surfaceElevated,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      marginTop: 4,
    },
    segBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: radii.sm,
    },
    segBtnActive: { backgroundColor: c.accent },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: space.lg,
      paddingVertical: space.md + 2,
    },
    linkIcon: {
      width: 36,
      height: 36,
      borderRadius: radii.sm,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkLabel: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.base,
      color: c.text,
      letterSpacing: -0.2,
    },
    linkHint: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textMuted,
      marginTop: 2,
    },
    segText: {
      fontFamily: fonts.displayBold,
      color: c.textMuted,
      fontSize: font.size.xs,
      letterSpacing: 0.6,
    },
    segTextActive: { color: c.textOnAccent },
  });
