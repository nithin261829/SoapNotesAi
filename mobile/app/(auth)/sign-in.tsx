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
type Field = 'email' | 'password' | 'phone' | 'otp';

const TRUST_MARKERS = [
  { icon: 'mic', label: 'Voice → SOAP in seconds' },
  { icon: 'lock', label: 'Encrypted patient data' },
  { icon: 'check-circle', label: 'Verified-doctor letterheads' },
] as const;

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
  // Visual only — drives the focused-border treatment on inputs.
  const [focused, setFocused] = useState<Field | null>(null);

  const phoneValid = /^[6-9]\d{9}$/.test(phone.replace(/\D/g, '').replace(/^(91|0)/, ''));

  const inputStyle = (field: Field) => [
    styles.input,
    focused === field && styles.inputFocused,
  ];

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

  const phonePrimaryDisabled = submitting || (otpSentTo ? otpCode.length < 6 : !phoneValid);

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
        {/* Hero — brand-forward, editorial */}
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.brandLogo}
              resizeMode="contain"
              accessibilityLabel="SoapNotesAi"
            />
            <View style={styles.brandDivider} />
            <View>
              <Text style={styles.brandTitle}>SoapNotesAi</Text>
              <Text style={styles.brandEyebrow}>Voice to SOAP notes</Text>
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

          {/* Trust markers */}
          <View style={styles.trustRow}>
            {TRUST_MARKERS.map((t) => (
              <View key={t.icon} style={styles.trustItem}>
                <Feather name={t.icon} size={13} color={c.accent} />
                <Text style={styles.trustText}>{t.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Method toggle: Email | Mobile OTP */}
        <View style={styles.methodRow}>
          {(
            [
              { key: 'email', label: 'EMAIL' },
              { key: 'phone', label: 'MOBILE OTP' },
            ] as const
          ).map((m) => (
            <Pressable
              key={m.key}
              onPress={() => {
                setMethod(m.key);
                setError(null);
              }}
              style={[styles.methodBtn, method === m.key && styles.methodBtnActive]}
            >
              <Text
                style={[styles.methodText, method === m.key && styles.methodTextActive]}
              >
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {method === 'phone' ? (
          <View style={styles.cardShadow}>
          <View style={styles.card}>
            <View pointerEvents="none" style={styles.cardGlow} />
            <View pointerEvents="none" style={styles.cardSheen} />
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Mobile number (India)</Text>
              <View style={styles.phoneRow}>
                <View style={styles.phonePrefixBox}>
                  <Text style={styles.phonePrefix}>+91</Text>
                </View>
                <TextInput
                  value={phone}
                  onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="number-pad"
                  placeholder="98765 43210"
                  placeholderTextColor={c.textSubtle}
                  style={[...inputStyle('phone'), { flex: 1 }]}
                  editable={!submitting && !otpSentTo}
                  maxLength={10}
                  onFocus={() => setFocused('phone')}
                  onBlur={() => setFocused(null)}
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
                    placeholderTextColor={c.textSubtle}
                    style={inputStyle('otp')}
                    editable={!submitting}
                    maxLength={6}
                    autoFocus
                    onFocus={() => setFocused('otp')}
                    onBlur={() => setFocused(null)}
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
              disabled={phonePrimaryDisabled}
              onPress={() => void (otpSentTo ? onVerifyPhoneOtp() : onSendPhoneOtp())}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && !phonePrimaryDisabled && styles.primaryBtnPressed,
                { opacity: phonePrimaryDisabled ? 0.45 : 1 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={c.textOnAccent} />
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
          </View>
          </View>
        ) : (
        <View style={styles.cardShadow}>
        <View style={styles.card}>
          <View pointerEvents="none" style={styles.cardGlow} />
          <View pointerEvents="none" style={styles.cardSheen} />
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
              placeholderTextColor={c.textSubtle}
              style={inputStyle('email')}
              editable={!submitting}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
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
              placeholderTextColor={c.textSubtle}
              style={inputStyle('password')}
              editable={!submitting}
              onSubmitEditing={() => void onSubmit()}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused(null)}
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
              pressed && !submitDisabled && styles.primaryBtnPressed,
              { opacity: submitDisabled ? 0.45 : 1 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={c.textOnAccent} />
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
              pressed && !(google.inProgress || submitting) && styles.primaryBtnPressed,
              { opacity: google.inProgress || submitting ? 0.55 : 1 },
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

        <View style={styles.footer}>
          <Text style={styles.disclaimer}>
            Draft assistive tool · review and sign every note before clinical use.
          </Text>
          <Text style={styles.footerMeta}>© SoapNotesAi · soapnotesai.web.app</Text>
        </View>
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

const CONTROL_HEIGHT = 52;

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
  hero: { gap: space.sm, marginBottom: space.md },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brandLogo: { width: 96, height: 40 },
  brandDivider: {
    width: StyleSheet.hairlineWidth * 2,
    height: 32,
    backgroundColor: c.borderStrong,
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
    maxWidth: 520,
  },

  // Trust markers — quiet credibility row; wraps to two lines on phones,
  // sits on one line inside the 680px web column.
  trustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.lg,
    rowGap: space.sm,
    marginTop: space.base,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trustText: {
    fontFamily: fonts.displayMedium,
    fontSize: font.size.sm,
    color: c.textMuted,
    letterSpacing: 0.2,
  },

  // ─── Method toggle ──────────────────────────────────────
  methodRow: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
  },
  methodBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: radii.md,
  },
  methodBtnActive: { backgroundColor: c.accent },
  methodText: {
    fontFamily: fonts.displayBold,
    color: c.textMuted,
    fontSize: font.size.xs,
    letterSpacing: 1,
  },
  methodTextActive: { color: c.textOnAccent },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  phonePrefixBox: {
    height: CONTROL_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phonePrefix: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.base,
    letterSpacing: 0.5,
  },
  otpHint: {
    fontFamily: fonts.display,
    fontSize: font.size.sm,
    color: c.textMuted,
    lineHeight: 19,
  },

  // ─── Card — glass / elevated ────────────────────────────
  cardShadow: {
    borderRadius: radii.xl,
    backgroundColor: c.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 6,
  },
  card: {
    overflow: 'hidden',
    backgroundColor: c.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.borderStrong,
    padding: space.lg,
    paddingTop: space.xl,
    gap: space.base,
  },
  // Soft accent wash bleeding from the top edge — the "inner glow".
  cardGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 110,
    backgroundColor: c.accentSoft,
    opacity: 0.55,
  },
  // 1px light catch on the top edge — reads as a glass highlight.
  cardSheen: {
    position: 'absolute',
    top: 0,
    left: space.base,
    right: space.base,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
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
    height: CONTROL_HEIGHT,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: space.base,
    color: c.text,
    fontFamily: fonts.display,
    fontSize: font.size.md,
  },
  inputFocused: {
    borderColor: c.borderAccent,
    backgroundColor: c.surfaceHover,
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

  // ─── Buttons ────────────────────────────────────────────
  primaryBtn: {
    marginTop: space.xs,
    height: CONTROL_HEIGHT + 2,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: c.accentDim,
  },
  primaryBtnLabel: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    fontSize: font.size.base,
    letterSpacing: 1.6,
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong },
  dividerText: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.textSubtle,
    letterSpacing: 2,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: CONTROL_HEIGHT,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
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
    fontSize: font.size.base,
    letterSpacing: 0.3,
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

  // ─── Footer ─────────────────────────────────────────────
  footer: {
    marginTop: 'auto',
    paddingTop: space.lg,
    gap: space.xs,
    alignItems: 'center',
  },
  disclaimer: {
    fontFamily: fonts.serifItalic,
    fontSize: font.size.xs + 1,
    color: c.textDim,
    textAlign: 'center',
    lineHeight: 17,
  },
  footerMeta: {
    fontFamily: fonts.displayMedium,
    fontSize: font.size.xs,
    color: c.textDim,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
});
