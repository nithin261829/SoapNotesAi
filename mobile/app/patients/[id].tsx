import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

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
            <View style={styles.heroTopRow}>
              <View style={styles.tagPill}>
                <Text style={styles.tagPillText}>Patient</Text>
              </View>
              <Pressable
                onPress={() => setEditOpen(true)}
                style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Edit patient"
              >
                <Feather name="edit-2" size={13} color={c.accent} />
                <Text style={styles.editBtnText}>EDIT</Text>
              </Pressable>
            </View>
            <View style={styles.heroIdentity}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(patient.patient.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.patientName} numberOfLines={2}>
                  {patient.patient.name}
                </Text>
                <View style={styles.metaRow}>
                  {patient.patient.age_at_record != null ? (
                    <Text style={styles.meta}>{patient.patient.age_at_record} y/o</Text>
                  ) : null}
                  {patient.patient.sex ? (
                    <Text style={styles.meta}>{patient.patient.sex}</Text>
                  ) : null}
                </View>
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
              style={({ pressed }) => [styles.primaryCta, { opacity: pressed ? 0.85 : 1 }]}
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
                    style={({ pressed }) => [styles.recordingCard, { opacity: pressed ? 0.85 : 1 }]}
                  >
                    <View style={styles.recordingLeft}>
                      <Text style={styles.recordingTime}>
                        {new Date(r.recording.created_at).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.recordingChief} numberOfLines={2}>
                        {chief ?? 'No chief complaint recorded'}
                      </Text>
                      {dx.length > 0 ? (
                        <Text style={styles.recordingDx} numberOfLines={1}>
                          {dx.join(' · ')}
                        </Text>
                      ) : null}
                      <View style={styles.recordingMeta}>
                        {r.recording.duration_seconds ? (
                          <Text style={styles.metaSmall}>
                            {fmtDurationSec(r.recording.duration_seconds)}
                          </Text>
                        ) : null}
                        {r.recording.estimated_cost_usd != null ? (
                          <>
                            <Text style={[styles.metaSmall, styles.statusDot]}>•</Text>
                            <Text style={styles.metaSmall}>
                              {fmtCost(r.recording.estimated_cost_usd)}
                            </Text>
                          </>
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
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
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

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form to current values whenever the modal opens.
  useEffect(() => {
    if (open && entry) {
      setName(entry.patient.name);
      setAge(entry.patient.age_at_record != null ? String(entry.patient.age_at_record) : '');
      setSex(entry.patient.sex);
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
      const params: { name?: string; age_at_record?: number; sex?: PatientSex } = {};
      if (name.trim() !== entry.patient.name) params.name = name.trim();
      const ageNum = age ? Number.parseInt(age, 10) : null;
      if (ageNum !== entry.patient.age_at_record && ageNum !== null && !Number.isNaN(ageNum)) {
        params.age_at_record = ageNum;
      }
      if (sex !== entry.patient.sex && sex !== null) params.sex = sex;
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
                      style={[styles.sexChip, selected && styles.sexChipSelected]}
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

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            onPress={() => void onSubmit()}
            disabled={saving || name.trim().length === 0}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: saving || name.trim().length === 0 ? 0.45 : pressed ? 0.85 : 1 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={c.textOnAccent} />
            ) : (
              <Text style={styles.primaryBtnLabel}>SAVE CHANGES →</Text>
            )}
          </Pressable>

          <Pressable onPress={onClose} style={styles.cancelBtn}>
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
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  backText: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.base,
    marginLeft: -2,
  },
  hero: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.md,
  },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroIdentity: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 4 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: c.accent,
    fontSize: font.size.base,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: space.sm,
  },
  statCell: {
    flex: 1,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 10,
  },
  statLabel: {
    fontSize: font.size.xs - 1,
    color: c.accent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: font.size.lg,
    color: c.text,
    fontWeight: font.weight.semibold as '600',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.accent,
    borderRadius: radii.md,
    paddingVertical: space.md + 2,
    marginTop: 4,
  },
  primaryCtaText: {
    color: c.textOnAccent,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
  },
  dateGroupHeader: {
    color: c.textSubtle,
    fontSize: font.size.xs - 1,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: space.sm,
  },
  recordingLeft: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingTime: {
    color: c.text,
    fontSize: font.size.base,
    fontWeight: font.weight.semibold as '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  recordingDx: {
    color: c.accent,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.5,
  },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
  },
  editBtnText: {
    color: c.accent,
    fontSize: font.size.xs - 1,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
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
  patientName: {
    fontFamily: fonts.serifBoldItalic,
    color: c.text,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.8,
    marginTop: 4,
  },
  metaRow: { flexDirection: 'row', gap: space.md },
  meta: { color: c.textMuted, fontSize: font.size.sm },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: space.sm,
    marginBottom: 4,
  },
  sectionTitle: {
    color: c.textSubtle,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionCount: {
    color: c.textDim,
    fontSize: font.size.xs,
    fontVariant: ['tabular-nums'],
  },

  recordingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.md,
  },
  recordingDate: {
    color: c.text,
    fontSize: font.size.base,
    fontWeight: font.weight.semibold as '600',
  },
  recordingChief: { color: c.textMuted, fontSize: font.size.sm, lineHeight: 19 },
  recordingMeta: { flexDirection: 'row', gap: 6, marginTop: 2 },
  metaSmall: { color: c.textSubtle, fontSize: font.size.xs },
  statusDot: { color: c.textDim },
  chevron: { color: c.textSubtle, fontSize: 26, fontWeight: '300' },

  emptyCard: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.xl,
    gap: space.sm,
    alignItems: 'flex-start',
  },
  emptyTitle: { color: c.text, fontSize: font.size.lg, fontWeight: font.weight.bold as '700' },
  emptyBody: { color: c.textMuted, fontSize: font.size.sm, lineHeight: 19 },

  errorBox: {
    backgroundColor: c.dangerSoft,
    borderWidth: 1,
    borderColor: c.danger,
    borderRadius: radii.md,
    padding: space.md,
  },
  errorText: { color: c.text, fontSize: font.size.sm },
});
