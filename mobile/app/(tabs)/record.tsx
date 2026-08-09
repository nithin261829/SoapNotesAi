import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { listPatients, patchRecordingSoap, type PatientEntry } from '@/api/patients';
import {
  downloadRecordingPdf,
  uploadAudio,
  UploadError,
  type AudioUploadResponse,
} from '@/api/recordings';
import { useAuth } from '@/auth/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';
import { GreetingBanner } from '@/components/GreetingBanner';
import { LevelMeter } from '@/components/LevelMeter';
import { MicButton } from '@/components/MicButton';
import { ProcessingSteps, type SubStep, type SubStepStatus } from '@/components/ProcessingSteps';
import { SoapEditor } from '@/components/SoapEditor';
import { StatusBadge } from '@/components/StatusBadge';
import { Timer } from '@/components/Timer';
import { formatTime } from '@/recording/formatTime';
import { setRecordingActive, setRecordingDiscardHandler } from '@/recording/recordingFlag';
import { useRecorder } from '@/recording/useRecorder';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';
import type { SoapNote } from '@/types/soap';

type ProcessingPhase = 'idle' | 'uploading' | 'analyzing' | 'done' | 'failed';

interface ProcessingState {
  phase: ProcessingPhase;
  uploadFraction: number;
  result: AudioUploadResponse | null;
  errorMessage: string | null;
}

const INITIAL_PROCESSING: ProcessingState = {
  phase: 'idle',
  uploadFraction: 0,
  result: null,
  errorMessage: null,
};

export default function RecordScreen() {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const { getIdToken } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const localParams = useLocalSearchParams<{ patient_id?: string }>();
  const prefillPatientId = typeof localParams.patient_id === 'string' ? localParams.patient_id : null;
  const { state, start, pause, resume, confirm, reset } = useRecorder();
  const [processing, setProcessing] = useState<ProcessingState>(INITIAL_PROCESSING);
  // Working copy the doctor can edit. Seeded from the model response, mutated
  // by SoapEditor; reset whenever a new recording is started.
  const [editedSoap, setEditedSoap] = useState<SoapNote | null>(null);
  // Save (PATCH SOAP edits to Firestore) → Share (download fresh PDF) flow.
  const [savePhase, setSavePhase] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // Patient state. `mode = "new"` means we don't pre-select; the backend will
  // create the patient from the AI-extracted demographics.
  const [patients, setPatients] = useState<PatientEntry[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientEntry | null>(null);
  const [mode, setMode] = useState<'idle' | 'existing' | 'new'>('idle');
  const [chooseOpen, setChooseOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [patientsError, setPatientsError] = useState<string | null>(null);

  const reloadPatients = useCallback(async () => {
    try {
      const token = await getIdToken();
      const items = await listPatients(token);
      setPatients(items);
    } catch (e) {
      setPatientsError(e instanceof Error ? e.message : 'Failed to load patients');
    }
  }, [getIdToken]);

  useEffect(() => {
    void reloadPatients();
  }, [reloadPatients]);

  // If we got here from "Record new encounter" on a patient detail screen,
  // pre-select that patient and clear the URL param so it doesn't stick.
  useEffect(() => {
    if (!prefillPatientId || patients.length === 0) return;
    if (selectedPatient?.id === prefillPatientId) return;
    const match = patients.find((p) => p.id === prefillPatientId);
    if (match) {
      setSelectedPatient(match);
      setMode('existing');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.setParams({ patient_id: undefined } as any);
    }
  }, [prefillPatientId, patients, selectedPatient, router]);

  useEffect(() => {
    if (processing.phase === 'done' && processing.result) {
      setEditedSoap(processing.result.soap);
    }
  }, [processing.phase, processing.result]);

  // Editing after a save returns us to "needs saving" so the doctor doesn't
  // accidentally share a stale PDF.
  useEffect(() => {
    if (savePhase === 'saved') {
      setSavePhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedSoap]);

  const onSave = async () => {
    if (!editedSoap || !processing.result || savePhase === 'saving') return;
    setSavePhase('saving');
    setSaveError(null);
    try {
      const idToken = await getIdToken();
      await patchRecordingSoap(
        idToken,
        processing.result.recording_id,
        processing.result.patient_id,
        editedSoap,
      );
      setSavePhase('saved');
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : 'unknown error';
      setSaveError(msg);
      setSavePhase('failed');
    }
  };

  const onSharePdf = async () => {
    if (!processing.result || sharing) return;
    setSharing(true);
    setShareError(null);
    try {
      const idToken = await getIdToken();
      const uri = await downloadRecordingPdf(
        idToken,
        processing.result.recording_id,
        processing.result.patient_id,
      );
      const can = await Sharing.isAvailableAsync();
      if (can) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
      // PDFs are always re-rendered server-side on demand — no local copy kept.
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    } catch (e) {
      const msg =
        e instanceof UploadError
          ? `${e.message}${e.code ? ` (${e.code})` : ''}`
          : e instanceof Error
            ? e.message
            : 'unknown error';
      setShareError(msg);
    } finally {
      setSharing(false);
    }
  };

  const isCapturing = state.status === 'recording' || state.status === 'paused';
  const isConfirmed = state.status === 'confirmed' && state.fileUri;

  const micStatus =
    state.status === 'recording'
      ? 'recording'
      : state.status === 'paused'
        ? 'paused'
        : state.status === 'confirming' || state.status === 'requesting_permission'
          ? 'busy'
          : 'idle';

  const onMicPress = () => {
    if (state.status === 'recording') {
      void pause();
      return;
    }
    if (state.status === 'paused') {
      void resume();
      return;
    }
    if (
      state.status === 'idle' ||
      state.status === 'permission_denied' ||
      state.status === 'error'
    ) {
      // First mic press of a recording → ask "who is this for?".
      // Once mode is picked, future presses (e.g. after permission denial retry)
      // just resume the chosen flow.
      if (mode === 'idle') {
        setChooseOpen(true);
        return;
      }
      void start();
    }
  };

  const chooseExisting = () => {
    setChooseOpen(false);
    setPickerOpen(true);
  };

  const chooseNew = () => {
    setChooseOpen(false);
    setSelectedPatient(null);
    setMode('new');
    void start();
  };

  const onPickPatient = (p: PatientEntry) => {
    setSelectedPatient(p);
    setMode('existing');
    setPickerOpen(false);
    void start();
  };

  const onRestartPress = () => {
    const hasExistingPatient = mode === 'existing' && selectedPatient !== null;
    if (hasExistingPatient) {
      Alert.alert(
        'Restart recording?',
        `Discard this take and start a fresh one for ${selectedPatient.patient.name}, or discard the patient too?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard patient',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await reset();
                setMode('idle');
                setSelectedPatient(null);
              })();
            },
          },
          {
            text: 'Keep patient',
            onPress: () => {
              void (async () => {
                await reset();
                await start();
              })();
            },
          },
        ],
      );
      return;
    }
    Alert.alert(
      'Restart recording?',
      'This discards the current take and clears the patient selection. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restart',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await reset();
              setMode('idle');
              setSelectedPatient(null);
            })();
          },
        },
      ],
    );
  };

  const onStartProcessing = async () => {
    if (!state.fileUri || processing.phase === 'uploading' || processing.phase === 'analyzing') return;
    setProcessing({ phase: 'uploading', uploadFraction: 0, result: null, errorMessage: null });
    try {
      const idToken = await getIdToken();
      const result = await uploadAudio({
        fileUri: state.fileUri,
        // In "new" mode we omit patient_id; backend auto-creates from SOAP demographics.
        patientId: selectedPatient?.id,
        durationMs: state.finalDurationMs,
        idToken,
        onProgress: (fraction) => {
          setProcessing((p) =>
            p.phase === 'uploading'
              ? { ...p, uploadFraction: fraction, phase: fraction >= 1 ? 'analyzing' : 'uploading' }
              : p,
          );
        },
      });
      setProcessing({ phase: 'done', uploadFraction: 1, result, errorMessage: null });
      // Nothing PHI stays on the device: the canonical audio now lives in
      // cloud storage, so drop the local capture file. Kept on failure so
      // RETRY can re-upload.
      void FileSystem.deleteAsync(state.fileUri, { idempotent: true }).catch(() => {});
    } catch (e) {
      const message =
        e instanceof UploadError
          ? `${e.message}${e.code ? ` (${e.code})` : ''}`
          : e instanceof Error
            ? e.message
            : 'unknown error';
      setProcessing({ phase: 'failed', uploadFraction: 0, result: null, errorMessage: message });
    }
  };

  const onNewRecording = () => {
    setProcessing(INITIAL_PROCESSING);
    setEditedSoap(null);
    setSavePhase('idle');
    setSaveError(null);
    setSharing(false);
    setShareError(null);
    setMode('idle');
    setSelectedPatient(null);
    void reset();
  };

  const steps = buildSteps(processing);

  const canChangePatient =
    state.status === 'idle' ||
    state.status === 'permission_denied' ||
    state.status === 'error';

  // Back behavior:
  //   - Always confirm before discarding the selected patient
  //   - If we have a navigation back stack (came from Patient detail) → go back
  //   - Otherwise → clear state and stay on the Record tab in idle mode
  const onBackPress = () => {
    if (mode === 'idle') {
      if (router.canGoBack()) router.back();
      return;
    }
    Alert.alert(
      'Discard this patient?',
      mode === 'existing' && selectedPatient
        ? `This clears the selection for ${selectedPatient.patient.name} and any unsaved take.`
        : 'This clears the new-patient setup and any unsaved take.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await reset();
              setMode('idle');
              setSelectedPatient(null);
              setProcessing(INITIAL_PROCESSING);
              setEditedSoap(null);
              setSavePhase('idle');
              setSaveError(null);
              if (router.canGoBack()) router.back();
            })();
          },
        },
      ],
    );
  };

  // Inject a back-arrow into the tab's native header — only while a patient
  // is in flight. Idle mode drops it so the bare "Record" tab title shows.
  // Uses navigation.setOptions because Tabs ignore <Stack.Screen>.
  // Tab has no native header anymore — header bar moved out of the design.
  // Recording status + back affordance both live inline in the hero now.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Keep the global "is recording" flag in sync. The Tabs layout reads it
  // synchronously when intercepting tab presses.
  useEffect(() => {
    const active = state.status === 'recording' || state.status === 'paused';
    setRecordingActive(active);
    return () => setRecordingActive(false);
  }, [state.status]);

  // Register how to actually tear down a recording when the Tabs layout's
  // alert fires "Discard". Closure captures the latest reset + setters.
  useEffect(() => {
    setRecordingDiscardHandler(async () => {
      await reset();
      setMode('idle');
      setSelectedPatient(null);
    });
    return () => setRecordingDiscardHandler(null);
  }, [reset]);

  const isRec = state.status === 'recording';
  const isPaused = state.status === 'paused';

  return (
    <View style={styles.root}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 8 }]}
    >
      <View style={[styles.cornerLogo, { top: insets.top + 8 }]} pointerEvents="none">
        <BrandLogo height={26} />
      </View>
      {state.status === 'idle' && processing.phase === 'idle' ? <GreetingBanner /> : null}
      {/* In-content top row — back button (when needed) + REC pill (when active) */}
      {(mode !== 'idle' || isRec || isPaused) ? (
        <View style={styles.topRow}>
          {mode !== 'idle' ? (
            <Pressable
              onPress={onBackPress}
              hitSlop={12}
              style={({ pressed }) => [styles.inlineBackBtn, { opacity: pressed ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Feather name="chevron-left" size={22} color={c.text} />
              <Text style={styles.inlineBackText}>Back</Text>
            </Pressable>
          ) : <View />}
          {isRec || isPaused ? (
            <View style={[styles.recPill, isPaused && { backgroundColor: c.recordingDim }]}>
              <View style={[styles.recPillDot, isPaused && { opacity: 0.5 }]} />
              <Text style={styles.recPillText}>{isRec ? 'REC' : 'PAUSED'}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ─── HERO ──────────────────────────────────────────────── */}
      <View style={styles.hero}>
        {mode === 'idle' ? (
          <View style={styles.heroDisplay}>
            <Text style={styles.heroDisplayLine}>Record</Text>
            <Text style={styles.heroDisplaySub}>
              Tap the mic to start. The AI drafts the SOAP; you review and sign.
            </Text>
          </View>
        ) : null}

        {/* Patient pill — informational. Use the Back button at the top to
            discard. While recording, a small lock icon reinforces the state. */}
        {mode !== 'idle' ? (
          <View style={styles.patientPill}>
            <View style={{ flex: 1 }}>
              <Text style={styles.patientPillLabel}>
                {mode === 'existing' ? 'Patient' : 'New patient'}
              </Text>
              <Text style={styles.patientPillValue}>
                {mode === 'existing'
                  ? (selectedPatient?.patient.name ?? '—')
                  : 'AI will extract details'}
              </Text>
            </View>
            {!canChangePatient ? (
              <View style={styles.patientPillLocked}>
                <Feather name="lock" size={11} color={c.textSubtle} />
                <Text style={styles.patientPillLockedText}>LOCKED</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Timer ms={state.durationMs} active={state.status === 'recording'} />

        <View style={styles.meterBlock}>
          <LevelMeter level={isCapturing ? state.level : null} />
        </View>

        <View style={styles.micBlock}>
          <MicButton
            status={micStatus}
            onPress={onMicPress}
            disabled={state.status === 'requesting_permission' || state.status === 'confirming'}
          />
        </View>

        {isCapturing ? (
          <View style={styles.transportRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Restart recording"
              disabled={state.status === 'confirming'}
              onPress={onRestartPress}
              style={({ pressed }) => [
                styles.restartBtn,
                { opacity: state.status === 'confirming' ? 0.6 : pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={styles.restartBtnLabel}>↺ RESTART</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm and end recording"
              disabled={state.status === 'confirming'}
              onPress={() => void confirm()}
              style={({ pressed }) => [
                styles.confirmBtn,
                { opacity: state.status === 'confirming' ? 0.6 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.confirmBtnLabel}>CONFIRM →</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* ─── DOWN SECTION ──────────────────────────────────────── */}
      {isConfirmed ? (
        <View style={styles.downSection}>
          {/* Result header card */}
          <View style={styles.headerCard}>
            <View style={styles.headerCardTop}>
              <View style={{ flex: 1 }}>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>Recording</Text>
                </View>
                <Text style={styles.headerTitle}>
                  {processing.result
                    ? processing.result.patient_created
                      ? `New: ${processing.result.patient_name}`
                      : `For: ${processing.result.patient_name}`
                    : 'Saved locally'}
                </Text>
                <Text style={styles.headerSubtitle}>
                  {processing.result?.patient_created
                    ? 'Patient created from the dictation. Open the Patients tab to refine demographics.'
                    : 'Audio stored under the patient. Transcript + SOAP are ready to review below.'}
                </Text>
              </View>
              <StatusBadge tone="success" label="Captured" />
            </View>

            <View style={styles.divider} />

            <View style={styles.metaRow}>
              <MetaCell label="Duration" value={formatTime(state.finalDurationMs ?? 0)} />
              {processing.result ? (
                <MetaCell label="Size" value={kib(processing.result.size_bytes)} />
              ) : null}
              <MetaCell label="Format" value="m4a" />
            </View>

            <Text style={styles.metaPath} numberOfLines={2}>
              {state.fileUri}
            </Text>

            {processing.phase === 'idle' ? (
              <Pressable
                onPress={() => void onStartProcessing()}
                style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Send for processing"
              >
                <Text style={styles.primaryBtnLabel}>SEND FOR PROCESSING →</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Pipeline card */}
          {processing.phase !== 'idle' ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>Pipeline</Text>
                </View>
                <Text style={styles.cardTitle}>
                  {processing.phase === 'done'
                    ? 'Ready to review'
                    : processing.phase === 'failed'
                      ? 'Failed — retry below'
                      : processing.phase === 'analyzing'
                        ? 'Analyzing with AI'
                        : 'Uploading audio'}
                </Text>
                <Text style={styles.cardDescription}>
                  Upload audio, transcribe, structure into a validated SOAP note, and render the
                  PDF.
                </Text>
              </View>
              <View style={styles.divider} />
              <ProcessingSteps steps={steps} />
              {processing.phase === 'failed' ? (
                <Pressable
                  onPress={() => void onStartProcessing()}
                  style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.75 : 1 }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryBtnLabel}>RETRY</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* SOAP cards — editable */}
          {processing.phase === 'done' && processing.result && editedSoap ? (
            <SoapEditor
              soap={editedSoap}
              transcript={processing.result.transcript}
              onChange={setEditedSoap}
            />
          ) : null}

          {/* Save / Share / New recording card */}
          {processing.phase === 'done' && editedSoap && processing.result ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>Finalize</Text>
                </View>
                <Text style={styles.cardTitle}>
                  {savePhase === 'saved' ? 'Saved' : 'Save the information'}
                </Text>
                <Text style={styles.cardDescription}>
                  {savePhase === 'saved'
                    ? 'Your edits are stored under the patient. You can share the PDF or start a new recording.'
                    : 'Save your edits to the patient record. You can then share the PDF or start a new recording.'}
                </Text>
              </View>
              <View style={styles.divider} />

              {savePhase !== 'saved' ? (
                <>
                  <Pressable
                    onPress={() => void onSave()}
                    disabled={savePhase === 'saving'}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { opacity: savePhase === 'saving' ? 0.7 : pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Save the information"
                  >
                    {savePhase === 'saving' ? (
                      <ActivityIndicator color={c.textOnAccent} />
                    ) : (
                      <Text style={styles.primaryBtnLabel}>SAVE THE INFORMATION →</Text>
                    )}
                  </Pressable>
                  {savePhase === 'failed' && saveError ? (
                    <Text style={styles.errorText}>{saveError}</Text>
                  ) : null}
                </>
              ) : (
                <View style={{ gap: space.sm }}>
                  <View style={styles.pdfReadyRow}>
                    <StatusBadge tone="success" label="Saved" />
                    <Text style={styles.pdfPath} numberOfLines={1}>
                      {processing.result.patient_name}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => void onSharePdf()}
                    disabled={sharing}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { opacity: sharing ? 0.7 : pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                  >
                    {sharing ? (
                      <ActivityIndicator color={c.textOnAccent} />
                    ) : (
                      <Text style={styles.primaryBtnLabel}>SHARE THE PDF →</Text>
                    )}
                  </Pressable>
                  {shareError ? <Text style={styles.errorText}>{shareError}</Text> : null}
                  <Pressable
                    onPress={onNewRecording}
                    style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.75 : 1 }]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryBtnLabel}>↻ NEW RECORDING</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}

        </View>
      ) : null}

      {state.status === 'permission_denied' ? (
        <View style={styles.errorCard}>
          <StatusBadge tone="danger" label="Mic denied" />
          <Text style={styles.errorText}>
            Microphone permission was denied. Enable it in your device settings, then try again.
          </Text>
        </View>
      ) : null}

      {state.status === 'error' && state.errorMessage ? (
        <View style={styles.errorCard}>
          <StatusBadge tone="danger" label="Error" />
          <Text style={styles.errorText}>{state.errorMessage}</Text>
        </View>
      ) : null}

      {/* "Who is this for?" mode chooser */}
      <Modal
        visible={chooseOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setChooseOpen(false)}
      >
        <Pressable onPress={() => setChooseOpen(false)} style={styles.modalBackdrop}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.modalSheet}>
            <View style={styles.tagPill}>
              <Text style={styles.tagPillText}>This encounter is for</Text>
            </View>
            <Text style={styles.chooseTitle}>Who's the patient?</Text>
            <Text style={styles.chooseSubtitle}>
              Pick one. For a walk-in, just dictate the name in the recording and the AI fills in
              the rest.
            </Text>
            <Pressable
              onPress={chooseExisting}
              style={({ pressed }) => [styles.chooseBtn, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={styles.chooseBtnLabel}>EXISTING PATIENT</Text>
              <Text style={styles.chooseBtnHint}>Pick from your list</Text>
            </Pressable>
            <Pressable
              onPress={chooseNew}
              style={({ pressed }) => [
                styles.chooseBtn,
                styles.chooseBtnPrimary,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.chooseBtnLabel, styles.chooseBtnLabelPrimary]}>
                NEW PATIENT
              </Text>
              <Text style={[styles.chooseBtnHint, styles.chooseBtnHintPrimary]}>
                AI extracts demographics from the audio
              </Text>
            </Pressable>
            <Pressable onPress={() => setChooseOpen(false)} style={styles.resetBtn}>
              <Text style={styles.resetLink}>CANCEL</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Existing patient picker */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg }}>
          <View style={styles.tagPill}>
            <Text style={styles.tagPillText}>Encounter for</Text>
          </View>
          <Text style={[styles.heroEyebrow, { marginTop: 8, marginBottom: 12 }]}>
            Pick a patient
          </Text>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {patientsError ? <Text style={styles.errorText}>{patientsError}</Text> : null}
            {patients.length === 0 ? (
              <Text style={[styles.disclaimer, { textAlign: 'left', paddingTop: 0 }]}>
                No patients yet. Tap CANCEL and choose "New patient" instead.
              </Text>
            ) : null}
            {patients.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => onPickPatient(p)}
                style={({ pressed }) => [
                  styles.patientRow,
                  selectedPatient?.id === p.id && styles.patientRowActive,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.patientRowName}>{p.patient.name}</Text>
                  <Text style={styles.patientRowMeta}>
                    {p.patient.age_at_record != null ? `${p.patient.age_at_record} y/o` : '—'}
                    {p.patient.sex ? ` · ${p.patient.sex}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={() => setPickerOpen(false)} style={styles.resetBtn}>
            <Text style={styles.resetLink}>CANCEL</Text>
          </Pressable>
        </View>
      </Modal>

      <Text style={styles.disclaimer}>
        Draft assistive tool · review and sign every note before clinical use.
      </Text>
    </ScrollView>
    </View>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaCellLabel}>{label}</Text>
      <Text style={styles.metaCellValue}>{value}</Text>
    </View>
  );
}

function buildSteps(processing: ProcessingState): SubStep[] {
  const isUploading = processing.phase === 'uploading';
  const isAnalyzing = processing.phase === 'analyzing';
  const isDone = processing.phase === 'done';
  const isFailed = processing.phase === 'failed';

  const uploadStatus: SubStepStatus = isUploading
    ? 'in_progress'
    : isAnalyzing || isDone
      ? 'done'
      : isFailed
        ? 'failed'
        : 'pending';

  const analyzeStatus: SubStepStatus = isAnalyzing
    ? 'in_progress'
    : isDone
      ? 'done'
      : isFailed && processing.uploadFraction >= 1
        ? 'failed'
        : 'pending';

  const uploadDetail = isUploading
    ? `${Math.round(processing.uploadFraction * 100)}%`
    : isDone && processing.result
      ? kib(processing.result.size_bytes)
      : isFailed
        ? processing.errorMessage
        : null;

  const analyzeDetail = isAnalyzing ? 'AI engine' : isDone ? 'Complete' : null;

  return [
    { key: 'upload', label: 'Upload audio', status: uploadStatus, detail: uploadDetail },
    { key: 'transcribe', label: 'Transcribe', status: analyzeStatus, detail: analyzeDetail },
    {
      key: 'structure',
      label: 'Structure SOAP',
      status: analyzeStatus,
      detail: isDone ? 'Validated against schema' : null,
    },
    { key: 'pdf', label: 'Generate PDF', status: 'pending', detail: 'wired up in step 8' },
  ];
}

function kib(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1, backgroundColor: c.bg },
  container: {
    flexGrow: 1,
    backgroundColor: c.bg,
    paddingHorizontal: space.base,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cornerLogo: { position: 'absolute', right: space.base, zIndex: 10 },
  inlineBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  inlineBackText: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: 15,
    marginLeft: -2,
  },
  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: c.recording,
  },
  recPillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  recPillText: {
    fontFamily: fonts.displayBold,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 1.2,
  },

  // ─── HERO ─────────────────────────────────────────
  hero: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.base,
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
  },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroEyebrow: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  heroDisplay: { alignItems: 'flex-start', alignSelf: 'stretch', paddingHorizontal: 4 },
  heroDisplayLine: {
    fontFamily: fonts.displayBold,
    fontSize: 34,
    lineHeight: 40,
    color: c.text,
    letterSpacing: -1,
  },
  heroDisplaySub: {
    fontFamily: fonts.display,
    fontSize: font.size.md,
    color: c.textMuted,
    lineHeight: 21,
    marginTop: space.sm,
  },
  meterBlock: { width: '100%', marginVertical: space.sm },
  micBlock: { marginTop: space.sm },
  transportRow: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restartBtn: {
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: c.danger,
    alignItems: 'center',
    minWidth: 130,
  },
  restartBtnLabel: {
    color: c.danger,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
  },
  confirmBtn: {
    paddingVertical: space.md + 2,
    paddingHorizontal: space.xl,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    alignItems: 'center',
    minWidth: 160,
  },
  confirmBtnLabel: {
    color: c.textOnAccent,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
  },

  // ─── DOWN SECTION ─────────────────────────────────
  downSection: { gap: space.md },

  // Shared tag pill (yellow)
  tagPill: {
    alignSelf: 'flex-start',
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

  // Header card
  headerCard: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.base,
  },
  headerCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headerTitle: {
    fontSize: font.size.xxl,
    fontWeight: font.weight.bold as '700',
    color: c.text,
    marginTop: 6,
    letterSpacing: -0.6,
  },
  headerSubtitle: {
    fontSize: font.size.sm,
    color: c.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },
  metaRow: { flexDirection: 'row', gap: space.sm },
  costRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: space.md,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  recBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: c.text,
  },
  backText: {
    color: c.text,
    fontSize: font.size.base,
    fontWeight: font.weight.semibold as '600',
    marginLeft: -2,
  },
  patientPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    marginTop: space.sm,
  },
  patientPillLabel: {
    color: c.accent,
    fontSize: font.size.xs - 1,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  patientPillValue: {
    color: c.text,
    fontSize: font.size.base,
    fontWeight: font.weight.semibold as '600',
  },
  patientPillAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
  },
  patientPillActionText: {
    color: c.accent,
    fontSize: font.size.xs - 2,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
  },
  patientPillLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  patientPillLockedText: {
    color: c.textSubtle,
    fontSize: font.size.xs - 2,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
  },
  patientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radii.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 8,
  },
  patientRowActive: { borderColor: c.accent },
  patientRowName: {
    color: c.text,
    fontSize: font.size.base,
    fontWeight: font.weight.semibold as '600',
  },
  patientRowMeta: { color: c.textMuted, fontSize: font.size.sm, marginTop: 2 },
  patientRowActiveDot: { color: c.accent, fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(19, 44, 71, 0.45)', // navy scrim, lighter for cream theme
    justifyContent: 'center',
    padding: space.lg,
  },
  modalSheet: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.md,
  },
  chooseTitle: {
    color: c.text,
    fontSize: font.size.xxl,
    fontWeight: font.weight.bold as '700',
    letterSpacing: -0.6,
    marginTop: 4,
  },
  chooseSubtitle: { color: c.textMuted, fontSize: font.size.sm, lineHeight: 19 },
  chooseBtn: {
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.md,
    paddingVertical: space.md + 4,
    paddingHorizontal: space.lg,
    alignItems: 'flex-start',
    gap: 4,
  },
  chooseBtnPrimary: { backgroundColor: c.accent, borderColor: c.accent },
  chooseBtnLabel: {
    color: c.text,
    fontSize: font.size.base,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
  },
  chooseBtnLabelPrimary: { color: c.textOnAccent },
  chooseBtnHint: { color: c.textMuted, fontSize: font.size.xs },
  chooseBtnHintPrimary: { color: 'rgba(255,255,255,0.85)' },
  pdfReadyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pdfPath: {
    flex: 1,
    fontSize: font.size.xs,
    color: c.textMuted,
    fontFamily: 'Courier',
  },
  metaCell: {
    flex: 1,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  metaCellLabel: {
    fontSize: font.size.xs - 1,
    color: c.accent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  metaCellValue: {
    fontSize: font.size.base + 1,
    color: c.text,
    fontWeight: font.weight.semibold as '600',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  metaPath: {
    fontSize: font.size.xs,
    color: c.textDim,
    fontFamily: 'Courier',
    lineHeight: 15,
  },

  divider: { height: 1, backgroundColor: c.border },

  // Generic card
  card: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.base,
  },
  cardHeader: { gap: 6 },
  cardTitle: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold as '700',
    color: c.text,
    marginTop: 6,
    letterSpacing: -0.4,
  },
  cardDescription: {
    fontSize: font.size.sm,
    color: c.textMuted,
    lineHeight: 18,
  },

  // Buttons
  primaryBtn: {
    marginTop: space.xs,
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    alignItems: 'center',
  },
  primaryBtnLabel: {
    color: c.textOnAccent,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
  },
  secondaryBtn: {
    marginTop: space.sm,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.base,
    borderRadius: radii.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: c.borderStrong,
    alignItems: 'center',
  },
  secondaryBtnLabel: {
    color: c.text,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1,
  },

  resetBtn: { alignSelf: 'center', paddingVertical: space.md, marginTop: space.sm },
  resetLink: {
    color: c.accent,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.5,
  },

  // Error
  errorCard: {
    backgroundColor: c.dangerSoft,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.danger,
    padding: space.base,
    gap: space.sm,
  },
  errorText: { color: c.text, fontSize: font.size.sm, lineHeight: 20 },

  disclaimer: {
    fontSize: font.size.xs,
    color: c.textDim,
    textAlign: 'center',
    paddingTop: space.lg,
    paddingHorizontal: space.lg,
    lineHeight: 16,
  },
});
