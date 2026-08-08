// Theme: holds the user's preferred mode (light / dark / system), exposes the
// active palette, and persists the choice across cold starts.
//
// Consumers:
//   const { mode, setMode, colors, isDark } = useTheme();
//   const colors = useThemeColors();          // shortcut when you only want colors
//   const styles = useStyles((c) => ({...})); // theme-aware StyleSheet

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { darkColors, lightColors, type ThemeColors } from './tokens';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  /** Currently active palette (after resolving 'system'). */
  colors: ThemeColors;
  /** True when the *resolved* theme is dark (system-following counts). */
  isDark: boolean;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = 'soapnotesai.themeMode.v2';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  // Default to dark — the SoapNotesAi brand reads best on black + green.
  // User can override via the toggle in Profile.
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [hydrated, setHydrated] = useState(false);

  // Load persisted preference once on cold start.
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      } catch {
        /* ignore — fall back to 'system' */
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      /* best-effort persistence */
    });
  }, []);

  const isDark = useMemo(() => {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return systemScheme === 'dark';
  }, [mode, systemScheme]);

  const colors = isDark ? darkColors : lightColors;

  const value = useMemo<ThemeValue>(
    () => ({ mode, setMode, colors, isDark }),
    [mode, setMode, colors, isDark],
  );

  // Don't render children until the persisted preference has loaded — avoids
  // a flash of the wrong theme.
  if (!hydrated) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

export function useThemeColors(): ThemeColors {
  return useTheme().colors;
}

/**
 * Theme-aware StyleSheet hook. Re-creates the stylesheet when the active
 * palette changes (e.g. on theme toggle or system mode swap).
 *
 *   const styles = useStyles((c) => StyleSheet.create({
 *     card: { backgroundColor: c.surface, borderColor: c.border },
 *   }));
 */
type StyleBuilder<T> = (c: ThemeColors) => T;
export function useStyles<T extends StyleSheet.NamedStyles<T>>(builder: StyleBuilder<T>): T {
  const colors = useThemeColors();
  return useMemo(() => builder(colors), [colors, builder]);
}
