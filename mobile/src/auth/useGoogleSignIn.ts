// Google sign-in via expo-auth-session, exchanged with Firebase Auth.
//
// In Expo Go the OAuth redirect goes through `auth.expo.io` — the Web Client ID
// in EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID must have that proxy URI authorized in
// Google Cloud Console. In a custom dev/release build we use the custom scheme
// from app.json, which the Google provider derives automatically.

import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { firebaseAuth } from './firebase';

WebBrowser.maybeCompleteAuthSession();

export interface GoogleSignInResult {
  /** True while the OAuth browser is open or Firebase is exchanging the token. */
  inProgress: boolean;
  /** Last error from either Google OAuth or Firebase credential exchange. */
  error: string | null;
  /** Disabled while the request isn't ready (config still loading). */
  signIn: () => Promise<void>;
}

export function useGoogleSignIn(): GoogleSignInResult {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!response) return;
    if (response.type !== 'success') {
      // Includes 'cancel', 'dismiss', 'error', 'locked'.
      setInProgress(false);
      if (response.type === 'error') {
        setError(response.error?.message ?? 'Google sign-in failed');
      }
      return;
    }
    const idToken = response.params?.id_token;
    if (!idToken) {
      setInProgress(false);
      setError('Google did not return an id_token');
      return;
    }
    const credential = GoogleAuthProvider.credential(idToken);
    signInWithCredential(firebaseAuth, credential)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Firebase sign-in failed';
        setError(msg);
      })
      .finally(() => setInProgress(false));
  }, [response]);

  const signIn = useCallback(async () => {
    // Web: Firebase's popup flow works on the project's hosting domains with
    // no OAuth-client redirect configuration (avoids redirect_uri_mismatch).
    if (Platform.OS === 'web') {
      setError(null);
      setInProgress(true);
      try {
        await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Google sign-in failed');
      } finally {
        setInProgress(false);
      }
      return;
    }
    if (!request) return;
    setError(null);
    setInProgress(true);
    try {
      await promptAsync();
    } catch (e) {
      setInProgress(false);
      setError(e instanceof Error ? e.message : 'Could not open Google sign-in');
    }
  }, [promptAsync, request]);

  return { inProgress, error, signIn };
}
