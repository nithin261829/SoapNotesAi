import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';
import { useAppFonts } from '@/theme/fonts';

function AuthGate() {
  const { user, initializing, needsProvisioning } = useAuth();
  const { colors } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    const inAuthGroup = segments[0] === '(auth)';
    const onSetup = (segments[1] as string | undefined) === 'setup';

    if (!user) {
      if (!inAuthGroup) router.replace('/(auth)/sign-in');
      return;
    }
    if (needsProvisioning) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!onSetup) router.replace('/(auth)/setup' as any);
      return;
    }
    if (inAuthGroup) router.replace('/(tabs)/record');
  }, [user, initializing, needsProvisioning, segments, router]);

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

function ThemedShell() {
  const { isDark, colors } = useTheme();
  return (
    <AuthProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.bg} />
      <AuthGate />
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
