// Brand typography:
//  - Inter (sans) for body, controls, labels — clean, neutral, fits a clinical UI.
//  - Playfair Display (serif) — italic accent for hero words, mirrors the
//    italic "Reb|" on example.com.
//
// Usage in components: `fontFamily: fonts.display` (regular sans),
// `fonts.displayBold` (heavy headlines), `fonts.serifItalic` (accent words).
//
// Falls back to system fonts until expo-font has loaded the assets.
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import {
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_700Bold_Italic,
} from '@expo-google-fonts/playfair-display';
import { useFonts } from 'expo-font';

export const fonts = {
  display: 'Inter_400Regular',
  displayMedium: 'Inter_500Medium',
  displaySemi: 'Inter_600SemiBold',
  displayBold: 'Inter_700Bold',
  displayExtra: 'Inter_800ExtraBold',
  serifItalic: 'PlayfairDisplay_400Regular_Italic',
  serifBoldItalic: 'PlayfairDisplay_700Bold_Italic',
} as const;

export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_700Bold_Italic,
  });
  return loaded;
}
