// Auth state surface for the rest of the app.
//
// - `user`: the Firebase user, null until Firebase resolves the persisted session.
// - `profile`: the backend UserProfile (org + memberships). null until provisioned.
// - `needsProvisioning`: true when we have a Firebase user but no backend profile.
//   The root layout uses this to redirect to /(auth)/setup.
// - `initializing`: true on cold start until both Firebase and /me resolve.
// - `signOut`, `provisionOrg`, `joinWithInvite`, `switchActiveClinic`: helpers
//   that wrap the API calls + token refresh + local-state refresh.

import {
  type User,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AccountsError,
  getMe,
  type MeResponse,
  signupInvite,
  signupOrg,
  switchClinic,
  type SignupInviteParams,
  type SignupOrgParams,
} from '@/api/accounts';

import { firebaseAuth } from './firebase';

interface AuthValue {
  user: User | null;
  profile: MeResponse | null;
  /** True once Firebase has settled AND we've attempted to load /me. */
  initializing: boolean;
  /** True when we have a Firebase user but no backend profile yet. */
  needsProvisioning: boolean;
  /** Returns a fresh Firebase ID token (force-refresh on demand). */
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  signOut: () => Promise<void>;
  provisionOrg: (params: SignupOrgParams) => Promise<void>;
  joinWithInvite: (params: SignupInviteParams) => Promise<void>;
  switchActiveClinic: (clinicId: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  // Bumped after token-claim-changing calls so getIdToken returns a refreshed token.
  const profileLoadGen = useRef(0);

  const loadProfile = useCallback(async (u: User | null) => {
    if (!u) {
      setProfile(null);
      setProfileReady(true);
      return;
    }
    const gen = ++profileLoadGen.current;
    try {
      const token = await u.getIdToken(false);
      const me = await getMe(token);
      // Drop the result if a newer load has been kicked off in the meantime.
      if (gen === profileLoadGen.current) {
        setProfile(me);
      }
    } catch (e) {
      if (e instanceof AccountsError) {
        // Treat any non-200/404 as "no profile" so the UI doesn't get stuck.
        if (gen === profileLoadGen.current) setProfile(null);
      } else {
        if (gen === profileLoadGen.current) setProfile(null);
      }
    } finally {
      if (gen === profileLoadGen.current) setProfileReady(true);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u);
      setAuthReady(true);
      setProfileReady(false);
      void loadProfile(u);
    });
    return unsub;
  }, [loadProfile]);

  const getIdToken = useCallback(async (forceRefresh = false) => {
    if (!firebaseAuth.currentUser) throw new Error('no_user');
    return firebaseAuth.currentUser.getIdToken(forceRefresh);
  }, []);

  const refreshProfile = useCallback(async () => {
    setProfileReady(false);
    await loadProfile(firebaseAuth.currentUser);
  }, [loadProfile]);

  const provisionOrg = useCallback(
    async (params: SignupOrgParams) => {
      const token = await getIdToken(false);
      await signupOrg(token, params);
      // Custom claims changed server-side; force-refresh the token locally.
      await getIdToken(true);
      await refreshProfile();
    },
    [getIdToken, refreshProfile],
  );

  const joinWithInvite = useCallback(
    async (params: SignupInviteParams) => {
      const token = await getIdToken(false);
      await signupInvite(token, params);
      await getIdToken(true);
      await refreshProfile();
    },
    [getIdToken, refreshProfile],
  );

  const switchActiveClinic = useCallback(
    async (clinicId: string) => {
      const token = await getIdToken(false);
      await switchClinic(token, clinicId);
      await getIdToken(true);
      await refreshProfile();
    },
    [getIdToken, refreshProfile],
  );

  const signOut = useCallback(async () => {
    setProfile(null);
    await firebaseSignOut(firebaseAuth);
  }, []);

  const initializing = !authReady || (user !== null && !profileReady);
  const needsProvisioning = !initializing && user !== null && profile === null;

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      initializing,
      needsProvisioning,
      getIdToken,
      signOut,
      provisionOrg,
      joinWithInvite,
      switchActiveClinic,
      refreshProfile,
    }),
    [
      user,
      profile,
      initializing,
      needsProvisioning,
      getIdToken,
      signOut,
      provisionOrg,
      joinWithInvite,
      switchActiveClinic,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
