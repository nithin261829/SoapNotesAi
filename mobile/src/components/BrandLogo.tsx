// SoapNotesAi wordmark — transparent PNG (1536 × 463 → 3.32:1).
// Pinned to the top-left of every screen as a quiet brand mark.
// Transparent background means it lays cleanly on cream or black.

import { Image, StyleSheet, View } from 'react-native';

const LOGO = require('../../assets/logo.png');
const LOGO_ASPECT = 1536 / 463; // width / height ≈ 3.32

interface Props {
  /** Height in points. Width auto-scales to preserve aspect ratio. Default 32. */
  height?: number;
}

export function BrandLogo({ height = 32 }: Props) {
  const width = Math.round(height * LOGO_ASPECT);
  return (
    <View>
      <Image
        source={LOGO}
        style={[styles.img, { height, width }]}
        resizeMode="contain"
        accessibilityLabel="SoapNotesAi"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  img: {},
});
