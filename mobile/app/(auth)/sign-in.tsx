// Sign-in — light "sky" design (reference: Morva Labs / dribbble 24494696).
// Fixed light palette by design: this screen keeps one look in both themes.
import {
  createUserWithEmailAndPassword,
  type AuthError,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { LinearGradient } from 'expo-linear-gradient';
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

import { requestPhoneLoginOtp, verifyPhoneLoginOtp } from '@/api/otp';
import { firebaseAuth } from '@/auth/firebase';
import { useGoogleSignIn } from '@/auth/useGoogleSignIn';

type Mode = 'signin' | 'signup';
type Field = 'email' | 'password' | 'phone' | 'otp';

// ─── Fixed light palette (deliberate single look) ──────────────────
const P = {
  skyTop: '#c9dff5',
  skyMid: '#e6f0fa',
  skyBottom: '#f7fafd',
  card: '#FFFFFF',
  ink: '#0f172a',
  inkSoft: '#3b4a63',
  gray: '#6b7a90',
  grayLight: '#93a1b5',
  line: '#e4eaf2',
  fill: '#f6f8fb',
  focus: '#0f172a',
  danger: '#c2413b',
  dangerSoft: '#fdf0ef',
  okSoft: '#ecf7f0',
};

const TRUST_MARKERS = [
  { icon: 'mic', label: 'Voice → SOAP in seconds' },
  { icon: 'lock', label: 'Encrypted patient data' },
  { icon: 'check-circle', label: 'Verified letterheads' },
] as const;

export default function SignInScreen() {
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

  const cardTitle =
    method === 'phone'
      ? 'Sign in with mobile OTP'
      : mode === 'signin'
        ? 'Sign in with email'
        : 'Create your account';

  const inputWrap = (field: Field) => [
    styles.inputWrap,
    focused === field && styles.inputWrapFocused,
  ];

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[P.skyTop, P.skyMid, P.skyBottom]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand lockup */}
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
              <Text style={styles.brandEyebrow}>POWERED BY SOAPNOTESAI</Text>
            </View>
          </View>

          {/* Floating card */}
          <View style={styles.card}>
            <View style={styles.cardIcon}>
              <Feather name="log-in" size={16} color={P.ink} />
            </View>
            <Text style={styles.cardTitle}>{cardTitle}</Text>
            <Text style={styles.cardSubtitle}>
              Dictate the visit — the AI drafts the SOAP note, you review and sign.
            </Text>

            {/* Method toggle */}
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
              <>
                <View style={inputWrap('phone')}>
                  <Feather name="phone" size={15} color={P.grayLight} />
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
                      <Feather name="key" size={15} color={P.grayLight} />
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
                    { opacity: phonePrimaryDisabled ? 0.4 : pressed ? 0.88 : 1 },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryBtnLabel}>
                      {otpSentTo ? 'Verify & Sign In' : 'Get OTP'}
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
                    <Text style={styles.linkText}>Change number / resend</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <>
                <View style={inputWrap('email')}>
                  <Feather name="mail" size={15} color={P.grayLight} />
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
                  <Feather name="lock" size={15} color={P.grayLight} />
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
                  <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
                    <Feather
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={15}
                      color={P.grayLight}
                    />
                  </Pressable>
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
                    { opacity: submitDisabled ? 0.4 : pressed ? 0.88 : 1 },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryBtnLabel}>
                      {mode === 'signin' ? 'Get Started' : 'Create Account'}
                    </Text>
                  )}
                </Pressable>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Or sign in with</Text>
                  <View style={styles.dividerLine} />
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                  disabled={google.inProgress || submitting}
                  onPress={() => void google.signIn()}
                  style={({ pressed }) => [
                    styles.googleBtn,
                    { opacity: google.inProgress || submitting ? 0.5 : pressed ? 0.85 : 1 },
                  ]}
                >
                  {google.inProgress ? (
                    <ActivityIndicator color={P.ink} />
                  ) : (
                    <Text style={styles.googleG}>G</Text>
                  )}
                </Pressable>
                {google.error ? <Text style={styles.googleError}>{google.error}</Text> : null}
              </>
            )}
          </View>

          {/* Below-card: mode toggle + trust markers + footer */}
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

          <View style={styles.trustRow}>
            {TRUST_MARKERS.map((t) => (
              <View key={t.icon} style={styles.trustItem}>
                <Feather name={t.icon} size={12} color={P.inkSoft} />
                <Text style={styles.trustText}>{t.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerDisclaimer}>
              Draft assistive tool · review and sign every note before clinical use.
            </Text>
            <Text style={styles.footerBrand}>© SoapNotesAi · soapnotesai.web.app</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.skyBottom },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    gap: 18,
  },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandLogo: { width: 86, height: 38 },
  brandDivider: { width: 1, height: 30, backgroundColor: 'rgba(15,23,42,0.15)' },
  brandTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: P.ink,
    letterSpacing: -0.4,
  },
  brandEyebrow: {
    fontSize: 9,
    fontWeight: '700',
    color: P.gray,
    letterSpacing: 1.1,
    marginTop: 1,
  },

  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: P.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: 'stretch',
    gap: 12,
    shadowColor: '#31537a',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 34,
    elevation: 8,
  },
  cardIcon: {
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: P.card,
    borderWidth: 1,
    borderColor: P.line,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#31537a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: P.ink,
    textAlign: 'center',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  cardSubtitle: {
    fontSize: 12.5,
    color: P.gray,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: -6,
    marginBottom: 2,
  },

  methodRow: {
    flexDirection: 'row',
    backgroundColor: P.fill,
    borderRadius: 11,
    padding: 3,
    borderWidth: 1,
    borderColor: P.line,
  },
  methodBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  methodBtnActive: {
    backgroundColor: P.card,
    shadowColor: '#31537a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  methodText: { fontSize: 12.5, fontWeight: '600', color: P.gray },
  methodTextActive: { color: P.ink, fontWeight: '700' },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: P.fill,
    borderWidth: 1,
    borderColor: P.line,
    borderRadius: 11,
    paddingHorizontal: 13,
    height: 46,
  },
  inputWrapFocused: { borderColor: P.focus, backgroundColor: P.card },
  input: {
    flex: 1,
    fontSize: 14,
    color: P.ink,
    paddingVertical: 0,
    height: '100%',
  },
  phonePrefix: { fontSize: 14, fontWeight: '700', color: P.ink },

  forgotLink: { fontSize: 12, fontWeight: '600', color: P.inkSoft, marginTop: -2 },
  linkText: { fontSize: 12.5, fontWeight: '600', color: P.inkSoft, marginTop: 4 },
  otpHint: { fontSize: 12, color: P.gray, lineHeight: 17 },

  errorBox: {
    backgroundColor: P.dangerSoft,
    borderWidth: 1,
    borderColor: '#f2cfcd',
    borderRadius: 10,
    padding: 10,
  },
  errorText: { fontSize: 12.5, color: P.danger, lineHeight: 18 },
  resetBox: {
    backgroundColor: P.okSoft,
    borderWidth: 1,
    borderColor: '#cfe8d8',
    borderRadius: 10,
    padding: 10,
  },
  resetText: { fontSize: 12.5, color: P.inkSoft, lineHeight: 18 },

  primaryBtn: {
    height: 46,
    borderRadius: 12,
    backgroundColor: P.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  primaryBtnLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  dividerLine: { flex: 1, height: 1, backgroundColor: P.line },
  dividerText: { fontSize: 11, color: P.grayLight, fontWeight: '600' },

  googleBtn: {
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: P.line,
    backgroundColor: P.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleG: { fontSize: 17, fontWeight: '800', color: '#4285F4' },
  googleError: { fontSize: 12, color: P.danger, textAlign: 'center' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleText: { fontSize: 13, color: P.gray },
  toggleLink: { fontSize: 13, fontWeight: '700', color: P.ink },

  trustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 18,
    rowGap: 6,
    maxWidth: 460,
  },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trustText: { fontSize: 11.5, fontWeight: '600', color: P.inkSoft },

  footer: { alignItems: 'center', gap: 3, marginTop: 4 },
  footerDisclaimer: { fontSize: 11, color: P.grayLight, fontStyle: 'italic' },
  footerBrand: { fontSize: 10.5, color: P.grayLight, fontWeight: '600' },
});
