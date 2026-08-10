import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getRecording,
  patchRecordingSoap,
  type RecordingEntry,
} from '@/api/patients';
import { getBillingStatus } from '@/api/billing';
import { downloadRecordingPdf, getRecordingAudioUrl } from '@/api/recordings';
import { useAuth } from '@/auth/AuthContext';
import { AudioPlayer } from '@/components/AudioPlayer';
import { SoapEditor } from '@/components/SoapEditor';
import { StatusBadge } from '@/components/StatusBadge';
import { TranscriptCard } from '@/components/TranscriptCard';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, radiusXl2, shadow, space, type ThemeColors } from '@/theme/tokens';
import type { SoapNote } from '@/types/soap';

export default function RecordingDetailScreen() {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const params = useLocalSearchParams<{ id: string; recId: string }>();
  const patientId = params.id ?? '';
  const recId = params.recId ?? '';
  const router = useRouter();
  const { getIdToken } = useAuth();

  const [entry, setEntry] = useState<RecordingEntry | null>(null);
  const [draftSoap, setDraftSoap] = useState<SoapNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioUrlError, setAudioUrlError] = useState<string | null>(null);
  const [retentionMonths, setRetentionMonths] = useState(6);

  // Archived = older than the plan's guaranteed backup window (never deleted).
  const archived =
    entry != null &&
    new Date(entry.recording.created_at).getTime() <
      Date.now() - retentionMonths * 30 * 24 * 60 * 60 * 1000;

  useEffect(() => {
    void (async () => {
      try {
        const token = await getIdToken();
        const s = await getBillingStatus(token);
        setRetentionMonths(s.retention_months);
      } catch {
        /* default 6 months */
      }
    })();
  }, [getIdToken]);

  const reload = useCallback(async () => {
    if (!recId) return;
    setError(null);
    try {
      const token = await getIdToken();
      const e = await getRecording(token, recId, patientId);
      setEntry(e);
      setDraftSoap(e.recording.soap ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recording');
    }
  }, [getIdToken, recId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  // Lazy-load the signed audio URL once we know the recording exists.
  useEffect(() => {
    if (!entry || audioUrl) return;
    void (async () => {
      setAudioUrlError(null);
      try {
        const token = await getIdToken();
        const url = await getRecordingAudioUrl(token, recId, patientId);
        setAudioUrl(url);
      } catch (e) {
        setAudioUrlError(e instanceof Error ? e.message : 'Audio unavailable');
      }
    })();
  }, [entry, audioUrl, getIdToken, recId, patientId]);

  const dirty =
    draftSoap !== null &&
    entry?.recording.soap !== null &&
    JSON.stringify(draftSoap) !== JSON.stringify(entry?.recording.soap);

  const onSave = async () => {
    if (!draftSoap || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const token = await getIdToken();
      const updated = await patchRecordingSoap(token, recId, patientId, draftSoap);
      setEntry(updated);
      setDraftSoap(updated.recording.soap ?? null);
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const onDownload = async () => {
    if (!recId || pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const token = await getIdToken();
      const uri = await downloadRecordingPdf(token, recId, patientId);
      const can = await Sharing.isAvailableAsync();
      if (can) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
      // PDFs are always re-rendered server-side on demand — no local copy kept.
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'Failed to generate PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() =>
                router.canGoBack()
                  ? router.back()
                  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    router.replace(`/patients/${encodeURIComponent(patientId)}` as any)
              }
              hitSlop={10}
              style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Feather name="chevron-left" size={24} color={c.text} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await reload();
              setRefreshing(false);
            }}
            tintColor={c.accent}
          />
        }
      >
        {loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 32 }} /> : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {entry ? (
          <>
            {/* Encounter summary — the clinical header at a glance */}
            <View style={styles.headerCard}>
              <Text style={styles.headerEyebrow}>Encounter</Text>
              <Text style={styles.headerDate}>
                {new Date(entry.recording.created_at).toLocaleString()}
              </Text>
              <View style={styles.statusRow}>
                <StatusBadge
                  tone={entry.recording.status === 'completed' ? 'success' : 'neutral'}
                  label={entry.recording.status}
                />
                {entry.recording.duration_seconds ? (
                  <>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.headerMeta}>
                      {Math.round(entry.recording.duration_seconds)}s
                    </Text>
                  </>
                ) : null}
              </View>
              {archived ? (
                <Pressable
                  onPress={() => router.push('/payments' as never)}
                  style={({ pressed }) => [styles.archivedBanner, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Archived recording — upgrade to extend backup"
                >
                  <View style={styles.archivedIcon}>
                    <Feather name="archive" size={14} color={c.warning} />
                  </View>
                  <Text style={styles.archivedText}>
                    Archived — older than your {retentionMonths}-month backup window. Still
                    viewable & downloadable. Upgrade to extend guaranteed backup.
                  </Text>
                  <Feather name="chevron-right" size={16} color={c.warning} />
                </Pressable>
              ) : null}
            </View>

            {/* Audio playback */}
            <Text style={styles.sectionEyebrow}>Playback</Text>
            <AudioPlayer
              url={audioUrl}
              fallbackDurationSec={entry.recording.duration_seconds}
              error={audioUrlError}
            />

            {/* Transcript — paired with the audio above for replay context */}
            {entry.recording.transcript ? (
              <>
                <Text style={styles.sectionEyebrow}>Transcript</Text>
                <TranscriptCard text={entry.recording.transcript.text} />
              </>
            ) : null}

            {/* Clinical note — editor, save state, and export */}
            <Text style={styles.sectionEyebrow}>Clinical note</Text>

            {/* Save bar */}
            {entry.recording.soap ? (
              <View style={styles.saveBar}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.saveStatus}>
                    {saving
                      ? 'Saving…'
                      : dirty
                        ? 'Unsaved changes'
                        : savedAt
                          ? 'Saved'
                          : 'Up to date'}
                  </Text>
                  {saveError ? <Text style={styles.errorTextSm}>{saveError}</Text> : null}
                </View>
                <Pressable
                  onPress={() => void onSave()}
                  disabled={!dirty || saving}
                  style={({ pressed }) => [
                    styles.saveBtn,
                    !dirty || saving ? styles.disabled : pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Save clinical note"
                >
                  {saving ? (
                    <ActivityIndicator color={c.textOnAccent} />
                  ) : (
                    <Text style={styles.saveBtnText}>SAVE</Text>
                  )}
                </Pressable>
              </View>
            ) : null}

            {/* PDF actions */}
            <View style={styles.pdfRow}>
              <Pressable
                onPress={() => void onDownload()}
                disabled={pdfBusy}
                style={({ pressed }) => [
                  styles.pdfBtn,
                  pdfBusy ? styles.disabled : pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Download or share PDF"
              >
                {pdfBusy ? (
                  <ActivityIndicator color={c.textOnAccent} />
                ) : (
                  <>
                    <Feather name="share" size={16} color={c.textOnAccent} />
                    <Text style={styles.pdfBtnText}>DOWNLOAD / SHARE PDF</Text>
                  </>
                )}
              </Pressable>
              {pdfError ? <Text style={styles.errorTextSm}>{pdfError}</Text> : null}
            </View>

            {draftSoap && entry.recording.transcript ? (
              <SoapEditor
                soap={draftSoap}
                transcript={entry.recording.transcript.text}
                onChange={setDraftSoap}
                hideTranscript
              />
            ) : (
              <Text style={styles.metaSmall}>SOAP not available for this recording.</Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  scroll: {
    padding: space.lg,
    gap: space.md,
    paddingBottom: 60,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },

  // Shared interaction feedback — every Pressable presses the same way.
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },

  // ─── Section eyebrows ───────────────────────────────────────────
  sectionEyebrow: {
    fontFamily: fonts.displayBold,
    color: c.textMuted,
    fontSize: font.size.xs,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: space.xs,
    marginLeft: 2,
  },

  // ─── Encounter summary card ─────────────────────────────────────
  headerCard: {
    backgroundColor: c.surface,
    borderRadius: radiusXl2,
    padding: space.lg,
    gap: space.sm,
    ...shadow.card,
  },
  headerEyebrow: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.textMuted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  headerDate: {
    fontFamily: fonts.displayBold,
    color: c.text,
    fontSize: font.size.xl,
    letterSpacing: -0.4,
    marginTop: 2,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4 },
  headerMeta: {
    fontFamily: fonts.displayMedium,
    color: c.textMuted,
    fontSize: font.size.sm,
    fontVariant: ['tabular-nums'],
  },
  metaDot: { color: c.textDim, fontSize: font.size.sm },

  // ─── Archived banner ────────────────────────────────────────────
  archivedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
    padding: space.md,
    borderRadius: radii.lg,
    backgroundColor: c.warningSoft,
    ...shadow.sm,
  },
  archivedIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    backgroundColor: c.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archivedText: {
    flex: 1,
    fontFamily: fonts.displayMedium,
    fontSize: font.size.xs,
    color: c.text,
    lineHeight: 16,
  },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  backText: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.base,
    marginLeft: -2,
  },

  // ─── Save bar ───────────────────────────────────────────────────
  saveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: c.surface,
    borderRadius: radii.xl,
    padding: space.md + 2,
    ...shadow.card,
  },
  saveStatus: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.sm,
  },
  saveBtn: {
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    ...shadow.sm,
  },
  saveBtnText: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    letterSpacing: 1,
    fontSize: font.size.xs,
  },

  // ─── PDF export ─────────────────────────────────────────────────
  pdfRow: { gap: 6 },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    ...shadow.card,
  },
  pdfBtnText: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    fontSize: font.size.sm,
    letterSpacing: 1.2,
  },

  metaSmall: { fontFamily: fonts.display, color: c.textSubtle, fontSize: font.size.sm },
  errorBox: {
    backgroundColor: c.dangerSoft,
    borderRadius: radii.lg,
    padding: space.md,
    ...shadow.sm,
  },
  errorText: { fontFamily: fonts.display, color: c.text, fontSize: font.size.sm },
  errorTextSm: { fontFamily: fonts.displayMedium, color: c.danger, fontSize: font.size.xs },
});
