import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  deleteDocument,
  getDocumentUrl,
  listDocuments,
  uploadDocument,
  type DocumentEntry,
} from '@/api/documents';
import {
  createFollowup,
  listFollowups,
  patchFollowup,
  type FollowupEntry,
} from '@/api/followups';
import {
  getPatient,
  listRecordings,
  patchPatient,
  type PatientEntry,
  type PatientSex,
  type RecordingEntry,
} from '@/api/patients';
import { useAuth } from '@/auth/AuthContext';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, radiusXl2, shadow, space, type ThemeColors } from '@/theme/tokens';

export default function PatientDetailScreen() {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getIdToken } = useAuth();
  const patientId = params.id ?? '';
  const [patient, setPatient] = useState<PatientEntry | null>(null);
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!patientId) return;
    setError(null);
    try {
      const token = await getIdToken();
      const [p, recs] = await Promise.all([
        getPatient(token, patientId),
        listRecordings(token, patientId),
      ]);
      setPatient(p);
      setRecordings(recs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patient');
    }
  }, [getIdToken, patientId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

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
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/patients'))}
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

        {patient ? (
          <View style={styles.hero}>
            <Pressable
              onPress={() => setEditOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Edit patient"
            >
              <Feather name="edit-2" size={15} color={c.accent} />
            </Pressable>

            <View style={styles.heroIdentity}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(patient.patient.name)}</Text>
              </View>
              <Text style={styles.heroEyebrow}>Patient</Text>
              <Text style={styles.patientName} numberOfLines={2}>
                {patient.patient.name}
              </Text>
              <View style={styles.metaRow}>
                {patient.patient.age_at_record != null ? (
                  <Text style={styles.meta}>{patient.patient.age_at_record} y/o</Text>
                ) : null}
                {patient.patient.age_at_record != null && patient.patient.sex ? (
                  <Text style={styles.metaDot}>·</Text>
                ) : null}
                {patient.patient.sex ? (
                  <Text style={styles.meta}>{patient.patient.sex}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.statsRow}>
              <StatCell label="Encounters" value={String(recordings.length)} />
              <StatCell label="Total time" value={fmtTotalSeconds(totalSecs(recordings))} />
              <StatCell label="Last visit" value={lastVisitShort(patient.patient.last_encounter_at)} />
            </View>

            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/record',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  params: { patient_id: patientId } as any,
                })
              }
              style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Record new encounter for this patient"
            >
              <Feather name="mic" size={16} color={c.textOnAccent} />
              <Text style={styles.primaryCtaText}>RECORD NEW ENCOUNTER →</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {patient ? (
          <FollowupCard patientId={patientId} phone={patient.patient.phone} />
        ) : null}

        {patient ? <DocumentsCard patientId={patientId} /> : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Encounters</Text>
          <Text style={styles.sectionCount}>{recordings.length}</Text>
        </View>

        {!loading && recordings.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="mic-off" size={20} color={c.textSubtle} />
            <Text style={styles.emptyTitle}>No encounters yet</Text>
            <Text style={styles.emptyBody}>
              Tap RECORD NEW ENCOUNTER above to capture your first visit with this patient.
            </Text>
          </View>
        ) : null}

        {groupRecordingsByDate(recordings).map(({ label, items }) =>
          items.length === 0 ? null : (
            <View key={label} style={{ gap: space.sm }}>
              <Text style={styles.dateGroupHeader}>{label}</Text>
              {items.map((r) => {
                const chief = r.recording.soap?.subjective?.chief_complaint ?? null;
                const dx = r.recording.soap?.assessment?.diagnoses ?? [];
                return (
                  <Pressable
                    key={r.id}
                    onPress={() =>
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      router.push(`/patients/${patientId}/recordings/${r.id}` as any)
                    }
                    style={({ pressed }) => [styles.recordingCard, pressed && styles.pressed]}
                  >
                    <View style={styles.recordingLeft}>
                      <Text style={styles.recordingTime}>
                        {new Date(r.recording.created_at).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={styles.recordingChief} numberOfLines={2}>
                        {chief ?? 'No chief complaint recorded'}
                      </Text>
                      {dx.length > 0 ? (
                        <View style={styles.dxRow}>
                          {dx.map((d, i) => (
                            <View key={`${r.id}-dx-${i}`} style={styles.dxChip}>
                              <Text style={styles.dxChipText} numberOfLines={1}>
                                {d}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <View style={styles.recordingMeta}>
                        {r.recording.duration_seconds ? (
                          <Text style={styles.metaSmall}>
                            {fmtDurationSec(r.recording.duration_seconds)}
                          </Text>
                        ) : null}
                        <Text style={[styles.metaSmall, styles.statusDot]}>•</Text>
                        <Text style={styles.metaSmall}>{r.recording.status}</Text>
                      </View>
                    </View>
                    <Feather name="chevron-right" size={20} color={c.textSubtle} />
                  </Pressable>
                );
              })}
            </View>
          ),
        )}
      </ScrollView>

      <EditPatientModal
        open={editOpen}
        entry={patient}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setPatient(updated);
          setEditOpen(false);
        }}
      />
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || (parts[0]?.length ?? 0) === 0) return '?';
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function totalSecs(items: RecordingEntry[]): number {
  return items.reduce((sum, e) => sum + (e.recording.duration_seconds ?? 0), 0);
}

function fmtTotalSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtDurationSec(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function lastVisitShort(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const diff = now.getTime() - d.getTime();
  if (diff < day && now.getDate() === d.getDate()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (diff < 7 * day) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function groupRecordingsByDate(
  items: RecordingEntry[],
): { label: string; items: RecordingEntry[] }[] {
  if (items.length === 0) return [];
  const byKey = new Map<string, { label: string; items: RecordingEntry[]; sortKey: number }>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMs = today.getTime();
  const yesterdayMs = todayMs - 24 * 60 * 60 * 1000;
  const weekAgoMs = todayMs - 6 * 24 * 60 * 60 * 1000;

  for (const r of items) {
    const t = new Date(r.recording.created_at).getTime();
    let key: string;
    let label: string;
    if (t >= todayMs) {
      key = 'today';
      label = 'TODAY';
    } else if (t >= yesterdayMs) {
      key = 'yesterday';
      label = 'YESTERDAY';
    } else if (t >= weekAgoMs) {
      key = 'week';
      label = 'EARLIER THIS WEEK';
    } else {
      const d = new Date(t);
      key = `${d.getFullYear()}-${d.getMonth()}`;
      label = d.toLocaleDateString([], { month: 'long', year: 'numeric' }).toUpperCase();
    }
    if (!byKey.has(key)) byKey.set(key, { label, items: [], sortKey: -t });
    byKey.get(key)!.items.push(r);
  }
  return [...byKey.values()].sort((a, b) => a.sortKey - b.sortKey);
}

function FollowupCard({ patientId, phone }: { patientId: string; phone: string | null }) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const { getIdToken } = useAuth();
  const [items, setItems] = useState<FollowupEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getIdToken();
      setItems(await listFollowups(token, patientId));
    } catch {
      /* follow-ups are non-critical; keep the card quiet on load errors */
    }
  }, [getIdToken, patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const schedule = async (days: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const due = new Date();
      due.setDate(due.getDate() + days);
      // Format in LOCAL time — toISOString() is UTC and stores yesterday's
      // date for IST users between midnight and 05:29.
      const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(
        due.getDate(),
      ).padStart(2, '0')}`;
      const token = await getIdToken();
      const entry = await createFollowup(token, {
        patient_id: patientId,
        due_date: dueDate,
      });
      setItems((prev) => [...prev, entry].sort((a, b) => a.followup.due_date.localeCompare(b.followup.due_date)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to schedule follow-up');
    } finally {
      setBusy(false);
    }
  };

  const markDone = async (id: string) => {
    try {
      const token = await getIdToken();
      await patchFollowup(token, id, { status: 'done' });
      setItems((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update follow-up');
    }
  };

  return (
    <View style={styles.followupCard}>
      <View style={styles.followupHeader}>
        <Text style={styles.sectionTitle}>Follow-ups</Text>
        {phone ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${phone}`)}
            style={({ pressed }) => [styles.callBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Call patient"
          >
            <Feather name="phone" size={13} color={c.accent} />
            <Text style={styles.callBtnText}>CALL</Text>
          </Pressable>
        ) : null}
      </View>

      {items.length === 0 ? (
        <Text style={styles.followupEmpty}>
          No follow-up scheduled. Reminders notify your clinic the day before and day of
          (Standard/Premium plans).
        </Text>
      ) : (
        items.map((f) => (
          <View key={f.id} style={styles.followupRow}>
            <Feather name="calendar" size={15} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.followupDate}>
                {new Date(`${f.followup.due_date}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
              {f.followup.note ? <Text style={styles.followupNote}>{f.followup.note}</Text> : null}
            </View>
            <Pressable
              onPress={() => void markDone(f.id)}
              style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Mark follow-up done"
            >
              <Feather name="check" size={14} color={c.textMuted} />
            </Pressable>
          </View>
        ))
      )}

      <View style={styles.followupPresets}>
        {[
          { label: '+1 WEEK', days: 7 },
          { label: '+2 WEEKS', days: 14 },
          { label: '+1 MONTH', days: 30 },
        ].map((p) => (
          <Pressable
            key={p.days}
            onPress={() => void schedule(p.days)}
            disabled={busy}
            style={({ pressed }) => [
              styles.presetChip,
              busy && styles.disabled,
              !busy && pressed && styles.pressed,
            ]}
          >
            <Text style={styles.presetChipText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MB — mirrors the backend cap

function documentMimeType(name: string | null, picked: string | null): string | null {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
  if (picked && allowed.includes(picked)) return picked;
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  return null;
}

function DocumentsCard({ patientId }: { patientId: string }) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const { getIdToken } = useAuth();
  const [items, setItems] = useState<DocumentEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getIdToken();
      setItems(await listDocuments(token, patientId));
    } catch {
      /* documents are non-critical; keep the card quiet on load errors */
    }
  }, [getIdToken, patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doUpload = async (
    asset: { uri: string; name: string },
    mimeType: string,
    label?: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      await uploadDocument(token, {
        patientId,
        fileUri: asset.uri,
        mimeType,
        filename: asset.name,
        label,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload document');
    } finally {
      setBusy(false);
    }
  };

  const pickAndUpload = async () => {
    if (busy) return;
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    if (asset.size != null && asset.size > MAX_DOCUMENT_BYTES) {
      setError('File is too large — the limit is 20 MB.');
      return;
    }
    const mimeType = documentMimeType(asset.name, asset.mimeType ?? null);
    if (!mimeType) {
      setError('Only PDF, JPEG, and PNG files are supported.');
      return;
    }
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Add a label?',
        'e.g. "Blood report Mar 2026" — optional.',
        [
          { text: 'Skip', onPress: () => void doUpload(asset, mimeType) },
          {
            text: 'Attach',
            onPress: (text?: string) => void doUpload(asset, mimeType, text?.trim() || undefined),
          },
        ],
        'plain-text',
      );
    } else {
      await doUpload(asset, mimeType);
    }
  };

  const openDocument = async (entry: DocumentEntry) => {
    setError(null);
    try {
      const token = await getIdToken();
      const { url } = await getDocumentUrl(token, patientId, entry.id);
      await Linking.openURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open document');
    }
  };

  const confirmDelete = (entry: DocumentEntry) => {
    Alert.alert(
      'Delete document',
      `Remove "${entry.document.label ?? entry.document.filename}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setError(null);
              try {
                const token = await getIdToken();
                await deleteDocument(token, patientId, entry.id);
                setItems((prev) => prev.filter((d) => d.id !== entry.id));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to delete document');
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.followupCard}>
      <View style={styles.followupHeader}>
        <Text style={styles.sectionTitle}>Documents</Text>
        {items.length > 0 ? <Text style={styles.sectionCount}>{items.length}</Text> : null}
      </View>

      {items.length === 0 ? (
        <Text style={styles.followupEmpty}>
          No documents yet. Attach lab reports, scans, or past records for this patient.
        </Text>
      ) : (
        items.map((d) => (
          <View key={d.id} style={styles.followupRow}>
            <Feather
              name={d.document.content_type === 'application/pdf' ? 'file-text' : 'image'}
              size={15}
              color={c.accent}
            />
            <Pressable
              onPress={() => void openDocument(d)}
              style={({ pressed }) => [{ flex: 1 }, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${d.document.label ?? d.document.filename}`}
            >
              <Text style={styles.documentName} numberOfLines={1}>
                {d.document.label ?? d.document.filename}
              </Text>
              <Text style={styles.documentMeta}>
                {new Date(d.document.created_at).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => confirmDelete(d)}
              style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Delete document"
            >
              <Feather name="trash-2" size={14} color={c.textMuted} />
            </Pressable>
          </View>
        ))
      )}

      <Pressable
        onPress={() => void pickAndUpload()}
        disabled={busy}
        style={({ pressed }) => [
          styles.attachBtn,
          busy && styles.disabled,
          !busy && pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Attach a document"
      >
        {busy ? (
          <ActivityIndicator size="small" color={c.accent} />
        ) : (
          <>
            <Feather name="paperclip" size={13} color={c.accent} />
            <Text style={styles.attachBtnText}>ATTACH DOCUMENT</Text>
          </>
        )}
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function EditPatientModal({
  open,
  entry,
  onClose,
  onSaved,
}: {
  open: boolean;
  entry: PatientEntry | null;
  onClose: () => void;
  onSaved: (entry: PatientEntry) => void;
}) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const { getIdToken } = useAuth();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<PatientSex | null>(null);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form to current values whenever the modal opens.
  useEffect(() => {
    if (open && entry) {
      setName(entry.patient.name);
      setAge(entry.patient.age_at_record != null ? String(entry.patient.age_at_record) : '');
      setSex(entry.patient.sex);
      setPhone(entry.patient.phone ?? '');
      setError(null);
      setSaving(false);
    }
  }, [open, entry]);

  const onSubmit = async () => {
    if (!entry || saving || name.trim().length === 0) return;
    setError(null);
    setSaving(true);
    try {
      const token = await getIdToken();
      const params: { name?: string; age_at_record?: number; sex?: PatientSex; phone?: string } =
        {};
      if (name.trim() !== entry.patient.name) params.name = name.trim();
      const ageNum = age ? Number.parseInt(age, 10) : null;
      if (ageNum !== entry.patient.age_at_record && ageNum !== null && !Number.isNaN(ageNum)) {
        params.age_at_record = ageNum;
      }
      if (sex !== entry.patient.sex && sex !== null) params.sex = sex;
      if (phone.trim() !== (entry.patient.phone ?? '')) params.phone = phone.trim();
      const updated = await patchPatient(token, entry.id, params);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: c.bg }}
      >
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <View style={styles.tagPill}>
            <Text style={styles.tagPillText}>Edit patient</Text>
          </View>
          <Text style={styles.modalTitle}>Fix demographics</Text>

          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Patient name"
              placeholderTextColor={c.textDim}
              autoCapitalize="words"
            />
          </View>

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.label}>Age</Text>
              <TextInput
                style={styles.input}
                value={age}
                onChangeText={setAge}
                placeholder="—"
                keyboardType="number-pad"
                placeholderTextColor={c.textDim}
              />
            </View>
            <View style={{ flex: 2, gap: 6 }}>
              <Text style={styles.label}>Sex</Text>
              <View style={styles.sexRow}>
                {(['male', 'female', 'other', 'unknown'] as PatientSex[]).map((opt) => {
                  const selected = sex === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setSex(selected ? null : opt)}
                      style={({ pressed }) => [
                        styles.sexChip,
                        selected && styles.sexChipSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.sexChipText, selected && styles.sexChipTextSelected]}>
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Phone (for follow-up reminders)</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 …"
              keyboardType="phone-pad"
              placeholderTextColor={c.textDim}
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            onPress={() => void onSubmit()}
            disabled={saving || name.trim().length === 0}
            style={({ pressed }) => [
              styles.primaryBtn,
              (saving || name.trim().length === 0) && styles.disabled,
              !(saving || name.trim().length === 0) && pressed && styles.pressed,
            ]}
          >
            {saving ? (
              <ActivityIndicator color={c.textOnAccent} />
            ) : (
              <Text style={styles.primaryBtnLabel}>SAVE CHANGES →</Text>
            )}
          </Pressable>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
          >
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: 60 },

  // Shared interaction feedback — every Pressable presses the same way.
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  backText: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.base,
    marginLeft: -2,
  },

  // ─── Hero — premium profile header ──────────────────────────────
  hero: {
    backgroundColor: c.surface,
    borderRadius: radiusXl2,
    padding: space.xl,
    paddingTop: space.xl + space.xs,
    gap: space.md,
    alignItems: 'center',
    ...shadow.card,
  },
  editBtn: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIdentity: { alignItems: 'center', gap: 3 },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoftStrong,
    borderWidth: 1.5,
    borderColor: c.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  avatarText: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xxl,
    color: c.accent,
    letterSpacing: -0.5,
  },
  heroEyebrow: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.textMuted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  patientName: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xxl,
    lineHeight: font.size.xxl + 6,
    color: c.text,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  meta: { fontFamily: fonts.displayMedium, color: c.textMuted, fontSize: font.size.sm, textTransform: 'capitalize' },
  metaDot: { color: c.textDim, fontSize: font.size.sm },

  statsRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: space.sm,
    marginTop: space.sm,
  },
  statCell: {
    flex: 1,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    paddingHorizontal: space.xs,
    paddingVertical: space.md,
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    fontFamily: fonts.displayExtra,
    fontSize: font.size.xl,
    color: c.text,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontFamily: fonts.displaySemi,
    fontSize: font.size.xs - 1,
    color: c.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 8,
    backgroundColor: c.accent,
    borderRadius: radii.lg,
    paddingVertical: space.md + 3,
    marginTop: space.xs,
    ...shadow.sm,
  },
  primaryCtaText: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    fontSize: font.size.sm,
    letterSpacing: 1.2,
  },

  // ─── Encounters list ────────────────────────────────────────────
  dateGroupHeader: {
    fontFamily: fonts.displayBold,
    color: c.textSubtle,
    fontSize: font.size.xs - 1,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: space.sm,
    marginLeft: 2,
  },
  recordingLeft: {
    width: 52,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  recordingTime: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.base,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  dxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  dxChip: {
    maxWidth: '100%',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
  },
  dxChipText: {
    fontFamily: fonts.displayBold,
    color: c.accent,
    fontSize: font.size.xs,
    letterSpacing: 0.2,
  },
  modalContent: {
    padding: space.lg,
    paddingTop: space.xl,
    gap: space.md,
    backgroundColor: c.bg,
    flexGrow: 1,
  },
  modalTitle: {
    color: c.text,
    fontSize: font.size.xxl,
    fontWeight: font.weight.bold as '700',
    letterSpacing: -0.6,
  },
  label: {
    fontSize: font.size.xs,
    color: c.textMuted,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: space.md,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: c.text,
    fontSize: font.size.base,
  },
  sexRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sexChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceElevated,
  },
  sexChipSelected: { backgroundColor: c.accent, borderColor: c.accent },
  sexChipText: {
    color: c.textMuted,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sexChipTextSelected: { color: c.textOnAccent },
  primaryBtn: {
    marginTop: space.sm,
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
  cancelBtn: { alignSelf: 'center', paddingVertical: space.md },
  cancelLink: {
    color: c.textMuted,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.5,
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
  // ─── Section headers ────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: space.sm,
    marginBottom: 2,
    marginLeft: 2,
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    color: c.textMuted,
    fontSize: font.size.xs,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionCount: {
    fontFamily: fonts.display,
    color: c.textDim,
    fontSize: font.size.xs,
    fontVariant: ['tabular-nums'],
  },

  // ─── Follow-ups + Documents sub-cards ───────────────────────────
  followupCard: {
    backgroundColor: c.surface,
    borderRadius: radii.xl,
    padding: space.lg,
    gap: space.sm,
    ...shadow.card,
  },
  followupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.accentDim,
    backgroundColor: c.accentSoft,
  },
  callBtnText: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.accent,
    letterSpacing: 0.8,
  },
  followupEmpty: {
    fontFamily: fonts.display,
    fontSize: font.size.sm,
    color: c.textMuted,
    lineHeight: 19,
  },
  followupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 8,
  },
  followupDate: {
    fontFamily: fonts.displaySemi,
    fontSize: font.size.sm,
    color: c.text,
  },
  followupNote: {
    fontFamily: fonts.display,
    fontSize: font.size.xs,
    color: c.textMuted,
    marginTop: 1,
  },
  doneBtn: {
    width: 30,
    height: 30,
    borderRadius: radii.md,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followupPresets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceElevated,
  },
  presetChipText: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.textMuted,
    letterSpacing: 0.6,
  },

  documentName: {
    fontFamily: fonts.displaySemi,
    fontSize: font.size.sm,
    color: c.text,
  },
  documentMeta: {
    fontFamily: fonts.display,
    fontSize: font.size.xs,
    color: c.textMuted,
    marginTop: 1,
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: space.xs,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.accentDim,
    backgroundColor: c.accentSoft,
  },
  attachBtnText: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.accent,
    letterSpacing: 0.8,
  },

  // ─── Encounter rows ─────────────────────────────────────────────
  recordingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: space.md + 2,
    gap: space.sm,
    ...shadow.sm,
  },
  recordingChief: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.sm,
    lineHeight: 19,
  },
  recordingMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  metaSmall: { fontFamily: fonts.display, color: c.textSubtle, fontSize: font.size.xs, textTransform: 'capitalize' },
  statusDot: { color: c.textDim },

  emptyCard: {
    backgroundColor: c.surface,
    borderRadius: radii.xl,
    padding: space.xl,
    gap: space.sm,
    alignItems: 'flex-start',
    ...shadow.card,
  },
  emptyTitle: { fontFamily: fonts.displayBold, color: c.text, fontSize: font.size.lg },
  emptyBody: { fontFamily: fonts.display, color: c.textMuted, fontSize: font.size.sm, lineHeight: 19 },

  errorBox: {
    backgroundColor: c.dangerSoft,
    borderWidth: 1,
    borderColor: c.danger,
    borderRadius: radii.md,
    padding: space.md,
  },
  errorText: { fontFamily: fonts.display, color: c.text, fontSize: font.size.sm },
});
