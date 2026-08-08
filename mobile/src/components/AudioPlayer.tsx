import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useMemo, useState } from 'react';
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

interface Props {
  /** Signed URL; null while it's being fetched. */
  url: string | null;
  /** Optional client-side duration in seconds (used while the real one loads). */
  fallbackDurationSec?: number | null;
  /** Surfaced if the URL fetch failed upstream. */
  error?: string | null;
}

export function AudioPlayer({ url, fallbackDurationSec, error }: Props) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const source = useMemo(() => (url ? { uri: url } : null), [url]);
  const player = useAudioPlayer(source, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);

  const duration = status.duration && status.duration > 0 ? status.duration : (fallbackDurationSec ?? 0);
  const current = status.currentTime || 0;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const ready = status.isLoaded && !!url;

  const onScrub = (e: GestureResponderEvent) => {
    if (!ready || !duration || !trackWidth) return;
    const x = e.nativeEvent.locationX;
    const fraction = Math.max(0, Math.min(1, x / trackWidth));
    void player.seekTo(fraction * duration);
  };

  const toggle = () => {
    if (!ready) return;
    if (status.playing) player.pause();
    else player.play();
  };

  const seekBy = (deltaSec: number) => {
    if (!ready || !duration) return;
    const next = Math.max(0, Math.min(duration, current + deltaSec));
    void player.seekTo(next);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.tagPill}>
          <Text style={styles.tagPillText}>Audio · verbatim</Text>
        </View>
        <Text style={styles.bufferDot}>
          {error
            ? '⚠ unavailable'
            : !url
              ? 'loading…'
              : !status.isLoaded
                ? 'buffering…'
                : status.isBuffering
                  ? 'buffering…'
                  : status.playing
                    ? '▶ playing'
                    : 'paused'}
        </Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back 10 seconds"
          onPress={() => seekBy(-10)}
          disabled={!ready}
          style={({ pressed }) => [styles.skipBtn, { opacity: !ready ? 0.4 : pressed ? 0.7 : 1 }]}
        >
          <Feather name="rotate-ccw" size={18} color={c.text} />
          <Text style={styles.skipText}>10</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause' : 'Play'}
          onPress={toggle}
          disabled={!ready}
          style={({ pressed }) => [
            styles.playBtn,
            { opacity: !ready ? 0.5 : pressed ? 0.85 : 1 },
          ]}
        >
          <Feather
            name={status.playing ? 'pause' : 'play'}
            size={28}
            color={c.textOnAccent}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Forward 10 seconds"
          onPress={() => seekBy(10)}
          disabled={!ready}
          style={({ pressed }) => [styles.skipBtn, { opacity: !ready ? 0.4 : pressed ? 0.7 : 1 }]}
        >
          <Feather name="rotate-cw" size={18} color={c.text} />
          <Text style={styles.skipText}>10</Text>
        </Pressable>
      </View>

      {/* Track */}
      <View style={{ gap: 6 }}>
        <Pressable
          onPress={onScrub}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          style={styles.track}
          disabled={!ready}
        >
          <View style={styles.trackBg} />
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
          <View
            style={[
              styles.trackKnob,
              { left: `${progress * 100}%`, opacity: ready ? 1 : 0.4 },
            ]}
          />
        </Pressable>
        <View style={styles.timesRow}>
          <Text style={styles.timeText}>{fmtMmSs(current)}</Text>
          <Text style={styles.timeText}>{duration ? fmtMmSs(duration) : '—'}</Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function fmtMmSs(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const r = total - m * 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.lg,
      gap: space.md,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    tagPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.sm,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
    },
    tagPillText: {
      fontSize: font.size.xs - 1,
      color: c.accent,
      fontWeight: font.weight.bold as '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    bufferDot: {
      color: c.textSubtle,
      fontSize: font.size.xs,
      fontWeight: font.weight.bold as '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.lg,
    },
    playBtn: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skipBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: radii.sm,
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.border,
    },
    skipText: {
      color: c.text,
      fontSize: font.size.xs,
      fontWeight: font.weight.bold as '700',
      letterSpacing: 0.5,
    },
    track: {
      height: 24,
      justifyContent: 'center',
    },
    trackBg: {
      position: 'absolute',
      top: 10,
      left: 0,
      right: 0,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.borderStrong,
    },
    trackFill: {
      position: 'absolute',
      top: 10,
      left: 0,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.accent,
    },
    trackKnob: {
      position: 'absolute',
      top: 6,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: c.accent,
      marginLeft: -6,
    },
    timesRow: { flexDirection: 'row', justifyContent: 'space-between' },
    timeText: {
      color: c.textMuted,
      fontSize: font.size.xs,
      fontVariant: ['tabular-nums'],
      letterSpacing: 0.3,
    },
    errorText: { color: c.danger, fontSize: font.size.xs },
  });
