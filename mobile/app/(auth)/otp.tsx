import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { requestOtp, verifyOtp, type OtpRequestResult } from '@/api/otp';
import { useAuth } from '@/auth/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

const RESEND_COOLDOWN_S = 30;

export default function OtpScreen() {
  const router = useRouter();
  const { getIdToken, signOut } = useAuth();
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [code, setCode] = useState('');
  const [sendInfo, setSendInfo] = useState<OtpRequestResult | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  const send = useCallback(async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const token = await getIdToken();
      const info = await requestOtp(token);
      setSendInfo(info);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setSending(false);
    }
  }, [getIdToken, sending]);

  useEffect(() => {
    if (!sentOnce.current) {
      sentOnce.current = true;
      void send();
    }
  }, [send]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onVerify = async () => {
    if (verifying || code.trim().length < 4) return;
    setVerifying(true);
    setError(null);
    try {
      const token = await getIdToken();
      await verifyOtp(token, code.trim());
      router.replace('/(tabs)/record');
    } catch (e) {
      setError(friendly(e));
      setVerifying(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { paddingTop: insets.top + 24 }]}
    >
      <BrandLogo />
      <Text style={styles.title}>Verify it's you</Text>
      <Text style={styles.subtitle}>
        {sendInfo
          ? sendInfo.channel === 'dev_log'
            ? 'Dev mode: the code was logged on the backend console.'
            : `We sent a 6-digit code to ${sendInfo.sent_to}.`
          : 'Sending your verification code…'}
      </Text>

      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
        keyboardType="number-pad"
        placeholder="••••••"
        placeholderTextColor={c.textDim}
        textAlign="center"
        autoFocus
        maxLength={6}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        onPress={() => void onVerify()}
        disabled={verifying || code.length < 6}
        style={({ pressed }) => [
          styles.primaryBtn,
          { opacity: verifying || code.length < 6 ? 0.45 : pressed ? 0.85 : 1 },
        ]}
      >
        {verifying ? (
          <ActivityIndicator color={c.textOnAccent} />
        ) : (
          <Text style={styles.primaryBtnLabel}>VERIFY →</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => void send()}
        disabled={sending || cooldown > 0}
        style={{ opacity: sending || cooldown > 0 ? 0.5 : 1, marginTop: space.md }}
      >
        <Text style={styles.resendText}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </Text>
      </Pressable>

      <Pressable onPress={() => void signOut()} style={{ marginTop: space.lg }}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : 'Something went wrong';
  const map: Record<string, string> = {
    otp_incorrect: 'That code is incorrect. Try again.',
    otp_expired: 'That code expired. Tap "Resend code" for a new one.',
    otp_locked: 'Too many attempts. Request a new code.',
    otp_rate_limited: 'Too many codes requested. Try again in an hour.',
    otp_not_requested: 'Tap "Resend code" to get a code first.',
    otp_delivery_not_configured: 'OTP delivery is not configured yet. Contact support.',
  };
  return map[msg] ?? msg;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
      padding: space.lg,
      gap: space.sm,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 30,
      color: c.text,
      letterSpacing: -0.8,
      marginTop: space.lg,
    },
    subtitle: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
      lineHeight: 20,
    },
    codeInput: {
      marginTop: space.lg,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      backgroundColor: c.surface,
      color: c.text,
      fontFamily: fonts.displayBold,
      fontSize: 32,
      letterSpacing: 12,
      paddingVertical: space.md,
    },
    errorText: { fontFamily: fonts.display, color: c.danger, fontSize: font.size.sm },
    primaryBtn: {
      marginTop: space.md,
      backgroundColor: c.accent,
      borderRadius: radii.md,
      alignItems: 'center',
      paddingVertical: space.md + 2,
    },
    primaryBtnLabel: {
      fontFamily: fonts.displayBold,
      color: c.textOnAccent,
      fontSize: font.size.sm,
      letterSpacing: 1.2,
    },
    resendText: {
      fontFamily: fonts.displaySemi,
      color: c.accent,
      fontSize: font.size.sm,
      textAlign: 'center',
    },
    signOutText: {
      fontFamily: fonts.display,
      color: c.textSubtle,
      fontSize: font.size.sm,
      textAlign: 'center',
    },
  });
