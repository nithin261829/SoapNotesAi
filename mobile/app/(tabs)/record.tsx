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

import { getBillingStatus, type BillingStatus } from '@/api/billing';
import { listCases, type CaseEntry } from '@/api/cases';
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
import { font, radii, radiusXl2, shadow, space, type ThemeColors } from '@/theme/tokens';
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
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  // Case selection: after picking an existing patient, choose a new case or
  // follow up an open one. selectedCaseId is passed to the upload.
  const [caseChooserOpen, setCaseChooserOpen] = useState(false);
  const [patientCases, setPatientCases] = useState<CaseEntry[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | undefined>(undefined);

  // Paywall: block new notes when the trial has ended and nothing is paid.
  // Only hard-blocks when enforcement is on server-side (can_create=false).
  const blocked = billing != null && !billing.can_create;

  const reloadPatients = useCallback(async () => {
    try {
      const token = await getIdToken();
      const items = await listPatients(token);
      setPatients(items);
    } catch (e) {
      setPatientsError(e instanceof Error ? e.message : 'Failed to load patients');
    }
  }, [getIdToken]);

  const reloadBilling = useCallback(async () => {
    try {
      const token = await getIdToken();
      setBilling(await getBillingStatus(token));
    } catch {
      /* status is best-effort; upload still enforces server-side */
    }
  }, [getIdToken]);

  useEffect(() => {
    void reloadBilling();
  }, [reloadBilling]);

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
    // Paywall: if the trial ended and nothing is paid, send them to Payments
    // instead of letting them record and fail at upload.
    if (blocked && state.status === 'idle') {
      router.push('/payments' as never);
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
    // Refresh so patients added since this screen mounted show up.
    void reloadPatients();
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
    setSelectedCaseId(undefined);
    // Fetch open cases → if any, ask new-case-vs-follow-up; else start fresh.
    void (async () => {
      try {
        const token = await getIdToken();
        const cases = await listCases(token, p.id);
        if (cases.length > 0) {
          setPatientCases(cases);
          setCaseChooserOpen(true);
          return;
        }
      } catch {
        /* if cases can't load, just start a new case */
      }
      void start();
    })();
  };

  const chooseNewCase = () => {
    setSelectedCaseId(undefined);
    setCaseChooserOpen(false);
    void start();
  };

  const chooseFollowUp = (caseId: string) => {
    setSelectedCaseId(caseId);
    setCaseChooserOpen(false);
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
        caseId: selectedCaseId,
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
    setSelectedCaseId(undefined);
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

      {/* Paywall banner — trial ended, nothing paid, enforcement on */}
      {blocked && state.status === 'idle' && processing.phase === 'idle' ? (
        <Pressable
          onPress={() => router.push('/payments' as never)}
          style={({ pressed }) => [
            styles.paywallCard,
            pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
          ]}
        >
          <Feather name="lock" size={18} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.paywallTitle}>
              {billing?.state === 'no_plan'
                ? 'Activate your account to start'
                : 'Your free trial has ended'}
            </Text>
            <Text style={styles.paywallBody}>
              {billing?.state === 'no_plan'
                ? 'Pay the ₹500 joining fee (includes a 7-day trial) to create notes.'
                : 'Pay to continue creating notes. Your existing patients and notes stay accessible.'}
            </Text>
          </View>
          <Text style={styles.paywallCta}>PAY →</Text>
        </Pressable>
      ) : billing?.state === 'trial' && billing.trial_days_left != null ? (
        <View style={styles.trialPill}>
          <Feather name="clock" size={13} color={c.accent} />
          <Text style={styles.trialPillText}>
            Free trial · {billing.trial_days_left} day{billing.trial_days_left === 1 ? '' : 's'} left
          </Text>
        </View>
      ) : null}
      {/* In-content top row — back button (when needed) + REC pill (when active) */}
      {(mode !== 'idle' || isRec || isPaused) ? (
        <View style={styles.topRow}>
          {mode !== 'idle' ? (
            <Pressable
              onPress={onBackPress}
              hitSlop={12}
              style={({ pressed }) => [
                styles.inlineBackBtn,
                pressed && { opacity: 0.5, transform: [{ scale: 0.985 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Feather name="chevron-left" size={22} color={c.text} />
              <Text style={styles.inlineBackText}>Back</Text>
            </Pressable>
          ) : null}
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
                pressed && { transform: [{ scale: 0.985 }] },
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
                pressed && { transform: [{ scale: 0.985 }] },
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
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                ]}
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
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                  ]}
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
                      { opacity: savePhase === 'saving' ? 0.7 : pressed ? 0.9 : 1 },
                      pressed && { transform: [{ scale: 0.985 }] },
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
                      { opacity: sharing ? 0.7 : pressed ? 0.9 : 1 },
                      pressed && { transform: [{ scale: 0.985 }] },
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
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                    ]}
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
              style={({ pressed }) => [
                styles.chooseBtn,
                pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
              ]}
            >
              <Text style={styles.chooseBtnLabel}>EXISTING PATIENT</Text>
              <Text style={styles.chooseBtnHint}>Pick from your list</Text>
            </Pressable>
            <Pressable
              onPress={chooseNew}
              style={({ pressed }) => [
                styles.chooseBtn,
                styles.chooseBtnPrimary,
                pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
              ]}
            >
              <Text style={[styles.chooseBtnLabel, styles.chooseBtnLabelPrimary]}>
                NEW PATIENT
              </Text>
              <Text style={[styles.chooseBtnHint, styles.chooseBtnHintPrimary]}>
                AI extracts demographics from the audio
              </Text>
            </Pressable>
            <Pressable onPress={() => setChooseOpen(false)} style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.6 }]}>
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
                  pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
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
          <Pressable onPress={() => setPickerOpen(false)} style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.6 }]}>
            <Text style={styles.resetLink}>CANCEL</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Case chooser — new case vs follow-up an existing open case */}
      <Modal
        visible={caseChooserOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCaseChooserOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg }}>
          <View style={styles.tagPill}>
            <Text style={styles.tagPillText}>
              {selectedPatient?.patient.name ?? 'Patient'}
            </Text>
          </View>
          <Text style={[styles.heroEyebrow, { marginTop: 8, marginBottom: 4 }]}>
            New case or follow-up?
          </Text>
          <Text style={[styles.disclaimer, { textAlign: 'left', paddingTop: 0, marginBottom: 12 }]}>
            A new case prints on the full letterhead. A follow-up attaches to an
            existing case and prints a continuation sheet.
          </Text>

          <Pressable
            onPress={chooseNewCase}
            style={({ pressed }) => [
              styles.newCaseRow,
              pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
            ]}
          >
            <Feather name="plus-circle" size={18} color={c.textOnAccent} />
            <Text style={styles.newCaseText}>START A NEW CASE</Text>
          </Pressable>

          <Text style={[styles.heroEyebrow, { marginTop: 18, marginBottom: 8 }]}>
            Or follow up an open case
          </Text>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {patientCases.map((cs) => (
              <Pressable
                key={cs.id}
                onPress={() => chooseFollowUp(cs.id)}
                style={({ pressed }) => [
                  styles.patientRow,
                  pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.patientRowName}>{cs.case.title}</Text>
                  <Text style={styles.patientRowMeta}>
                    {cs.case.encounter_count} encounter{cs.case.encounter_count === 1 ? '' : 's'}
                    {cs.case.last_encounter_at
                      ? ` · last ${new Date(cs.case.last_encounter_at).toLocaleDateString()}`
                      : ''}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={c.textSubtle} />
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={() => setCaseChooserOpen(false)} style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.6 }]}>
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
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
    marginBottom: 4,
  },
  cornerLogo: { position: 'absolute', right: space.lg, zIndex: 10 },
  inlineBackBtn: {
    position: 'absolute',
    left: 0,
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
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: c.recording,
    ...shadow.sm,
  },
  recPillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  recPillText: {
    fontFamily: fonts.displayBold,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 1.4,
  },

  // ─── HERO ─────────────────────────────────────────
  hero: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    backgroundColor: c.surface,
    borderRadius: radiusXl2,
    borderWidth: 1,
    borderColor: c.border,
    ...shadow.card,
  },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroEyebrow: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  newCaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: c.accent,
    borderRadius: radii.md,
    minHeight: 52,
    paddingVertical: space.md,
    ...shadow.card,
  },
  newCaseText: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    fontSize: font.size.sm,
    letterSpacing: 1,
  },
  paywallCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
    borderRadius: radii.xl,
    padding: space.lg,
    ...shadow.sm,
  },
  paywallTitle: { fontFamily: fonts.displayBold, fontSize: font.size.base, color: c.text, letterSpacing: -0.2 },
  paywallBody: { fontFamily: fonts.display, fontSize: font.size.xs, color: c.textMuted, marginTop: 3, lineHeight: 16 },
  paywallCta: { fontFamily: fonts.displayBold, fontSize: font.size.sm, color: c.accent, letterSpacing: 0.8 },
  trialPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  trialPillText: { fontFamily: fonts.displaySemi, fontSize: font.size.xs, color: c.accent },
  heroDisplay: { alignItems: 'flex-start', alignSelf: 'stretch', paddingHorizontal: 4 },
  heroDisplayLine: {
    fontFamily: fonts.displayBold,
    fontSize: 40,
    lineHeight: 44,
    color: c.text,
    letterSpacing: -1,
  },
  heroDisplaySub: {
    fontFamily: fonts.display,
    fontSize: font.size.md,
    color: c.textMuted,
    lineHeight: 22,
    marginTop: space.sm,
  },
  meterBlock: { width: '100%', marginVertical: space.md },
  micBlock: { marginTop: space.md, marginBottom: space.sm },
  transportRow: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restartBtn: {
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: c.danger,
    alignItems: 'center',
    minWidth: 130,
  },
  restartBtnLabel: {
    fontFamily: fonts.displayBold,
    color: c.danger,
    fontSize: font.size.sm,
    letterSpacing: 1.2,
  },
  confirmBtn: {
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    alignItems: 'center',
    minWidth: 160,
    ...shadow.card,
  },
  confirmBtnLabel: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    fontSize: font.size.sm,
    letterSpacing: 1.2,
  },

  // ─── DOWN SECTION ─────────────────────────────────
  downSection: { gap: space.md },

  // Shared tag pill (yellow)
  tagPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
  },
  tagPillText: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // Header card
  headerCard: {
    backgroundColor: c.surface,
    borderRadius: radiusXl2,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.base,
    ...shadow.card,
  },
  headerCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xxl,
    color: c.text,
    marginTop: 8,
    letterSpacing: -0.6,
  },
  headerSubtitle: {
    fontFamily: fonts.display,
    fontSize: font.size.sm,
    color: c.textMuted,
    marginTop: 6,
    lineHeight: 19,
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
    fontFamily: fonts.displayBold,
    fontSize: 11,
    letterSpacing: 1,
    color: c.text,
  },
  backText: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.base,
    marginLeft: -2,
  },
  patientPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'stretch',
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radii.lg,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    marginTop: space.sm,
    ...shadow.sm,
  },
  patientPillLabel: {
    fontFamily: fonts.displayBold,
    color: c.accent,
    fontSize: font.size.xs - 1,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  patientPillValue: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.md,
    marginTop: 2,
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
    fontFamily: fonts.displayBold,
    color: c.accent,
    fontSize: font.size.xs - 2,
    letterSpacing: 0.8,
  },
  patientPillLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  patientPillLockedText: {
    fontFamily: fonts.displayBold,
    color: c.textSubtle,
    fontSize: font.size.xs - 2,
    letterSpacing: 0.8,
  },
  patientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.base,
    paddingVertical: space.md + 2,
    borderRadius: radii.lg,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: space.sm + 2,
    ...shadow.sm,
  },
  patientRowActive: { borderColor: c.accent, borderWidth: 1.5 },
  patientRowName: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.md,
  },
  patientRowMeta: { fontFamily: fonts.display, color: c.textMuted, fontSize: font.size.sm, marginTop: 3 },
  patientRowActiveDot: { color: c.accent, fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(19, 44, 71, 0.45)', // navy scrim, lighter for cream theme
    justifyContent: 'center',
    padding: space.lg,
  },
  modalSheet: {
    backgroundColor: c.surface,
    borderRadius: radiusXl2,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.md,
    ...shadow.raised,
  },
  chooseTitle: {
    fontFamily: fonts.displayBold,
    color: c.text,
    fontSize: font.size.xxl,
    letterSpacing: -0.6,
    marginTop: 4,
  },
  chooseSubtitle: { fontFamily: fonts.display, color: c.textMuted, fontSize: font.size.sm, lineHeight: 20 },
  chooseBtn: {
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    paddingVertical: space.md + 4,
    paddingHorizontal: space.lg,
    alignItems: 'flex-start',
    gap: 4,
    ...shadow.sm,
  },
  chooseBtnPrimary: { backgroundColor: c.accent, borderColor: c.accent, ...shadow.card },
  chooseBtnLabel: {
    fontFamily: fonts.displayBold,
    color: c.text,
    fontSize: font.size.base,
    letterSpacing: 1.2,
  },
  chooseBtnLabelPrimary: { color: c.textOnAccent },
  chooseBtnHint: { fontFamily: fonts.display, color: c.textMuted, fontSize: font.size.xs },
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
    paddingVertical: space.md,
    ...shadow.sm,
  },
  metaCellLabel: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  metaCellValue: {
    fontFamily: fonts.displaySemi,
    fontSize: font.size.base + 1,
    color: c.text,
    fontVariant: ['tabular-nums'],
    marginTop: 3,
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
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.base,
    ...shadow.card,
  },
  cardHeader: { gap: 6 },
  cardTitle: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xl,
    color: c.text,
    marginTop: 8,
    letterSpacing: -0.4,
  },
  cardDescription: {
    fontFamily: fonts.display,
    fontSize: font.size.sm,
    color: c.textMuted,
    lineHeight: 19,
  },

  // Buttons
  primaryBtn: {
    marginTop: space.xs,
    minHeight: 52,
    justifyContent: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    alignItems: 'center',
    ...shadow.card,
  },
  primaryBtnLabel: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    fontSize: font.size.sm,
    letterSpacing: 1.2,
  },
  secondaryBtn: {
    marginTop: space.sm,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.base,
    borderRadius: radii.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    ...shadow.sm,
  },
  secondaryBtnLabel: {
    fontFamily: fonts.displayBold,
    color: c.text,
    fontSize: font.size.sm,
    letterSpacing: 1,
  },

  resetBtn: { alignSelf: 'center', paddingVertical: space.md, marginTop: space.sm },
  resetLink: {
    fontFamily: fonts.displayBold,
    color: c.accent,
    fontSize: font.size.sm,
    letterSpacing: 1.5,
  },

  // Error
  errorCard: {
    backgroundColor: c.dangerSoft,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.danger,
    padding: space.lg,
    gap: space.sm,
    ...shadow.sm,
  },
  errorText: { fontFamily: fonts.display, color: c.text, fontSize: font.size.sm, lineHeight: 20 },

  disclaimer: {
    fontFamily: fonts.display,
    fontSize: font.size.xs,
    color: c.textDim,
    textAlign: 'center',
    paddingTop: space.lg,
    paddingHorizontal: space.lg,
    lineHeight: 16,
  },
});
