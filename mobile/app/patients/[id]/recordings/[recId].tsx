import { Feather } from '@expo/vector-icons';
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
import { downloadRecordingPdf, getRecordingAudioUrl } from '@/api/recordings';
import { useAuth } from '@/auth/AuthContext';
import { AudioPlayer } from '@/components/AudioPlayer';
import { SoapEditor } from '@/components/SoapEditor';
import { StatusBadge } from '@/components/StatusBadge';
import { TranscriptCard } from '@/components/TranscriptCard';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';
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
            <View style={styles.headerCard}>
              <View style={styles.tagPill}>
                <Text style={styles.tagPillText}>Encounter</Text>
              </View>
              <Text style={styles.headerDate}>
                {new Date(entry.recording.created_at).toLocaleString()}
              </Text>
              <View style={styles.statusRow}>
                <StatusBadge
                  tone={entry.recording.status === 'completed' ? 'success' : 'neutral'}
                  label={entry.recording.status}
                />
                {entry.recording.duration_seconds ? (
                  <Text style={styles.headerMeta}>
                    {Math.round(entry.recording.duration_seconds)}s
                  </Text>
                ) : null}
                {entry.recording.estimated_cost_usd != null ? (
                  <Text style={styles.headerMeta}>
                    {formatCost(entry.recording.estimated_cost_usd)}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Audio playback */}
            <AudioPlayer
              url={audioUrl}
              fallbackDurationSec={entry.recording.duration_seconds}
              error={audioUrlError}
            />

            {/* Transcript — paired with the audio above for replay context */}
            {entry.recording.transcript ? (
              <TranscriptCard text={entry.recording.transcript.text} />
            ) : null}

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
                    { opacity: !dirty || saving ? 0.45 : pressed ? 0.85 : 1 },
                  ]}
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
                  { opacity: pdfBusy ? 0.6 : pressed ? 0.85 : 1 },
                ]}
              >
                {pdfBusy ? (
                  <ActivityIndicator color={c.textOnAccent} />
                ) : (
                  <Text style={styles.pdfBtnText}>DOWNLOAD / SHARE PDF →</Text>
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

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: 60 },

  headerCard: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.sm,
  },
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
  headerDate: {
    color: c.text,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold as '700',
    letterSpacing: -0.4,
    marginTop: 4,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 4 },
  headerMeta: { color: c.textMuted, fontSize: font.size.sm },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  backText: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.base,
    marginLeft: -2,
  },
  saveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: c.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.md,
  },
  saveStatus: { color: c.text, fontSize: font.size.sm, fontWeight: font.weight.semibold as '600' },
  saveBtn: {
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: c.accent,
  },
  saveBtnText: {
    color: c.textOnAccent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1,
    fontSize: font.size.xs,
  },

  pdfRow: { gap: 6 },
  pdfBtn: {
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent,
    alignItems: 'center',
  },
  pdfBtnText: {
    color: c.textOnAccent,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
  },

  metaSmall: { color: c.textSubtle, fontSize: font.size.sm },
  errorBox: {
    backgroundColor: c.dangerSoft,
    borderWidth: 1,
    borderColor: c.danger,
    borderRadius: radii.md,
    padding: space.md,
  },
  errorText: { color: c.text, fontSize: font.size.sm },
  errorTextSm: { color: c.danger, fontSize: font.size.xs },
});
