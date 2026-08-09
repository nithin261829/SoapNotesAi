// Smart greeting + afternoon catch-up banner for the Record tab.
//
// - Greeting line follows the local clock (morning / afternoon / evening) and
//   addresses the clinician as "Dr. {first name}" from the backend profile.
// - Catch-up banner: we track a `lastActiveAt` timestamp in AsyncStorage. When
//   the app comes back after >= 3 hours of inactivity in the afternoon/evening,
//   we show a dismissible "Welcome back" card with today's patient count
//   (patients whose last_encounter_at falls on today, local time).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { listPatients } from '@/api/patients';
import { useAuth } from '@/auth/AuthContext';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

const LAST_ACTIVE_KEY = 'lastActiveAt';
const INACTIVITY_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function GreetingBanner() {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const { profile, getIdToken } = useAuth();

  const [seenToday, setSeenToday] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const displayName = profile?.profile.display_name ?? null;
  const firstName = displayName?.trim().split(/\s+/)[0] ?? null;
  const greeting = greetingForHour(new Date().getHours());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const now = Date.now();
        const prevRaw = await AsyncStorage.getItem(LAST_ACTIVE_KEY);
        await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(now));

        if (!prevRaw) return;
        const prev = Number(prevRaw);
        if (!Number.isFinite(prev)) return;

        const gapLongEnough = now - prev >= INACTIVITY_GAP_MS;
        const isAfternoon = new Date().getHours() >= 12;
        if (!gapLongEnough || !isAfternoon) return;

        const idToken = await getIdToken();
        const patients = await listPatients(idToken);
        if (cancelled) return;
        const count = patients.filter((p) => isToday(p.patient.last_encounter_at)).length;
        setSeenToday(count);
      } catch {
        // Any storage/auth/network failure: quietly skip the banner.
      }
    })();

    return () => {
      cancelled = true;
    };
    // Run once on mount — this is an app-open "welcome back" check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showBanner = seenToday !== null && !dismissed;

  return (
    <View style={styles.wrap}>
      <Text style={styles.greetingWord}>{greeting}</Text>
      <Text style={styles.greetingName}>Dr. {firstName ?? 'Doctor'}</Text>

      {showBanner ? (
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
            <Feather name="coffee" size={16} color={c.accent} />
          </View>
          <Text style={styles.bannerText}>
            Welcome back! You&apos;ve seen {seenToday} {seenToday === 1 ? 'patient' : 'patients'} so
            far today.
          </Text>
          <Pressable
            onPress={() => setDismissed(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss welcome banner"
            style={({ pressed }) => [styles.bannerClose, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="x" size={16} color={c.textMuted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginBottom: space.md,
    },
    greetingWord: {
      fontFamily: fonts.displayMedium,
      fontSize: font.size.lg,
      color: c.textMuted,
    },
    greetingName: {
      fontFamily: fonts.displayBold,
      fontSize: 26,
      lineHeight: 32,
      color: c.text,
      marginTop: 2,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      marginTop: space.md,
      paddingVertical: space.md,
      paddingHorizontal: space.base,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.accentSoft,
    },
    bannerIcon: {
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.accentSoftStrong,
    },
    bannerText: {
      flex: 1,
      fontFamily: fonts.displayMedium,
      fontSize: font.size.base,
      lineHeight: 19,
      color: c.text,
    },
    bannerClose: {
      padding: 2,
    },
  });
}
