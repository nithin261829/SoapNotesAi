// Firebase web SDK init with AsyncStorage persistence so a doctor stays signed
// in across cold app launches. The actual sign-in flow lives in AuthContext.tsx.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  getAuth,
  // @ts-expect-error — exported at runtime; not in the public type surface yet.
  getReactNativePersistence,
  initializeAuth,
} from 'firebase/auth';

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp = getApps()[0] ?? initializeApp(config);

function buildAuth(): Auth {
  // initializeAuth throws if it was already called for this app (e.g. on fast refresh).
  // Fall back to getAuth — the existing instance already has persistence.
  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(firebaseApp);
  }
}

export const firebaseAuth = buildAuth();
