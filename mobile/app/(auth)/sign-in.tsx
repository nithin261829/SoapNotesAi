// Sign-in — Instagram-style: flat, minimal, centered. Theme-aware.
import {
  createUserWithEmailAndPassword,
  type AuthError,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
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

import { requestPhoneLoginOtp, verifyPhoneLoginOtp } from '@/api/otp';
import { firebaseAuth } from '@/auth/firebase';
import { useGoogleSignIn } from '@/auth/useGoogleSignIn';
import { useTheme } from '@/theme/ThemeContext';

type Mode = 'signin' | 'signup';
type Field = 'email' | 'password' | 'phone' | 'otp';

// ─── Flat palettes (Instagram-plain) ───────────────────────────────
const LIGHT_P = {
  bg: '#fafafa',
  box: '#ffffff',
  ink: '#111418',
  gray: '#737b83',
  grayLight: '#a4acb4',
  line: '#e2e5e8',
  fill: '#f3f5f7',
  focus: '#b9c1c9',
  cta: '#111418',
  ctaLabel: '#ffffff',
  danger: '#c2413b',
  dangerSoft: '#fdf0ef',
  dangerLine: '#f2cfcd',
  okSoft: '#eef7f1',
  okLine: '#d3e9db',
};

const DARK_P: typeof LIGHT_P = {
  bg: '#0a0d10',
  box: '#101418',
  ink: '#f2f4f6',
  gray: '#8f979f',
  grayLight: '#5c646c',
  line: 'rgba(255,255,255,0.10)',
  fill: 'rgba(255,255,255,0.06)',
  focus: 'rgba(255,255,255,0.35)',
  cta: '#f2f4f6',
  ctaLabel: '#111418',
  danger: '#e07b76',
  dangerSoft: 'rgba(224,123,118,0.12)',
  dangerLine: 'rgba(224,123,118,0.35)',
  okSoft: 'rgba(94,190,131,0.12)',
  okLine: 'rgba(94,190,131,0.35)',
};

type Palette = typeof LIGHT_P;

export default function SignInScreen() {
  const { isDark } = useTheme();
  const P = isDark ? DARK_P : LIGHT_P;
  const styles = useMemo(() => makeStyles(P), [P]);
  const google = useGoogleSignIn();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  // Mobile-OTP login (Indian numbers). The 6-digit code IS the password.
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [otpChannel, setOtpChannel] = useState<string | null>(null);
  const [focused, setFocused] = useState<Field | null>(null);

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

  const phonePrimaryDisabled = submitting || (otpSentTo ? otpCode.length < 6 : !phoneValid);

  const inputWrap = (field: Field) => [
    styles.inputWrap,
    focused === field && styles.inputWrapFocused,
  ];

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.column}>
            {/* Wordmark */}
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="SoapNotesAi"
            />
            <Text style={styles.wordmark}>SoapNotesAi</Text>
            <Text style={styles.tagline}>Voice → SOAP notes for clinicians</Text>

            {/* Method tabs */}
            <View style={styles.methodRow}>
              {(
                [
                  { key: 'email', label: 'Email' },
                  { key: 'phone', label: 'Mobile OTP' },
                ] as const
              ).map((m) => (
                <Pressable
                  key={m.key}
                  onPress={() => {
                    setMethod(m.key);
                    setError(null);
                  }}
                  style={styles.methodBtn}
                  hitSlop={6}
                >
                  <Text
                    style={[styles.methodText, method === m.key && styles.methodTextActive]}
                  >
                    {m.label}
                  </Text>
                  <View
                    style={[styles.methodUnderline, method === m.key && styles.methodUnderlineOn]}
                  />
                </Pressable>
              ))}
            </View>

            {method === 'phone' ? (
              <View style={styles.form}>
                <View style={inputWrap('phone')}>
                  <Text style={styles.phonePrefix}>+91</Text>
                  <TextInput
                    value={phone}
                    onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))}
                    keyboardType="number-pad"
                    placeholder="Mobile number"
                    placeholderTextColor={P.grayLight}
                    style={styles.input}
                    editable={!submitting && !otpSentTo}
                    maxLength={10}
                    onFocus={() => setFocused('phone')}
                    onBlur={() => setFocused(null)}
                  />
                </View>

                {otpSentTo ? (
                  <>
                    <View style={inputWrap('otp')}>
                      <TextInput
                        value={otpCode}
                        onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                        keyboardType="number-pad"
                        placeholder="6-digit code"
                        placeholderTextColor={P.grayLight}
                        style={styles.input}
                        editable={!submitting}
                        maxLength={6}
                        autoFocus
                        onFocus={() => setFocused('otp')}
                        onBlur={() => setFocused(null)}
                      />
                    </View>
                    <Text style={styles.hint}>
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
                    { opacity: phonePrimaryDisabled ? 0.35 : pressed ? 0.85 : 1 },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color={P.ctaLabel} />
                  ) : (
                    <Text style={styles.primaryBtnLabel}>
                      {otpSentTo ? 'Verify & sign in' : 'Get OTP'}
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
                    style={{ alignSelf: 'center' }}
                  >
                    <Text style={styles.smallLink}>Change number / resend</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.form}>
                <View style={inputWrap('email')}>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    placeholder="Email"
                    placeholderTextColor={P.grayLight}
                    style={styles.input}
                    editable={!submitting}
                    onFocus={() => setFocused('email')}
                    onBlur={() => setFocused(null)}
                  />
                </View>

                <View style={inputWrap('password')}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    textContentType={mode === 'signin' ? 'password' : 'newPassword'}
                    placeholder="Password"
                    placeholderTextColor={P.grayLight}
                    style={styles.input}
                    editable={!submitting}
                    onSubmitEditing={() => void onSubmit()}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                  />
                  {password.length > 0 ? (
                    <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
                      <Text style={styles.showHide}>{showPassword ? 'Hide' : 'Show'}</Text>
                    </Pressable>
                  ) : null}
                </View>

                {resetSent ? (
                  <View style={styles.resetBox}>
                    <Text style={styles.resetText}>
                      Password-reset email sent to {email.trim()}. Check your inbox (and
                      spam), set a new password, then sign in here.
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
                    { opacity: submitDisabled ? 0.35 : pressed ? 0.85 : 1 },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color={P.ctaLabel} />
                  ) : (
                    <Text style={styles.primaryBtnLabel}>
                      {mode === 'signin' ? 'Log in' : 'Sign up'}
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
                    styles.googleRow,
                    { opacity: google.inProgress || submitting ? 0.5 : pressed ? 0.7 : 1 },
                  ]}
                >
                  {google.inProgress ? (
                    <ActivityIndicator color={P.ink} />
                  ) : (
                    <>
                      <Text style={styles.googleG}>G</Text>
                      <Text style={styles.googleLabel}>Continue with Google</Text>
                    </>
                  )}
                </Pressable>
                {google.error ? <Text style={styles.googleError}>{google.error}</Text> : null}

                {mode === 'signin' ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => void onForgotPassword()}
                    hitSlop={8}
                    style={{ alignSelf: 'center' }}
                  >
                    <Text style={styles.smallLink}>Forgot password?</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {/* Bottom box: mode switch (Instagram-style) */}
            {method === 'email' ? (
              <View style={styles.bottomBox}>
                <Text style={styles.bottomText}>
                  {mode === 'signin' ? "Don't have an account?" : 'Have an account?'}
                </Text>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
                    setError(null);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.bottomLink}>
                    {mode === 'signin' ? 'Sign up' : 'Log in'}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                Draft assistive tool · review and sign every note before clinical use.
              </Text>
              <Text style={styles.footerText}>© SoapNotesAi · soapnotesai.web.app</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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

const makeStyles = (P: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  column: { width: '100%', maxWidth: 350, alignItems: 'center', gap: 0 },

  logo: { width: 96, height: 40, marginBottom: 6 },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    color: P.ink,
    letterSpacing: -1,
  },
  tagline: { fontSize: 12.5, color: P.gray, marginTop: 4, marginBottom: 26 },

  methodRow: {
    flexDirection: 'row',
    gap: 26,
    marginBottom: 18,
  },
  methodBtn: { alignItems: 'center', gap: 6 },
  methodText: { fontSize: 13, fontWeight: '600', color: P.grayLight },
  methodTextActive: { color: P.ink },
  methodUnderline: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent', borderRadius: 1 },
  methodUnderlineOn: { backgroundColor: P.ink },

  form: { width: '100%', gap: 10 },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: P.fill,
    borderWidth: 1,
    borderColor: P.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
  },
  inputWrapFocused: { borderColor: P.focus },
  input: { flex: 1, fontSize: 14, color: P.ink, paddingVertical: 0, height: '100%' },
  phonePrefix: { fontSize: 14, fontWeight: '600', color: P.gray },
  showHide: { fontSize: 13, fontWeight: '700', color: P.ink },

  hint: { fontSize: 12, color: P.gray, lineHeight: 17 },

  errorBox: {
    backgroundColor: P.dangerSoft,
    borderWidth: 1,
    borderColor: P.dangerLine,
    borderRadius: 8,
    padding: 10,
  },
  errorText: { fontSize: 12.5, color: P.danger, lineHeight: 18, textAlign: 'center' },
  resetBox: {
    backgroundColor: P.okSoft,
    borderWidth: 1,
    borderColor: P.okLine,
    borderRadius: 8,
    padding: 10,
  },
  resetText: { fontSize: 12.5, color: P.gray, lineHeight: 18 },

  primaryBtn: {
    height: 44,
    borderRadius: 8,
    backgroundColor: P.cta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnLabel: { color: P.ctaLabel, fontSize: 14, fontWeight: '700' },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginVertical: 8,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: P.line },
  dividerText: { fontSize: 11, fontWeight: '700', color: P.grayLight, letterSpacing: 0.5 },

  googleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 40,
  },
  googleG: { fontSize: 16, fontWeight: '800', color: '#4285F4' },
  googleLabel: { fontSize: 13.5, fontWeight: '700', color: P.ink },
  googleError: { fontSize: 12, color: P.danger, textAlign: 'center' },

  smallLink: { fontSize: 12.5, color: P.gray, marginTop: 10 },

  bottomBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    borderWidth: 1,
    borderColor: P.line,
    backgroundColor: P.box,
    borderRadius: 10,
    paddingVertical: 16,
    marginTop: 22,
  },
  bottomText: { fontSize: 13.5, color: P.gray },
  bottomLink: { fontSize: 13.5, fontWeight: '800', color: P.ink },

  footer: { alignItems: 'center', gap: 3, marginTop: 26 },
  footerText: { fontSize: 10.5, color: P.grayLight },
});
