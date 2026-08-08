// State machine over expo-audio's AudioRecorder with metering enabled.
//
// States:
//   idle → permission-denied (terminal until reset)
//   idle → recording → paused ↔ recording → confirmed
//   any  → error    (terminal until reset)
//
// Step 3 scope: capture only. Upload + AI pipeline lives in step 4.

import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type RecorderStatus =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'paused'
  | 'confirming'
  | 'confirmed'
  | 'permission_denied'
  | 'error';

export interface RecorderState {
  status: RecorderStatus;
  durationMs: number;
  /** -1..0 dB clamped to 0..1 for the level meter; null when unavailable. */
  level: number | null;
  errorMessage: string | null;
  /** Local file URI of the saved recording, populated after confirm(). */
  fileUri: string | null;
  /** Final duration after confirm() in milliseconds. */
  finalDurationMs: number | null;
}

export interface RecorderControls {
  state: RecorderState;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => Promise<void>;
}

const RECORDINGS_DIR = `${FileSystem.documentDirectory ?? ''}recordings/`;

async function ensureDir(): Promise<void> {
  if (!FileSystem.documentDirectory) return; // web — no doc dir
  const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
  }
}

function meteringToLevel(meteringDb: number | undefined): number | null {
  // expo-audio reports metering in dBFS, roughly -160 (silent) .. 0 (peak).
  if (meteringDb === undefined || meteringDb === null || Number.isNaN(meteringDb)) return null;
  // Treat anything below -60 dB as silent; clamp to 0..1.
  const clamped = Math.max(-60, Math.min(0, meteringDb));
  return (clamped + 60) / 60;
}

function newFileBaseName(): string {
  // Local-only unique enough; backend assigns the real ID at upload time (step 4).
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useRecorder(): RecorderControls {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [finalDurationMs, setFinalDurationMs] = useState<number | null>(null);

  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    // iPhone built-in mic is mono. Asking for 2 channels makes
    // AVAudioSession refuse to activate ("Session activation failed").
    numberOfChannels: 1,
    isMeteringEnabled: true,
  });
  // Poll the recorder for live durationMs + metering every 100ms while active.
  const recState = useAudioRecorderState(recorder, 100);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fail = useCallback((message: string) => {
    if (!mountedRef.current) return;
    setStatus('error');
    setErrorMessage(message);
  }, []);

  const start = useCallback(async () => {
    if (status !== 'idle' && status !== 'permission_denied' && status !== 'error') return;
    try {
      setStatus('requesting_permission');
      setErrorMessage(null);

      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        if (mountedRef.current) {
          setStatus('permission_denied');
          setErrorMessage('Microphone permission denied');
        }
        return;
      }

      // iOS needs the audio session in recording mode AND playsInSilentMode so
      // the hardware switch (mute) doesn't silently zero out the input.
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await ensureDir();

      // Re-prepare every time so a confirmed-then-restart flow gets a fresh file.
      await recorder.prepareToRecordAsync({
        ...RecordingPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      recorder.record();

      if (!mountedRef.current) {
        await recorder.stop().catch(() => {});
        return;
      }
      setFileUri(null);
      setFinalDurationMs(null);
      setStatus('recording');
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Failed to start recording');
    }
  }, [fail, recorder, status]);

  const pause = useCallback(async () => {
    if (status !== 'recording') return;
    try {
      recorder.pause();
      if (mountedRef.current) setStatus('paused');
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Failed to pause');
    }
  }, [fail, recorder, status]);

  const resume = useCallback(async () => {
    if (status !== 'paused') return;
    try {
      // expo-audio resumes from paused via record().
      recorder.record();
      if (mountedRef.current) setStatus('recording');
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Failed to resume');
    }
  }, [fail, recorder, status]);

  const confirm = useCallback(async () => {
    if (status !== 'recording' && status !== 'paused') return;
    try {
      setStatus('confirming');
      const durBeforeStop = recState.durationMillis ?? 0;
      await recorder.stop();
      const tmpUri = recorder.uri;
      if (!tmpUri) throw new Error('Recording URI unavailable');

      // Move from expo-audio's temp path into our own recordings/ dir so the file
      // survives session restarts and has a stable name we can show the user.
      let finalUri = tmpUri;
      if (FileSystem.documentDirectory && Platform.OS !== 'web') {
        const name = `${newFileBaseName()}.m4a`;
        finalUri = `${RECORDINGS_DIR}${name}`;
        await FileSystem.moveAsync({ from: tmpUri, to: finalUri });
      }

      // Release the recording session so other audio works normally.
      await setAudioModeAsync({ allowsRecording: false });

      if (!mountedRef.current) return;
      setFileUri(finalUri);
      setFinalDurationMs(durBeforeStop);
      setStatus('confirmed');
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Failed to finalize recording');
    }
  }, [fail, recState.durationMillis, recorder, status]);

  const reset = useCallback(async () => {
    if (recorder.isRecording) {
      await recorder.stop().catch(() => {
        /* ignore */
      });
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (!mountedRef.current) return;
    setStatus('idle');
    setErrorMessage(null);
    setFileUri(null);
    setFinalDurationMs(null);
  }, [recorder]);

  // Derive the exposed state from internal status + the live recorder hook.
  const liveDurationMs = recState.durationMillis ?? 0;
  const durationMs =
    status === 'confirmed' ? (finalDurationMs ?? 0) : status === 'idle' ? 0 : liveDurationMs;
  const level =
    status === 'recording'
      ? meteringToLevel(recState.metering)
      : status === 'paused'
        ? 0
        : null;

  const state: RecorderState = {
    status,
    durationMs,
    level,
    errorMessage,
    fileUri,
    finalDurationMs,
  };

  return { state, start, pause, resume, confirm, reset };
}
