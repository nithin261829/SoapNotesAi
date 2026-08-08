// SoapNotesAi palettes — both light + dark, swappable at runtime via ThemeProvider.
//
// The exported `colors` is the LIGHT palette (used as a fallback / for
// type inference). Components should call `useThemeColors()` from the theme
// hook to get the active palette at render time, then build their StyleSheet
// from it via `useStyles(builder)`.

export const lightColors = {
  // Backgrounds — warm cream + near-white surfaces.
  bg: '#F8F1E3',
  surface: '#FFFEF9',
  surfaceElevated: '#FFFFFF',
  surfaceHover: '#F2EBDA',

  // Borders.
  border: '#E6DFCB',
  borderStrong: '#AFAFA1',
  borderAccent: '#13612E',

  // Text.
  text: '#1A1A1A',
  textMuted: '#7A7A6A',
  textSubtle: '#989B9E',
  textDim: '#AFAFA1',

  // Primary brand — SoapNotesAi forest green.
  accent: '#13612E',
  accentBright: '#1A7A3B',
  accentDim: '#0E4622',
  accentSoft: 'rgba(19, 97, 46, 0.08)',
  accentSoftStrong: 'rgba(19, 97, 46, 0.16)',
  textOnAccent: '#FFFFFF',

  // Secondary accent — warm gold.
  accentAlt: '#FEC42D',
  accentAltSoft: 'rgba(254, 196, 45, 0.18)',
  textOnAccentAlt: '#1A1A1A',

  contrast: '#132C47',

  // Status.
  success: '#13612E',
  successSoft: 'rgba(19, 97, 46, 0.12)',
  warning: '#B26B00',
  warningSoft: 'rgba(178, 107, 0, 0.12)',
  danger: '#A6263A',
  dangerSoft: 'rgba(166, 38, 58, 0.10)',

  recording: '#D7372E',
  recordingSoft: 'rgba(215, 55, 46, 0.12)',
  recordingDim: '#A82920',

  soap: {
    subjective: '#13612E',
    objective: '#132C47',
    assessment: '#7A4A12',
    plan: '#B26B00',
  },
} as const;

// Type widens the literal string types so dark/light can hold different hex codes.
export type ThemeColors = {
  -readonly [K in keyof typeof lightColors]: typeof lightColors[K] extends object
    ? { -readonly [J in keyof typeof lightColors[K]]: string }
    : string;
};

export const darkColors: ThemeColors = {
  // True dark mode — near-black surfaces (matches every other dark-mode app
  // doctors use), brighter brand green so it pops, brighter accents.
  bg: '#000000',                // OLED-friendly pure black
  surface: '#121212',           // raised card (Material dark elevation 1)
  surfaceElevated: '#1C1C1E',   // nested input / pill
  surfaceHover: '#222224',

  border: '#2A2A2C',            // hairlines
  borderStrong: '#3A3A3C',
  borderAccent: '#4ABF6E',

  text: '#FFFFFF',
  textMuted: '#A1A1A6',
  textSubtle: '#6E6E73',
  textDim: '#48484A',

  // Brand green — muted forest tone, brightened just enough to stay legible
  // on pure black without screaming.
  accent: '#2E9651',
  accentBright: '#4AB068',
  accentDim: '#1F6E3A',
  accentSoft: 'rgba(46, 150, 81, 0.14)',
  accentSoftStrong: 'rgba(46, 150, 81, 0.22)',
  textOnAccent: '#FFFFFF',

  accentAlt: '#FFD45A',
  accentAltSoft: 'rgba(255, 212, 90, 0.18)',
  textOnAccentAlt: '#000000',

  contrast: '#4A6FA5',

  success: '#4ABF6E',
  successSoft: 'rgba(74, 191, 110, 0.16)',
  warning: '#FFB454',
  warningSoft: 'rgba(255, 180, 84, 0.14)',
  danger: '#FF6B7A',
  dangerSoft: 'rgba(255, 107, 122, 0.12)',

  recording: '#FF453A',
  recordingSoft: 'rgba(255, 69, 58, 0.18)',
  recordingDim: '#C8362E',

  soap: {
    subjective: '#4ABF6E',
    objective: '#6FA4E0',
    assessment: '#E8A859',
    plan: '#FFB454',
  },
};

// Default export = light palette. Components are encouraged to use
// `useThemeColors()` so they swap automatically when the user toggles theme.
export const colors = lightColors;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const font = {
  size: {
    xs: 11,
    sm: 12,
    base: 14,
    md: 15,
    lg: 17,
    xl: 22,
    xxl: 28,
    hero: 44,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    black: '800',
  },
} as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  raised: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 4,
  },
} as const;

