// Entry redirect. '/' has no real screen — push the user to the right place
// based on auth state.

import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';

export default function Index() {
  const { user, profile, initializing, needsProvisioning } = useAuth();
  if (initializing) return null; // root layout renders a splash while we wait
  if (!user) return <Redirect href="/(auth)/sign-in" />;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (needsProvisioning) return <Redirect href={'/(auth)/setup' as any} />;
  // Profile is loaded; record tab is the home.
  void profile; // referenced for the dep-check; intentionally unused here
  return <Redirect href="/(tabs)/record" />;
}
