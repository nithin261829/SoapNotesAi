import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { updateMe } from '@/api/accounts';
import { listPatients } from '@/api/patients';
import { getVerificationStatus } from '@/api/verification';
import { useAuth } from '@/auth/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, shadow, space, type ThemeColors } from '@/theme/tokens';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** Derive up-to-two uppercase initials from a display name (falls back gracefully). */
function initials(name?: string | null, email?: string | null): string {
  const source = (name ?? '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p.charAt(0));
    if (letters.length) return letters.join('').toUpperCase();
  }
  const e = (email ?? '').trim();
  if (e) return e.charAt(0).toUpperCase();
  return 'DR';
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, getIdToken, refreshProfile, switchActiveClinic, signOut } = useAuth();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [stats, setStats] = useState<{ patients: number; notes: number } | null>(null);
  const [verified, setVerified] = useState<'verified' | 'pending' | 'rejected' | 'unverified' | null>(
    null,
  );

  useEffect(() => {
    if (!profile) return;
    void (async () => {
      try {
        const token = await getIdToken();
        const [patients, vs] = await Promise.all([
          listPatients(token),
          getVerificationStatus(token).catch(() => null),
        ]);
        const notes = patients.reduce((sum, p) => sum + (p.patient.recording_count ?? 0), 0);
        setStats({ patients: patients.length, notes });
        if (vs) setVerified(vs.status);
      } catch {
        /* stats are best-effort; the page works without them */
      }
    })();
  }, [profile, getIdToken]);

  const memberships = profile?.profile.memberships ?? [];
  const activeClinicId = profile?.profile.default_clinic_id;

  const displayName = profile?.profile.display_name ?? user?.displayName ?? 'Signed-in doctor';
  const email = user?.email ?? '';

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
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + 112 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <BrandLogo height={26} align="right" />
      </View>

      {/* ── Identity header ─────────────────────────────────────────── */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>Account</Text>
        {profile ? (
          <Pressable
            onPress={() => setEditOpen(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
          >
            <Feather name="edit-2" size={12} color={c.accent} />
            <Text style={styles.editBtnText}>EDIT</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.card, styles.identityCard]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(displayName, email)}</Text>
        </View>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{displayName}</Text>
          {verified === 'verified' ? (
            <View style={styles.verifiedSeal}>
              <Feather name="check" size={11} color={c.textOnAccent} />
            </View>
          ) : null}
        </View>

        {profile?.profile.credentials ? (
          <View style={styles.credChip}>
            <Feather name="award" size={12} color={c.accent} />
            <Text style={styles.credChipText}>{profile.profile.credentials}</Text>
          </View>
        ) : null}

        {profile?.profile.registration_id ? (
          <View style={styles.idBadge}>
            <Feather name="hash" size={12} color={c.textMuted} />
            <Text style={styles.idBadgeLabel}>Doctor ID</Text>
            <Text style={styles.idBadgeValue}>{profile.profile.registration_id}</Text>
          </View>
        ) : null}

        {email ? (
          <View style={styles.emailRow}>
            <Feather name="mail" size={13} color={c.textSubtle} />
            <Text style={styles.email}>{email}</Text>
          </View>
        ) : null}
      </View>

      {/* ── Stat tiles ──────────────────────────────────────────────── */}
      <View style={styles.statsRow}>
        <View style={styles.statTile}>
          <Text style={styles.statValue}>{stats ? stats.patients : '—'}</Text>
          <Text style={styles.statLabel}>Patients</Text>
        </View>
        <View style={styles.statTile}>
          <Text style={styles.statValue}>{stats ? stats.notes : '—'}</Text>
          <Text style={styles.statLabel}>Notes</Text>
        </View>
        <View style={styles.statTile}>
          <Text style={[styles.statValue, verified === 'verified' && { color: c.accent }]}>
            {verified === 'verified'
              ? '✓'
              : verified === 'pending'
                ? '…'
                : verified === 'rejected'
                  ? '✕'
                  : '—'}
          </Text>
          <Text style={styles.statLabel}>
            {verified === 'verified'
              ? 'Verified'
              : verified === 'pending'
                ? 'In review'
                : 'Verify'}
          </Text>
        </View>
      </View>

      {/* ── Organisation ────────────────────────────────────────────── */}
      {profile ? (
        <>
          <Text style={styles.sectionLabel}>Organisation</Text>
          <View style={styles.card}>
            <View style={styles.orgHeader}>
              <View style={styles.orgIcon}>
                <Feather name="briefcase" size={16} color={c.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.orgName}>{profile.org_name ?? profile.profile.org_id}</Text>
                <Text style={styles.orgSub}>
                  Active clinic:{' '}
                  <Text style={styles.orgSubValue}>
                    {profile.active_clinic_name ?? activeClinicId ?? '—'}
                  </Text>
                </Text>
              </View>
            </View>

            {memberships.length > 1 ? (
              <>
                <View style={styles.divider} />
                <Text style={styles.switchHelp}>
                  You&apos;re a member of {memberships.length} clinics. Tap to switch the active one.
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
                        <View
                          style={[styles.switchDot, isActive && styles.switchDotActive]}
                        >
                          {isActive ? (
                            <Feather name="check" size={13} color={c.textOnAccent} />
                          ) : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.switchName}>{m.clinic_id}</Text>
                          <Text style={styles.switchRole}>{m.role}</Text>
                        </View>
                        {isSwitching ? <ActivityIndicator size="small" color={c.accent} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </>
            ) : null}
          </View>
        </>
      ) : null}

      {/* ── Preferences ─────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Preferences</Text>
      <View style={styles.card}>
        <Pressable
          onPress={() => router.push('/verification' as never)}
          accessibilityRole="button"
          accessibilityLabel="Doctor verification"
          style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={styles.listIcon}>
            <Feather name="shield" size={17} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.listLabel}>Doctor verification</Text>
            <Text style={styles.listHint}>
              {verified === 'verified'
                ? 'Verified — badge prints on your PDFs'
                : verified === 'pending'
                  ? 'Documents under review'
                  : 'Get the verified badge on your PDFs'}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={c.textSubtle} />
        </Pressable>
        <View style={styles.rowDivider} />
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={styles.listIcon}>
            <Feather name="settings" size={17} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.listLabel}>Settings</Text>
            <Text style={styles.listHint}>Appearance and preferences</Text>
          </View>
          <Feather name="chevron-right" size={20} color={c.textSubtle} />
        </Pressable>
      </View>

      {/* ── Sign out ────────────────────────────────────────────────── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => void signOut()}
        style={({ pressed }) => [styles.signOutBtn, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Feather name="log-out" size={16} color={c.danger} />
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        <Text style={styles.footerVersion}>Version {APP_VERSION}</Text>
        <Text style={styles.footerBrand}>Voice to SOAP notes</Text>
      </View>

      <EditProfileModal
        open={editOpen}
        initial={{
          displayName: profile?.profile.display_name ?? '',
          credentials: profile?.profile.credentials ?? '',
          phone: profile?.profile.phone ?? '',
        }}
        onClose={() => setEditOpen(false)}
        onSaved={async () => {
          await refreshProfile();
          setEditOpen(false);
        }}
      />
    </ScrollView>
  );
}

function EditProfileModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: { displayName: string; credentials: string; phone: string };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const { getIdToken } = useAuth();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [credentials, setCredentials] = useState(initial.credentials);
  const [phone, setPhone] = useState(initial.phone);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDisplayName(initial.displayName);
      setCredentials(initial.credentials);
      setPhone(initial.phone);
      setErr(null);
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const token = await getIdToken();
      await updateMe(token, {
        display_name: displayName.trim(),
        credentials: credentials.trim(),
        phone: phone.trim(),
      });
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: c.bg }}
      >
        <ScrollView contentContainerStyle={styles.editContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.editTitle}>Edit profile</Text>
          <Text style={styles.editHint}>No need to add “Dr.” — we add it automatically.</Text>

          <View style={{ gap: 6 }}>
            <Text style={styles.editLabel}>Your name</Text>
            <TextInput
              style={styles.editInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Jane Smith"
              placeholderTextColor={c.textDim}
              autoCapitalize="words"
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={styles.editLabel}>Credentials</Text>
            <TextInput
              style={styles.editInput}
              value={credentials}
              onChangeText={setCredentials}
              placeholder="MD, MPT, etc."
              placeholderTextColor={c.textDim}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={styles.editLabel}>Phone</Text>
            <TextInput
              style={styles.editInput}
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 …"
              keyboardType="phone-pad"
              placeholderTextColor={c.textDim}
            />
          </View>

          {err ? <Text style={styles.editError}>{err}</Text> : null}

          <Pressable
            onPress={() => void onSave()}
            disabled={saving}
            style={({ pressed }) => [styles.editSave, { opacity: saving ? 0.5 : pressed ? 0.85 : 1 }]}
          >
            {saving ? (
              <ActivityIndicator color={c.textOnAccent} />
            ) : (
              <Text style={styles.editSaveText}>SAVE CHANGES</Text>
            )}
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center', marginTop: 8 }}>
            <Text style={styles.editCancel}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
    },
    content: {
      paddingHorizontal: space.lg,
      gap: space.sm,
    },
    topBar: {
      marginBottom: space.xs,
    },

    sectionLabel: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs,
      color: c.textMuted,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginTop: space.md,
      marginBottom: space.xs,
      marginLeft: space.xs,
    },

    card: {
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.lg,
      gap: space.md,
      ...shadow.card,
    },

    // Identity header.
    identityCard: {
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: space.xl,
    },
    avatar: {
      width: 76,
      height: 76,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoftStrong,
      borderWidth: 1.5,
      borderColor: c.accentDim,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: space.xs,
    },
    avatarText: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xxl,
      color: c.accent,
      letterSpacing: -0.5,
    },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    name: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xl,
      color: c.text,
      letterSpacing: -0.4,
      textAlign: 'center',
    },
    verifiedSeal: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statsRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
    statTile: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: space.md + 2,
      alignItems: 'center',
      gap: 3,
      ...shadow.card,
    },
    statValue: {
      fontFamily: fonts.displayExtra,
      fontSize: font.size.xxl,
      color: c.text,
      letterSpacing: -0.5,
    },
    statLabel: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.xs - 1,
      color: c.textMuted,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    rowDivider: { height: 1, backgroundColor: c.border, marginVertical: 2 },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    editBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
      marginTop: space.md,
    },
    editBtnText: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs - 1,
      color: c.accent,
      letterSpacing: 0.8,
    },
    editContent: { padding: space.lg, paddingTop: space.xl, gap: space.md },
    editTitle: { fontFamily: fonts.displayBold, fontSize: font.size.xxl, color: c.text, letterSpacing: -0.5 },
    editHint: { fontFamily: fonts.display, fontSize: font.size.sm, color: c.textMuted, marginTop: -6 },
    editLabel: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs,
      color: c.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    editInput: {
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      paddingHorizontal: space.md,
      height: 50,
      color: c.text,
      fontFamily: fonts.display,
      fontSize: font.size.base,
    },
    editError: { fontFamily: fonts.display, color: c.danger, fontSize: font.size.sm },
    editSave: {
      height: 52,
      borderRadius: radii.md,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.sm,
    },
    editSaveText: {
      fontFamily: fonts.displayBold,
      color: c.textOnAccent,
      fontSize: font.size.sm,
      letterSpacing: 1.2,
    },
    editCancel: { fontFamily: fonts.displaySemi, color: c.textMuted, fontSize: font.size.sm },
    credChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
    },
    credChipText: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.xs,
      color: c.accent,
      letterSpacing: 0.4,
    },
    idBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.sm,
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.border,
    },
    idBadgeLabel: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.xs - 1,
      color: c.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    idBadgeValue: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.sm,
      color: c.text,
      letterSpacing: 1,
    },
    emailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    email: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
    },

    // Organisation.
    orgHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
    },
    orgIcon: {
      width: 40,
      height: 40,
      borderRadius: radii.md,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orgName: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.lg,
      color: c.text,
      letterSpacing: -0.3,
    },
    orgSub: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
      marginTop: 2,
    },
    orgSubValue: { fontFamily: fonts.displaySemi, color: c.text },

    divider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: space.xs,
    },

    switchHelp: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
      lineHeight: 18,
    },
    switchList: { gap: space.sm },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      gap: space.md,
    },
    switchRowActive: {
      borderColor: c.accent,
      backgroundColor: c.accentSoft,
    },
    switchDot: {
      width: 22,
      height: 22,
      borderRadius: radii.pill,
      borderWidth: 1.5,
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    switchDotActive: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    switchName: { fontFamily: fonts.displaySemi, fontSize: font.size.base, color: c.text },
    switchRole: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 2,
    },
    errorText: {
      fontFamily: fonts.display,
      color: c.danger,
      fontSize: font.size.sm,
      marginTop: space.xs,
    },

    // Preferences list rows.
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
    },
    listIcon: {
      width: 40,
      height: 40,
      borderRadius: radii.md,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listLabel: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.base,
      color: c.text,
      letterSpacing: -0.2,
    },
    listHint: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textMuted,
      marginTop: 2,
    },

    // Sign out.
    signOutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.sm,
      marginTop: space.md,
      paddingVertical: space.md + 2,
      paddingHorizontal: space.lg,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.danger,
      backgroundColor: c.dangerSoft,
    },
    signOutLabel: {
      fontFamily: fonts.displayBold,
      color: c.danger,
      fontSize: font.size.base,
      letterSpacing: 0.2,
    },

    // Footer.
    footer: {
      alignItems: 'center',
      gap: 3,
      marginTop: space.xl,
    },
    footerVersion: {
      fontFamily: fonts.displayMedium,
      fontSize: font.size.xs,
      color: c.textSubtle,
      letterSpacing: 0.3,
    },
    footerBrand: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textDim,
      letterSpacing: 0.3,
    },
  });
