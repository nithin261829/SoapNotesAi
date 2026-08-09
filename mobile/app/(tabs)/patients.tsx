import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

import { createPatient, listPatients, type PatientEntry, type PatientSex } from '@/api/patients';
import { useAuth } from '@/auth/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

type Sort = 'recent' | 'name' | 'newest';

const SORT_LABELS: Record<Sort, string> = {
  recent: 'Last visit',
  name: 'Name',
  newest: 'Newest',
};

export default function PatientsScreen() {
  const { getIdToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const [patients, setPatients] = useState<PatientEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const reload = useCallback(async () => {
    setError(null);
    try {
      const token = await getIdToken();
      const items = await listPatients(token);
      setPatients(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patients');
    }
  }, [getIdToken]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  // Filter + sort once per render.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = patients;
    if (q) arr = arr.filter((p) => p.patient.name.toLowerCase().includes(q));
    const copy = [...arr];
    if (sort === 'recent') {
      copy.sort((a, b) => stamp(b.patient.last_encounter_at) - stamp(a.patient.last_encounter_at));
    } else if (sort === 'name') {
      copy.sort((a, b) => a.patient.name.localeCompare(b.patient.name));
    } else if (sort === 'newest') {
      copy.sort((a, b) => stamp(b.patient.created_at) - stamp(a.patient.created_at));
    }
    return copy;
  }, [patients, query, sort]);

  // Group by last-seen bucket — only when sort === 'recent'.
  const groups = useMemo(() => groupByLastSeen(filtered, sort), [filtered, sort]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8 }]}
        keyboardShouldPersistTaps="handled"
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
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Patients</Text>
          <BrandLogo height={26} />
        </View>

        {/* Search + sort */}
        <View style={styles.searchRow}>
          <Feather name="search" size={16} color={c.textSubtle} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search patients…"
            placeholderTextColor={c.textDim}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Feather name="x" size={16} color={c.textSubtle} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>SORT</Text>
          {(Object.keys(SORT_LABELS) as Sort[]).map((s) => {
            const active = sort === s;
            return (
              <Pressable
                key={s}
                onPress={() => setSort(s)}
                style={[styles.sortChip, active && styles.sortChipActive]}
              >
                <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                  {SORT_LABELS[s]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} /> : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {!loading && patients.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.tagPill}>
              <Text style={styles.tagPillText}>Empty</Text>
            </View>
            <Text style={styles.emptyTitle}>No patients yet</Text>
            <Text style={styles.emptyBody}>
              Add a patient here, or just dictate from the Record tab — the AI will create one
              from the audio.
            </Text>
          </View>
        ) : null}
        {!loading && patients.length > 0 && filtered.length === 0 ? (
          <Text style={[styles.emptyBody, { marginTop: 12 }]}>No patients match “{query}”.</Text>
        ) : null}

        {groups.map(({ label, entries }) =>
          entries.length === 0 ? null : (
            <View key={label} style={{ gap: space.sm }}>
              {label ? <Text style={styles.groupHeader}>{label}</Text> : null}
              {entries.map((p) => (
                <PatientCard
                  key={p.id}
                  entry={p}
                  onPress={() =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    router.push(`/patients/${encodeURIComponent(p.id)}` as any)
                  }
                />
              ))}
            </View>
          ),
        )}
      </ScrollView>

      <Pressable
        onPress={() => setAddOpen(true)}
        style={({ pressed }) => [styles.fab, { opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Add patient"
      >
        <Feather name="plus" size={16} color={c.textOnAccent} />
        <Text style={styles.fabText}>ADD PATIENT</Text>
      </Pressable>

      <AddPatientModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(entry) => {
          setPatients((cur) => [entry, ...cur]);
          setAddOpen(false);
        }}
      />
    </View>
  );
}

function PatientCard({ entry, onPress }: { entry: PatientEntry; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const c = useThemeColors();
  const { patient } = entry;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.patientCard, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.patientAvatar}>
        <Text style={styles.patientAvatarText}>{initials(patient.name)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.patientName} numberOfLines={1}>
          {patient.name}
        </Text>
        <Text style={styles.patientMeta}>
          {patient.age_at_record != null ? `${patient.age_at_record} y/o` : '—'}
          {patient.sex ? ` · ${patient.sex}` : ''}
        </Text>
      </View>
      <View style={styles.patientRight}>
        <View style={styles.countChip}>
          <Feather name="mic" size={11} color={c.accent} />
          <Text style={styles.countChipText}>{patient.recording_count}</Text>
        </View>
        <Text style={styles.lastEnc}>{lastSeenLabel(patient.last_encounter_at)}</Text>
      </View>
    </Pressable>
  );
}

function AddPatientModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (entry: PatientEntry) => void;
}) {
  const { getIdToken } = useAuth();
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<PatientSex | null>(null);
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setAge('');
    setSex(null);
    setPhone('');
    setError(null);
    setSubmitting(false);
  };

  const onSubmit = async () => {
    if (submitting || name.trim().length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const token = await getIdToken();
      const entry = await createPatient(token, {
        name: name.trim(),
        age_at_record: age ? Number.parseInt(age, 10) : undefined,
        sex: sex ?? undefined,
        phone: phone.trim() || undefined,
      });
      onCreated(entry);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create patient');
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        reset();
        onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: c.bg }}
      >
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <View style={styles.tagPill}>
            <Text style={styles.tagPillText}>New patient</Text>
          </View>
          <Text style={styles.modalTitle}>Add a patient</Text>

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
            disabled={submitting || name.trim().length === 0}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: submitting || name.trim().length === 0 ? 0.45 : pressed ? 0.85 : 1 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={c.textOnAccent} />
            ) : (
              <Text style={styles.primaryBtnLabel}>CREATE PATIENT →</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              reset();
              onClose();
            }}
            style={styles.cancelBtn}
          >
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function stamp(iso: string | null): number {
  if (!iso) return 0;
  return new Date(iso).getTime();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0]?.length === 0) return '?';
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'Never seen';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day && now.getDate() === d.getDate()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (diffMs < 7 * day) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function groupByLastSeen(
  entries: PatientEntry[],
  sort: Sort,
): { label: string; entries: PatientEntry[] }[] {
  if (sort !== 'recent') return [{ label: '', entries }];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = today - 6 * 24 * 60 * 60 * 1000;
  const today_: PatientEntry[] = [];
  const week_: PatientEntry[] = [];
  const older_: PatientEntry[] = [];
  const never_: PatientEntry[] = [];
  for (const e of entries) {
    const t = stamp(e.patient.last_encounter_at);
    if (!t) never_.push(e);
    else if (t >= today) today_.push(e);
    else if (t >= weekAgo) week_.push(e);
    else older_.push(e);
  }
  return [
    { label: 'Today', entries: today_ },
    { label: 'This week', entries: week_ },
    { label: 'Older', entries: older_ },
    { label: 'Never seen', entries: never_ },
  ];
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: 120 },

  pageTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 34,
    lineHeight: 40,
    color: c.text,
    letterSpacing: -1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: space.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
  },
  searchInput: {
    flex: 1,
    color: c.text,
    fontSize: font.size.base,
    paddingVertical: Platform.OS === 'ios' ? 4 : 8,
  },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sortLabel: {
    fontSize: font.size.xs - 1,
    color: c.textSubtle,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1,
    marginRight: 4,
  },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  sortChipActive: { backgroundColor: c.accent, borderColor: c.accent },
  sortChipText: {
    fontSize: font.size.xs,
    color: c.textMuted,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.5,
  },
  sortChipTextActive: { color: c.textOnAccent },

  groupHeader: {
    color: c.textSubtle,
    fontSize: font.size.xs - 1,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 6,
  },

  patientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.md,
    gap: space.md,
  },
  patientAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patientAvatarText: {
    color: c.accent,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.5,
  },
  patientName: { color: c.text, fontSize: font.size.base, fontWeight: font.weight.bold as '700' },
  patientMeta: { color: c.textMuted, fontSize: font.size.sm, marginTop: 2 },
  patientRight: { alignItems: 'flex-end', gap: 6 },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
  },
  countChipText: {
    color: c.accent,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold as '700',
    fontVariant: ['tabular-nums'],
  },
  lastEnc: {
    color: c.textSubtle,
    fontSize: font.size.xs,
    letterSpacing: 0.4,
  },

  emptyCard: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.xl,
    gap: space.sm,
    alignItems: 'flex-start',
  },
  emptyTitle: {
    fontFamily: fonts.serifBoldItalic,
    color: c.text,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.6,
  },
  emptyBody: {
    fontFamily: fonts.display,
    color: c.textMuted,
    fontSize: font.size.sm,
    lineHeight: 20,
  },

  errorBox: {
    backgroundColor: c.dangerSoft,
    borderWidth: 1,
    borderColor: c.danger,
    borderRadius: radii.md,
    padding: space.md,
  },
  errorText: { color: c.text, fontSize: font.size.sm },

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

  fab: {
    position: 'absolute',
    bottom: 110, // sit above the floating tab pill
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: c.accent,
    borderRadius: radii.md,
    paddingVertical: space.md + 4,
  },
  fabText: {
    color: c.textOnAccent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1.2,
    fontSize: font.size.sm,
  },

  modalContent: { padding: space.lg, paddingTop: space.xl, gap: space.md, backgroundColor: c.bg, flexGrow: 1 },
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
});

