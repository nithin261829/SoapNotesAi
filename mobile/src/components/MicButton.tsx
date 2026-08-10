import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, type ThemeColors } from '@/theme/tokens';

interface Props {
  status: 'idle' | 'recording' | 'paused' | 'busy';
  onPress: () => void;
  disabled?: boolean;
}

const LABELS: Record<Props['status'], string> = {
  idle: 'Tap to record',
  recording: 'Tap to pause',
  paused: 'Tap to resume',
  busy: 'Working',
};

const ICONS: Record<Props['status'], React.ComponentProps<typeof Feather>['name']> = {
  idle: 'mic',
  recording: 'pause',
  paused: 'play',
  busy: 'more-horizontal',
};

export function MicButton({ status, onPress, disabled }: Props) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const isIdle = status === 'idle';
  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isBusy = status === 'busy';

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isRecording) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [isRecording, pulse]);

  const ringStyle = (offset: number) => ({
    transform: [
      {
        scale: pulse.interpolate({
          inputRange: [offset, offset + 1],
          outputRange: [1, 1.6],
          extrapolate: 'clamp' as const,
        }),
      },
    ],
    opacity: pulse.interpolate({
      inputRange: [offset, offset + 0.7, offset + 1],
      outputRange: [0.35, 0.1, 0],
      extrapolate: 'clamp' as const,
    }),
  });

  const bg = isRecording ? c.recording : isPaused ? c.recordingDim : c.accent;
  const glyphColor = isBusy ? c.textMuted : '#FFFFFF';

  return (
    <View style={styles.wrap}>
      <View style={styles.buttonWrap}>
        {isRecording ? (
          <>
            <Animated.View pointerEvents="none" style={[styles.ring, ringStyle(0)]} />
            <Animated.View pointerEvents="none" style={[styles.ring, ringStyle(-0.5)]} />
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={LABELS[status]}
          onPress={onPress}
          disabled={disabled}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: bg,
              opacity: pressed || disabled ? 0.78 : 1,
            },
          ]}
        >
          {isBusy ? (
            <ActivityIndicator color="#FFFFFF" size="large" />
          ) : (
            <Feather name={ICONS[status]} size={78} color={glyphColor} />
          )}
        </Pressable>
        {/* Idle "record light" — a subtle red cue so it instantly reads as
            "this records," even though the resting button is brand green. */}
        {isIdle ? <View pointerEvents="none" style={styles.recDot} /> : null}
      </View>
      <Text style={styles.label}>{LABELS[status].toUpperCase()}</Text>
    </View>
  );
}

const SIZE = 168;
const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', gap: 14 },
    buttonWrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
    ring: {
      position: 'absolute',
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      backgroundColor: c.recording,
    },
    button: {
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 18,
      elevation: 8,
    },
    recDot: {
      position: 'absolute',
      top: 22,
      right: 22,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: c.recording,
      borderWidth: 3,
      borderColor: c.bg,
    },
    label: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs,
      color: c.textMuted,
      letterSpacing: 2,
    },
  });
