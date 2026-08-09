// Registers this device for follow-up reminder pushes.
//
// Remote push needs the dev/release build — in Expo Go, token fetching throws
// and we silently skip (reminders simply won't push to this device). Runs once
// per app session after the user is signed in and provisioned.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { registerPushToken } from '@/api/followups';
import { useAuth } from '@/auth/AuthContext';

export function usePushRegistration(): void {
  const { user, profile, getIdToken } = useAuth();
  const attempted = useRef(false);

  useEffect(() => {
    if (!user || !profile || attempted.current) return;
    attempted.current = true;

    (async () => {
      try {
        // Lazy import so Expo Go never crashes at module load.
        const Notifications = await import('expo-notifications');

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Follow-up reminders',
            importance: Notifications.AndroidImportance.HIGH,
          });
        }

        const perms = await Notifications.getPermissionsAsync();
        let granted = perms.granted;
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted;
        }
        if (!granted) return;

        const tokenResp = await Notifications.getExpoPushTokenAsync();
        const token = tokenResp.data;
        if (!token) return;

        const idToken = await getIdToken();
        await registerPushToken(idToken, token, 'expo');
      } catch {
        // Expo Go / simulator / permission denied — reminders just won't
        // push to this device. Non-fatal by design.
      }
    })();
  }, [user, profile, getIdToken]);
}
