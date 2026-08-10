import { type AuthError } from 'firebase/auth';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AccountsError } from '@/api/accounts';
import { useAuth } from '@/auth/AuthContext';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, shadow, space, type ThemeColors } from '@/theme/tokens';

export default function SetupScreen() {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const { user, provisionOrg, signOut } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create-org fields
  const [orgName, setOrgName] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [credentials, setCredentials] = useState('');


  const createDisabled =
    submitting || orgName.trim().length < 1 || clinicName.trim().length < 1;

  const onCreate = async () => {
    if (createDisabled) return;
    setError(null);
    setSubmitting(true);
    try {
      await provisionOrg({
        orgName: orgName.trim(),
        clinicName: clinicName.trim(),
        displayName: displayName.trim() || undefined,
        credentials: credentials.trim() || undefined,
      });
      // AuthGate redirects to /(tabs)/record automatically.
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.kav}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.lockupRow}>
            <Text style={styles.wordmark}>SoapNotesAi</Text>
            <View style={styles.lockupDivider} />
            <Image
              source={require('../../assets/logo.png')}
              style={styles.lockupLogo}
              resizeMode="contain"
              accessibilityLabel="SoapNotesAi"
            />
          </View>
          <Text style={styles.accountEyebrow}>{user?.email ?? 'New account'} · one last step</Text>
          <Text style={styles.title}>Set up your account.</Text>
          <Text style={styles.subtitle}>
            Name your organization and clinic — you can add more clinics later.
          </Text>
        </View>

        {/* Form card */}
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Organization</Text>
          <Field label="Organization name" value={orgName} onChangeText={setOrgName} placeholder="e.g. Acme Health Group" />
          <Field label="Clinic name" value={clinicName} onChangeText={setClinicName} placeholder="e.g. Downtown Family Practice" />

          <View style={styles.divider} />

          <Text style={styles.eyebrow}>Your profile (optional)</Text>
          <Field label="Your name" value={displayName} onChangeText={setDisplayName} placeholder="Jane Smith" />
          <Text style={styles.fieldHint}>No need to add “Dr.” — we add it automatically.</Text>
          <Field label="Credentials" value={credentials} onChangeText={setCredentials} placeholder="MD" autoCapitalize="characters" />

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            disabled={createDisabled}
            onPress={() => void onCreate()}
            style={({ pressed }) => [
              styles.primaryBtn,
              createDisabled && { opacity: 0.45 },
              !createDisabled && pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={c.textOnAccent} />
            ) : (
              <Text style={styles.primaryBtnLabel}>CREATE ORGANIZATION →</Text>
            )}
          </Pressable>
        </View>

        <Pressable
          onPress={() => void signOut()}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.signOutLink,
            pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
          ]}
        >
          <Text style={styles.signOutLinkText}>Sign out</Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          Draft assistive tool · review and sign every note before clinical use.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textDim}
        autoCapitalize={autoCapitalize ?? 'words'}
        autoCorrect={false}
      />
    </View>
  );
}

function humanizeError(e: unknown): string {
  if (e instanceof AccountsError) {
    switch (e.code) {
      case 'already_provisioned':
        return 'This account is already set up. Reload the app.';
      case 'invite_not_found':
        return 'No invite with that code. Check it with your admin.';
      case 'invite_already_used':
        return 'That invite has already been used.';
      case 'invite_expired':
        return 'That invite has expired. Ask your admin for a new one.';
      case 'identity_required_on_token':
      case 'email_required_on_token':
        return 'Your sign-in is missing an email. Sign out and sign back in.';
      default:
        return e.code ?? e.message;
    }
  }
  if (e && typeof e === 'object' && 'code' in e) {
    return (e as AuthError).message ?? 'Something went wrong';
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  kav: { flex: 1, backgroundColor: c.bg },
  scroll: { backgroundColor: c.bg },
  container: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.xxl * 2 + space.md,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  lockupRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  wordmark: { fontFamily: fonts.brand, fontSize: 26, color: c.text, letterSpacing: -0.5 },
  lockupDivider: { width: 1, height: 24, backgroundColor: c.borderStrong },
  lockupLogo: { width: 84, height: 34 },
  accountEyebrow: {
    fontFamily: fonts.displayMedium,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 0.4,
    marginTop: space.sm,
  },
  hero: { gap: space.sm },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.hero - 6,
    color: c.text,
    letterSpacing: -1.2,
    lineHeight: 44,
    marginTop: space.sm,
  },
  subtitle: {
    fontFamily: fonts.display,
    fontSize: font.size.md,
    color: c.textMuted,
    lineHeight: 22,
  },

  card: {
    backgroundColor: c.surface,
    borderRadius: radii.xl,
    padding: space.lg,
    gap: space.base,
    ...shadow.card,
  },
  eyebrow: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  fieldHint: { fontFamily: fonts.display, fontSize: font.size.xs, color: c.textMuted, marginTop: -2 },
  label: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: c.surface,
    borderRadius: radii.md,
    paddingHorizontal: space.base,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: c.text,
    fontFamily: fonts.display,
    fontSize: font.size.base,
    ...shadow.sm,
  },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 4 },

  errorBox: {
    backgroundColor: c.dangerSoft,
    borderRadius: radii.md,
    padding: space.md,
    ...shadow.sm,
  },
  errorText: {
    fontFamily: fonts.displayMedium,
    color: c.danger,
    fontSize: font.size.sm,
    lineHeight: 19,
  },

  primaryBtn: {
    marginTop: space.xs,
    height: 52,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  primaryBtnLabel: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    fontSize: font.size.sm,
    letterSpacing: 1.2,
  },

  signOutLink: { alignSelf: 'center', paddingVertical: space.md },
  signOutLinkText: {
    fontFamily: fonts.displaySemi,
    color: c.textMuted,
    fontSize: font.size.sm,
    letterSpacing: 0.5,
  },

  disclaimer: {
    marginTop: 'auto',
    fontFamily: fonts.display,
    fontSize: font.size.xs,
    color: c.textDim,
    textAlign: 'center',
    lineHeight: 16,
    paddingTop: space.md,
  },
});
