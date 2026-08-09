import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { getOtpStatus } from '@/api/otp';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';
import { useAppFonts } from '@/theme/fonts';

function AuthGate() {
  const { user, initializing, needsProvisioning, getIdToken } = useAuth();
  const { colors } = useTheme();
  const segments = useSegments();
  const router = useRouter();
  // One OTP-status check per sign-in; server enforcement is the real gate.
  const otpChecked = useRef(false);

  useEffect(() => {
    if (initializing) return;
    const inAuthGroup = segments[0] === '(auth)';
    const onSetup = (segments[1] as string | undefined) === 'setup';
    const onOtp = (segments[1] as string | undefined) === 'otp';

    if (!user) {
      otpChecked.current = false;
      // Redirect from anywhere that isn't the sign-in screen itself —
      // including setup/otp, which are in the auth group (sign-out race).
      if (!inAuthGroup || onSetup || onOtp) router.replace('/(auth)/sign-in');
      return;
    }
    if (needsProvisioning) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!onSetup) router.replace('/(auth)/setup' as any);
      return;
    }
    if (!otpChecked.current && !onOtp) {
      otpChecked.current = true;
      void (async () => {
        try {
          const token = await getIdToken();
          const status = await getOtpStatus(token);
          if (status.required && !status.verified) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            router.replace('/(auth)/otp' as any);
          }
        } catch {
          // Status check failing must never lock the doctor out of the app;
          // the backend still enforces OTP on every tenant call.
        }
      })();
    }
    if (inAuthGroup && !onOtp) router.replace('/(tabs)/record');
  }, [user, initializing, needsProvisioning, segments, router, getIdToken]);

  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
    </Stack>
  );
}

function WebFrame({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  // Kill the browser's native focus ring — the app draws its own focus states.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent =
      'input:focus, textarea:focus, select:focus, button:focus, div:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  if (Platform.OS !== 'web') return <>{children}</>;
  // Desktop browsers: center the app as a seamless column — backdrop matches
  // the theme background so there are no visible edges or shadows.
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: colors.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 680 }}>{children}</View>
    </View>
  );
}

function ThemedShell() {
  const { isDark, colors } = useTheme();
  return (
    <AuthProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.bg} />
      <WebFrame>
        <AuthGate />
      </WebFrame>
    </AuthProvider>
  );
}

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  if (!fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000', // dark fallback while fonts load (matches default theme)
        }}
      >
        <ActivityIndicator size="large" color="#4ABF6E" />
      </View>
    );
  }
  return (
    <ThemeProvider>
      <ThemedShell />
    </ThemeProvider>
  );
}
