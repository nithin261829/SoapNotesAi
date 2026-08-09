import {
  createUserWithEmailAndPassword,
  type AuthError,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
} from 'firebase/auth';

import { requestPhoneLoginOtp, verifyPhoneLoginOtp } from '@/api/otp';
import { Feather } from '@expo/vector-icons';
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
  const [resetSent, setResetSent] = useState(false);
  // Mobile-OTP login (Indian numbers). The 6-digit code IS the password.
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [otpChannel, setOtpChannel] = useState<string | null>(null);

  const phoneValid = /^[6-9]\d{9}$/.test(phone.replace(/\D/g, '').replace(/^(91|0)/, ''));

  const onSendPhoneOtp = async () => {
    if (submitting || !phoneValid) return;
    setError(null);
    setSubmitting(true);
    try {
      const info = await requestPhoneLoginOtp(phone);
      setOtpSentTo(info.sent_to);
      setOtpChannel(info.channel);
    } catch (e) {
      setError(humanizePhoneError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onVerifyPhoneOtp = async () => {
    if (submitting || otpCode.length < 6) return;
    setError(null);
    setSubmitting(true);
    try {
      const { custom_token } = await verifyPhoneLoginOtp(phone, otpCode);
      await signInWithCustomToken(firebaseAuth, custom_token);
    } catch (e) {
      setError(humanizePhoneError(e));
      setSubmitting(false);
    }
  };

  const onForgotPassword = async () => {
    const addr = email.trim();
    if (!addr || !addr.includes('@')) {
      setError('Enter your email above first, then tap "Forgot password?".');
      return;
    }
    setError(null);
    try {
      await sendPasswordResetEmail(firebaseAuth, addr);
      setResetSent(true);
    } catch (e) {
      setError(humanizeAuthError(e));
    }
  };

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
        {/* Header — professional SaaS pattern: small brand, modest heading */}
        <View style={styles.header}>
          <View style={styles.lockupRow}>
            <Text style={styles.wordmark}>SoapNotesAi</Text>
            <View style={styles.poweredDivider} />
            <Image
              source={require('../../assets/logo.png')}
              style={styles.poweredLogo}
              resizeMode="contain"
              accessibilityLabel="SoapNotesAi"
            />
          </View>
          <Text style={styles.partnerCaption}>Voice to SOAP notes</Text>
          <Text style={styles.headerTitle}>
            {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
          </Text>
          <Text style={styles.headerSub}>Voice → SOAP notes for clinicians</Text>
        </View>

        {method === 'phone' ? (
          <View style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Mobile number (India)</Text>
              <View style={styles.phoneRow}>
                <Text style={styles.phonePrefix}>+91</Text>
                <TextInput
                  value={phone}
                  onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="number-pad"
                  placeholder="98765 43210"
                  placeholderTextColor={c.textDim}
                  style={[styles.input, { flex: 1 }]}
                  editable={!submitting && !otpSentTo}
                  maxLength={10}
                />
              </View>
            </View>

            {otpSentTo ? (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>6-digit code</Text>
                  <TextInput
                    value={otpCode}
                    onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    placeholder="••••••"
                    placeholderTextColor={c.textDim}
                    style={styles.input}
                    editable={!submitting}
                    maxLength={6}
                    autoFocus
                  />
                </View>
                <Text style={styles.otpHint}>
                  {otpChannel === 'dev_log'
                    ? 'Dev mode: SMS not configured yet — the code is on the backend console.'
                    : `Code sent to ${otpSentTo}.`}
                </Text>
              </>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={submitting || (otpSentTo ? otpCode.length < 6 : !phoneValid)}
              onPress={() => void (otpSentTo ? onVerifyPhoneOtp() : onSendPhoneOtp())}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  opacity:
                    submitting || (otpSentTo ? otpCode.length < 6 : !phoneValid)
                      ? 0.45
                      : pressed
                        ? 0.85
                        : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnLabel}>
                  {otpSentTo ? 'VERIFY & SIGN IN  →' : 'GET OTP  →'}
                </Text>
              )}
            </Pressable>

            {otpSentTo ? (
              <Pressable
                onPress={() => {
                  setOtpSentTo(null);
                  setOtpCode('');
                  setError(null);
                }}
                hitSlop={8}
              >
                <Text style={styles.toggleLink}>Change number / resend</Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => {
                setMethod('email');
                setOtpSentTo(null);
                setOtpCode('');
                setError(null);
              }}
              hitSlop={8}
              style={{ alignSelf: 'center' }}
            >
              <Text style={styles.toggleLink}>← Sign in with email instead</Text>
            </Pressable>
          </View>
        ) : (
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

          {mode === 'signin' ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => void onForgotPassword()}
              hitSlop={8}
              style={{ alignSelf: 'flex-end' }}
            >
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </Pressable>
          ) : null}

          {resetSent ? (
            <View style={styles.resetBox}>
              <Text style={styles.resetText}>
                Password-reset email sent to {email.trim()}. Check your inbox (and spam folder),
                set a new password, then sign in here.
              </Text>
            </View>
          ) : null}

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

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Mobile OTP"
            disabled={submitting}
            onPress={() => {
              setMethod('phone');
              setError(null);
            }}
            style={({ pressed }) => [
              styles.googleBtn,
              { opacity: submitting ? 0.55 : pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name="smartphone" size={16} color={c.text} />
            <Text style={styles.googleBtnLabel}>Continue with Mobile OTP</Text>
          </Pressable>
        </View>
        )}

        {/* Mode toggle (email accounts only — phone accounts auto-create) */}
        {method === 'email' ? (
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
        ) : null}

        {/* Feature highlights — small boxes */}
        <View style={styles.featureRow}>
          {(
            [
              { icon: 'mic', label: 'Voice → SOAP in seconds' },
              { icon: 'lock', label: 'Encrypted patient data' },
              { icon: 'check-circle', label: 'Verified letterheads' },
              { icon: 'bell', label: 'Follow-up reminders' },
            ] as const
          ).map((f) => (
            <View key={f.icon} style={styles.featureBox}>
              <Feather name={f.icon} size={13} color={c.accent} />
              <Text style={styles.featureText}>{f.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.disclaimer}>
          Draft assistive tool · review and sign every note before clinical use.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function humanizePhoneError(e: unknown): string {
  const msg = e instanceof Error ? e.message : 'Something went wrong';
  const map: Record<string, string> = {
    invalid_indian_mobile: 'Enter a valid 10-digit Indian mobile number.',
    otp_rate_limited: 'Too many codes requested for this number. Try again in an hour.',
    otp_incorrect: 'That code is incorrect. Try again.',
    otp_expired: 'That code expired. Tap "Change number / resend" for a new one.',
    otp_locked: 'Too many wrong attempts. Request a new code.',
    otp_not_requested: 'Request a code first.',
    otp_delivery_not_configured: 'SMS delivery is not set up yet. Contact support.',
  };
  return map[msg] ?? msg;
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
    // Centering clips the top when content is taller than the screen
    // (iPhone bug: header disappeared). Center only on web's tall viewport.
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-start',
    paddingHorizontal: space.lg,
    paddingTop: Platform.OS === 'web' ? space.xl : space.xxl * 2 + space.md,
    paddingBottom: space.xl,
    gap: space.md,
  },

  // ─── Header (professional SaaS pattern) ─────────────────
  header: {
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
    marginBottom: space.md,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  wordmark: {
    fontFamily: fonts.brand,
    fontSize: 34,
    color: c.text,
    letterSpacing: -0.5,
  },
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.text,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: space.sm,
  },
  headerSub: {
    fontFamily: fonts.display,
    fontSize: font.size.sm,
    color: c.textMuted,
    textAlign: 'center',
  },
  hero: { gap: space.sm, marginBottom: space.lg },
  poweredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  poweredText: {
    fontFamily: fonts.displaySemi,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 0.4,
  },
  poweredDivider: { width: 1, height: 26, backgroundColor: c.borderStrong },
  poweredLogo: { width: 84, height: 34 },
  lockupRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  partnerCaption: {
    fontFamily: fonts.displayMedium,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: -2,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brandLogo: { width: 96, height: 44 },
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

  methodRow: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    backgroundColor: c.surfaceElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  methodBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radii.sm,
  },
  methodBtnActive: { backgroundColor: c.accent },
  methodText: {
    fontFamily: fonts.displayBold,
    color: c.textMuted,
    fontSize: font.size.xs,
    letterSpacing: 0.8,
  },
  methodTextActive: { color: '#FFFFFF' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  phonePrefix: {
    fontFamily: fonts.displayBold,
    color: c.text,
    fontSize: font.size.base,
  },
  otpHint: {
    fontFamily: fonts.display,
    fontSize: font.size.sm,
    color: c.textMuted,
    lineHeight: 19,
  },

  // ─── Card ───────────────────────────────────────────────
  card: {
    backgroundColor: c.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.borderStrong,
    padding: space.lg + 4,
    gap: space.base,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 7,
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
    height: 50,
    paddingVertical: 0,
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
  forgotLink: {
    fontFamily: fonts.displaySemi,
    color: c.accent,
    fontSize: font.size.sm,
    marginTop: -4,
  },
  resetBox: {
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
    borderRadius: radii.md,
    padding: space.md,
  },
  resetText: {
    fontFamily: fonts.display,
    color: c.text,
    fontSize: font.size.sm,
    lineHeight: 19,
  },

  primaryBtn: {
    marginTop: space.xs,
    height: 52,
    justifyContent: 'center',
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
  otpBtnIcon: { fontSize: 15 },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    marginTop: space.xs,
  },
  featureBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  featureText: {
    fontFamily: fonts.displayMedium,
    fontSize: font.size.xs,
    color: c.textMuted,
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
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
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
