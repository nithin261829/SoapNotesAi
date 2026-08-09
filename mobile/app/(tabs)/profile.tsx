import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, switchActiveClinic, signOut } = useAuth();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const memberships = profile?.profile.memberships ?? [];
  const activeClinicId = profile?.profile.default_clinic_id;

  const handleSwitch = async (clinicId: string) => {
    if (clinicId === activeClinicId || switching) return;
    setError(null);
    setSwitching(clinicId);
    try {
      await switchActiveClinic(clinicId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch clinic');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <BrandLogo />
      <Text style={styles.pageTitle}>Profile</Text>

      <View style={styles.card}>
        <View style={styles.tagPill}>
          <Text style={styles.tagPillText}>Account</Text>
        </View>
        <Text style={styles.name}>
          {profile?.profile.display_name ?? user?.displayName ?? 'Signed-in doctor'}
        </Text>
        <Text style={styles.email}>{user?.email ?? ''}</Text>
        {profile?.profile.credentials ? (
          <Text style={styles.credentials}>{profile.profile.credentials}</Text>
        ) : null}
        {profile?.profile.registration_id ? (
          <Text style={styles.registrationId}>
            Doctor ID: {profile.profile.registration_id}
          </Text>
        ) : null}
      </View>

      {profile ? (
        <View style={styles.card}>
          <View style={styles.tagPill}>
            <Text style={styles.tagPillText}>Organization</Text>
          </View>
          <Text style={styles.orgName}>{profile.org_name ?? profile.profile.org_id}</Text>
          <Text style={styles.activeClinic}>
            Active clinic:{' '}
            <Text style={styles.activeClinicValue}>
              {profile.active_clinic_name ?? activeClinicId ?? '—'}
            </Text>
          </Text>
        </View>
      ) : null}

      {/* Settings entry — appearance + other prefs live behind here */}
      <Pressable
        onPress={() => router.push('/settings')}
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        style={({ pressed }) => [styles.settingsRow, { opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={styles.settingsIcon}>
          <Feather name="settings" size={18} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.settingsLabel}>Settings</Text>
          <Text style={styles.settingsHint}>Appearance and preferences</Text>
        </View>
        <Feather name="chevron-right" size={20} color={c.textSubtle} />
      </Pressable>

      {memberships.length > 1 ? (
        <View style={styles.card}>
          <View style={styles.tagPill}>
            <Text style={styles.tagPillText}>Switch clinic</Text>
          </View>
          <Text style={styles.switchHelp}>
            You're a member of {memberships.length} clinics. Tap to switch the active one.
          </Text>
          <View style={styles.switchList}>
            {memberships.map((m) => {
              const isActive = m.clinic_id === activeClinicId;
              const isSwitching = switching === m.clinic_id;
              return (
                <Pressable
                  key={m.clinic_id}
                  onPress={() => void handleSwitch(m.clinic_id)}
                  disabled={isActive || switching !== null}
                  style={({ pressed }) => [
                    styles.switchRow,
                    isActive && styles.switchRowActive,
                    { opacity: pressed && !isActive ? 0.7 : 1 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchName}>{m.clinic_id}</Text>
                    <Text style={styles.switchRole}>{m.role}</Text>
                  </View>
                  {isSwitching ? (
                    <ActivityIndicator color={c.accent} />
                  ) : isActive ? (
                    <Text style={styles.activeBadge}>ACTIVE</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void signOut()}
        style={({ pressed }) => [styles.signOutBtn, { opacity: pressed ? 0.75 : 1 }]}
      >
        <Text style={styles.signOutLabel}>SIGN OUT</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
      padding: space.lg,
      paddingBottom: 100,
      gap: space.lg,
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
    name: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xl,
      color: c.text,
      marginTop: 6,
      letterSpacing: -0.4,
    },
    email: { fontFamily: fonts.display, fontSize: font.size.sm, color: c.textMuted },
    credentials: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs,
      color: c.accent,
      letterSpacing: 0.8,
    },
    registrationId: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.xs,
      color: c.textMuted,
      letterSpacing: 0.4,
    },
    orgName: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.lg,
      color: c.text,
      marginTop: 4,
      letterSpacing: -0.3,
    },
    activeClinic: { fontFamily: fonts.display, fontSize: font.size.sm, color: c.textMuted },
    activeClinicValue: { fontFamily: fonts.displaySemi, color: c.text },

    settingsRow: {
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
    settingsIcon: {
      width: 36,
      height: 36,
      borderRadius: radii.sm,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    settingsLabel: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.base,
      color: c.text,
      letterSpacing: -0.2,
    },
    settingsHint: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textMuted,
      marginTop: 2,
    },

    switchHelp: { fontFamily: fonts.display, fontSize: font.size.sm, color: c.textMuted, lineHeight: 18 },
    switchList: { gap: 8 },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm + 2,
      gap: space.sm,
    },
    switchRowActive: { borderColor: c.accent },
    switchName: { fontFamily: fonts.displaySemi, fontSize: font.size.base, color: c.text },
    switchRole: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 2,
    },
    activeBadge: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs - 1,
      color: c.accent,
      letterSpacing: 0.8,
    },
    errorText: { fontFamily: fonts.display, color: c.danger, fontSize: font.size.sm, marginTop: 4 },

    signOutBtn: {
      paddingVertical: space.md + 2,
      paddingHorizontal: space.lg,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.borderStrong,
      alignItems: 'center',
    },
    signOutLabel: {
      fontFamily: fonts.displayBold,
      color: c.text,
      fontSize: font.size.sm,
      letterSpacing: 1.2,
    },
  });
