import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { updateMe } from '@/api/accounts';
import { useAuth } from '@/auth/AuthContext';
import { useStyles, useTheme, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, shadow, space, type ThemeColors } from '@/theme/tokens';

type Mode = 'light' | 'dark' | 'system';
const MODE_OPTIONS: { value: Mode; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'smartphone' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const { profile, getIdToken, refreshProfile } = useAuth();
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const [remindersEnabled, setRemindersEnabled] = useState(
    profile?.profile.reminders_enabled ?? true,
  );
  const [savingReminders, setSavingReminders] = useState(false);

  const onToggleReminders = async (next: boolean) => {
    setRemindersEnabled(next); // optimistic
    setSavingReminders(true);
    try {
      const token = await getIdToken();
      await updateMe(token, { reminders_enabled: next });
      await refreshProfile();
    } catch {
      setRemindersEnabled(!next); // revert on failure
    } finally {
      setSavingReminders(false);
    }
  };

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

        {/* Notifications — follow-up reminder push alerts for the doctor */}
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Notifications</Text>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Text style={styles.toggleLabel}>Follow-up reminders</Text>
              <Text style={styles.hint}>
                Get a push alert the day before and the day of a patient&apos;s follow-up.
              </Text>
            </View>
            <Switch
              value={remindersEnabled}
              onValueChange={onToggleReminders}
              disabled={savingReminders}
              trackColor={{ false: c.border, true: c.accent }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.eyebrow}>Appearance</Text>
          <Text style={styles.hint}>
            Choose light, dark, or follow your device setting.
          </Text>
          <View style={styles.segRow}>
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setMode(opt.value)}
                  style={({ pressed }) => [
                    styles.segBtn,
                    active && styles.segBtnActive,
                    pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                  ]}
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
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: space.xs,
    },
    toggleLabel: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.base,
      color: c.text,
      letterSpacing: -0.2,
    },
    scroll: { padding: space.lg, gap: space.md, paddingBottom: 60 },
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
      marginBottom: space.xs,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.xl,
      padding: space.lg,
      gap: space.sm,
      ...shadow.card,
    },
    eyebrow: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs,
      color: c.textMuted,
      letterSpacing: 1,
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
      padding: 5,
      backgroundColor: c.surfaceHover,
      borderRadius: radii.lg,
      marginTop: space.xs,
    },
    segBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 11,
      borderRadius: radii.md,
    },
    segBtnActive: { backgroundColor: c.accent, ...shadow.sm },
    segText: {
      fontFamily: fonts.displayBold,
      color: c.textMuted,
      fontSize: font.size.xs,
      letterSpacing: 0.6,
    },
    segTextActive: { color: c.textOnAccent },
  });
