import {
  createUserWithEmailAndPassword,
  type AuthError,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { firebaseAuth } from '@/auth/firebase';
import { useGoogleSignIn } from '@/auth/useGoogleSignIn';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

type Mode = 'signin' | 'signup';

export default function SignInScreen() {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const google = useGoogleSignIn();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitDisabled = submitting || email.trim().length < 3 || password.length < 6;

  const onSubmit = async () => {
    if (submitDisabled) return;
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      }
    } catch (e) {
      setError(humanizeAuthError(e));
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
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — wellness-clinic feel */}
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>P</Text>
              <View style={styles.brandDot} />
            </View>
            <View>
              <Text style={styles.brandTitle}>SoapNotesAi</Text>
              <Text style={styles.brandEyebrow}>SOAP-notes for clinicians</Text>
            </View>
          </View>

          <View style={{ marginTop: space.xxl }}>
            <Text style={styles.heroLine1}>
              {mode === 'signin' ? 'Welcome' : 'Let’s get'}
            </Text>
            <Text style={styles.heroLine2}>
              {mode === 'signin' ? 'back.' : 'started.'}
            </Text>
            <Text style={styles.heroAccent}>{mode === 'signin' ? 'sign in' : 'create account'}</Text>
          </View>

          <Text style={styles.subtitle}>
            {mode === 'signin'
              ? 'Pick up where you left off. Your patients and recordings are right where you left them.'
              : 'Dictate a session, the AI drafts the SOAP, you review and sign. Built for the rhythm of a busy clinic.'}
          </Text>
        </View>

        {/* Form */}
        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="doctor@clinic.com"
              placeholderTextColor={c.textDim}
              style={styles.input}
              editable={!submitting}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              textContentType={mode === 'signin' ? 'password' : 'newPassword'}
              placeholder="At least 6 characters"
              placeholderTextColor={c.textDim}
              style={styles.input}
              editable={!submitting}
              onSubmitEditing={() => void onSubmit()}
            />
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mode === 'signin' ? 'Sign in' : 'Create account'}
            disabled={submitDisabled}
            onPress={() => void onSubmit()}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: submitDisabled ? 0.45 : pressed ? 0.85 : 1 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnLabel}>
                {mode === 'signin' ? 'SIGN IN  →' : 'CREATE ACCOUNT  →'}
              </Text>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            disabled={google.inProgress || submitting}
            onPress={() => void google.signIn()}
            style={({ pressed }) => [
              styles.googleBtn,
              { opacity: google.inProgress || submitting ? 0.55 : pressed ? 0.85 : 1 },
            ]}
          >
            {google.inProgress ? (
              <ActivityIndicator color={c.text} />
            ) : (
              <>
                <Text style={styles.googleG}>G</Text>
                <Text style={styles.googleBtnLabel}>Continue with Google</Text>
              </>
            )}
          </Pressable>
          {google.error ? (
            <Text style={styles.googleError}>{google.error}</Text>
          ) : null}
        </View>

        {/* Mode toggle */}
        <View style={styles.toggleRow}>
          <Text style={styles.toggleText}>
            {mode === 'signin' ? 'New to SoapNotesAi?' : 'Already have an account?'}
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
              setError(null);
            }}
            hitSlop={8}
          >
            <Text style={styles.toggleLink}>
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.disclaimer}>
          Draft assistive tool · review and sign every note before clinical use.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function humanizeAuthError(e: unknown): string {
  if (!e || typeof e !== 'object') return 'Sign-in failed';
  const code = (e as AuthError).code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists. Try signing in.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    default:
      return (e as Error).message || 'Sign-in failed';
  }
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  kav: { flex: 1, backgroundColor: c.bg },
  scroll: { backgroundColor: c.bg },
  container: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.xxl + space.lg,
    paddingBottom: space.xxl,
    gap: space.lg,
  },

  // ─── Hero ───────────────────────────────────────────────
  hero: { gap: space.sm, marginBottom: space.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: c.accent,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  brandMarkText: {
    fontFamily: fonts.displayExtra,
    fontSize: 30,
    color: '#FFFFFF',
    letterSpacing: -1.5,
    includeFontPadding: false,
  },
  brandDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: c.accentAlt,
    top: -2,
    right: -2,
  },
  brandTitle: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xl,
    color: c.text,
    letterSpacing: -0.6,
  },
  brandEyebrow: {
    fontFamily: fonts.displayMedium,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  heroLine1: {
    fontFamily: fonts.displayExtra,
    fontSize: 56,
    lineHeight: 60,
    color: c.text,
    letterSpacing: -2,
  },
  heroLine2: {
    fontFamily: fonts.displayExtra,
    fontSize: 56,
    lineHeight: 60,
    color: c.text,
    letterSpacing: -2,
    marginTop: -8,
  },
  heroAccent: {
    fontFamily: fonts.serifBoldItalic,
    fontSize: 36,
    lineHeight: 42,
    color: c.accent,
    marginTop: -4,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.display,
    fontSize: font.size.md,
    color: c.textMuted,
    lineHeight: 22,
    marginTop: space.md,
  },

  // ─── Card ───────────────────────────────────────────────
  card: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.base,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  fieldGroup: { gap: 6 },
  label: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: space.md,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: c.text,
    fontFamily: fonts.display,
    fontSize: font.size.base,
  },
  errorBox: {
    backgroundColor: c.dangerSoft,
    borderWidth: 1,
    borderColor: c.danger,
    borderRadius: radii.md,
    padding: space.md,
  },
  errorText: {
    fontFamily: fonts.display,
    color: c.danger,
    fontSize: font.size.sm,
    lineHeight: 19,
  },

  primaryBtn: {
    marginTop: space.xs,
    paddingVertical: space.md + 4,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    alignItems: 'center',
  },
  primaryBtnLabel: {
    fontFamily: fonts.displayBold,
    color: '#FFFFFF',
    fontSize: font.size.sm,
    letterSpacing: 1.4,
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
  dividerText: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.textMuted,
    letterSpacing: 1.2,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
    minHeight: 50,
  },
  googleG: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    lineHeight: 20,
    color: '#4285F4',
  },
  googleBtnLabel: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.sm,
    letterSpacing: 0.4,
  },
  googleError: {
    fontFamily: fonts.display,
    color: c.danger,
    fontSize: font.size.xs,
    marginTop: 4,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: space.sm,
  },
  toggleText: {
    fontFamily: fonts.display,
    color: c.textMuted,
    fontSize: font.size.sm,
  },
  toggleLink: {
    fontFamily: fonts.displayBold,
    color: c.accent,
    fontSize: font.size.sm,
    letterSpacing: 0.5,
  },

  disclaimer: {
    marginTop: 'auto',
    fontFamily: fonts.serifItalic,
    fontSize: font.size.xs + 1,
    color: c.textDim,
    textAlign: 'center',
    lineHeight: 17,
    paddingTop: space.md,
  },
});
