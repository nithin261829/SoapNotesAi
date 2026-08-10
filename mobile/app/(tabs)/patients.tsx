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
import { font, radii, radiusXl2, shadow, space, type ThemeColors } from '@/theme/tokens';

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
          <Feather name="search" size={17} color={c.textSubtle} style={{ marginRight: 10 }} />
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
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              style={({ pressed }) => [
                styles.searchClear,
                pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x" size={13} color={c.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.sortRow}>
          <View style={styles.sortSegment}>
            {(Object.keys(SORT_LABELS) as Sort[]).map((s) => {
              const active = sort === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSort(s)}
                  style={({ pressed }) => [
                    styles.sortChip,
                    active && styles.sortChipActive,
                    pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                    {SORT_LABELS[s]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => setAddOpen(true)}
            style={({ pressed }) => [
              styles.addPill,
              pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add patient"
          >
            <Feather name="plus" size={15} color={c.textOnAccent} />
            <Text style={styles.addPillText}>Patient</Text>
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} /> : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {!loading && patients.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Feather name="users" size={22} color={c.accent} />
            </View>
            <Text style={styles.emptyTitle}>No patients yet</Text>
            <Text style={styles.emptyBody}>
              Add a patient here, or just dictate from the Record tab — the AI will create one
              from the audio.
            </Text>
            <Pressable
              onPress={() => setAddOpen(true)}
              style={({ pressed }) => [
                styles.emptyCta,
                pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add patient"
            >
              <Feather name="plus" size={14} color={c.accent} />
              <Text style={styles.emptyCtaText}>Add your first patient</Text>
            </Pressable>
          </View>
        ) : null}
        {!loading && patients.length > 0 && filtered.length === 0 ? (
          <View style={styles.noMatchCard}>
            <Feather name="search" size={18} color={c.textSubtle} />
            <Text style={styles.noMatchText}>No patients match “{query}”.</Text>
          </View>
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
      style={({ pressed }) => [
        styles.patientCard,
        pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${patient.name}`}
    >
      <View style={styles.patientAvatar}>
        <Text style={styles.patientAvatarText}>{initials(patient.name)}</Text>
      </View>
      <View style={styles.patientBody}>
        <Text style={styles.patientName} numberOfLines={1}>
          {patient.name}
        </Text>
        <Text style={styles.patientMeta} numberOfLines={1}>
          {patient.age_at_record != null ? `${patient.age_at_record} y/o` : '—'}
          {patient.sex ? ` · ${patient.sex}` : ''}
          {` · `}
          <Text style={styles.patientMetaAccent}>{lastSeenLabel(patient.last_encounter_at)}</Text>
        </Text>
      </View>
      <View style={styles.patientRight}>
        <View style={styles.countChip}>
          <Feather name="mic" size={11} color={c.accent} />
          <Text style={styles.countChipText}>{patient.recording_count}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={c.textDim} />
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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<PatientSex | null>(null);
  const [phone, setPhone] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0;

  const reset = () => {
    setFirstName('');
    setLastName('');
    setAge('');
    setSex(null);
    setPhone('');
    setPatientEmail('');
    setAddress('');
    setError(null);
    setSubmitting(false);
  };

  const onSubmit = async () => {
    if (submitting || !canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const token = await getIdToken();
      const entry = await createPatient(token, {
        name: `${firstName.trim()} ${lastName.trim()}`,
        age_at_record: age ? Number.parseInt(age, 10) : undefined,
        sex: sex ?? undefined,
        phone: phone.trim() || undefined,
        email: patientEmail.trim() || undefined,
        address: address.trim() || undefined,
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
          <View style={styles.modalHeader}>
            <View style={styles.modalIcon}>
              <Feather name="user-plus" size={20} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.tagPill}>
                <Text style={styles.tagPillText}>New patient</Text>
              </View>
              <Text style={styles.modalTitle}>Add a patient</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.label}>First name *</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={c.textDim}
                autoCapitalize="words"
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.label}>Last name *</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={c.textDim}
                autoCapitalize="words"
              />
            </View>
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
                        pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
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
            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 …"
              keyboardType="phone-pad"
              placeholderTextColor={c.textDim}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Email (optional)</Text>
            <TextInput
              style={styles.input}
              value={patientEmail}
              onChangeText={setPatientEmail}
              placeholder="patient@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={c.textDim}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Address (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]}
              value={address}
              onChangeText={setAddress}
              placeholder="Street, city, PIN"
              multiline
              placeholderTextColor={c.textDim}
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            onPress={() => void onSubmit()}
            disabled={submitting || !canSubmit}
            style={({ pressed }) => [
              styles.primaryBtn,
              submitting || !canSubmit
                ? { opacity: 0.45 }
                : pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
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
            style={({ pressed }) => [
              styles.cancelBtn,
              pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
            ]}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: 120 },

  pageTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 34,
    lineHeight: 40,
    color: c.text,
    letterSpacing: -1.2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: radii.pill,
    paddingHorizontal: space.base,
    paddingVertical: Platform.OS === 'ios' ? 12 : 4,
    marginTop: space.xs,
    ...shadow.card,
  },
  searchInput: {
    flex: 1,
    color: c.text,
    fontFamily: fonts.display,
    fontSize: font.size.md,
    paddingVertical: Platform.OS === 'ios' ? 2 : 8,
  },
  searchClear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceHover,
    marginLeft: 8,
  },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  sortLabel: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sortSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: c.surfaceHover,
    borderRadius: radii.pill,
    padding: 3,
  },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  sortChipActive: { backgroundColor: c.accent, ...shadow.sm },
  sortChipText: {
    fontFamily: fonts.displaySemi,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 0.3,
  },
  sortChipTextActive: { color: c.textOnAccent, fontFamily: fonts.displayBold },

  groupHeader: {
    fontFamily: fonts.displayBold,
    color: c.textMuted,
    fontSize: font.size.xs - 1,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: space.sm,
    marginLeft: space.xs,
  },

  patientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: space.base,
    gap: space.md,
    ...shadow.sm,
  },
  patientAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.accentSoftStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patientAvatarText: {
    fontFamily: fonts.displayBold,
    color: c.accent,
    fontSize: font.size.base,
    letterSpacing: 0.3,
  },
  patientBody: { flex: 1, gap: 3 },
  patientName: {
    fontFamily: fonts.displaySemi,
    color: c.text,
    fontSize: font.size.md,
    letterSpacing: -0.2,
  },
  patientMeta: {
    fontFamily: fonts.display,
    color: c.textSubtle,
    fontSize: font.size.xs,
    letterSpacing: 0.2,
  },
  patientMetaAccent: { fontFamily: fonts.displaySemi, color: c.textMuted },
  patientRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
  },
  countChipText: {
    fontFamily: fonts.displayBold,
    color: c.accent,
    fontSize: font.size.xs,
    fontVariant: ['tabular-nums'],
  },

  emptyCard: {
    backgroundColor: c.surface,
    borderRadius: radiusXl2,
    padding: space.xl,
    gap: space.md,
    alignItems: 'center',
    marginTop: space.sm,
    ...shadow.card,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: fonts.serifBoldItalic,
    color: c.text,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fonts.display,
    color: c.textMuted,
    fontSize: font.size.sm,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.base,
    paddingVertical: space.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
    marginTop: space.xs,
  },
  emptyCtaText: {
    fontFamily: fonts.displayBold,
    color: c.accent,
    fontSize: font.size.sm,
    letterSpacing: 0.3,
  },

  noMatchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  noMatchText: {
    fontFamily: fonts.display,
    color: c.textMuted,
    fontSize: font.size.sm,
  },

  errorBox: {
    backgroundColor: c.dangerSoft,
    borderRadius: radii.md,
    padding: space.md,
    ...shadow.sm,
  },
  errorText: { fontFamily: fonts.displayMedium, color: c.danger, fontSize: font.size.sm },

  tagPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
  },
  tagPillText: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs - 1,
    color: c.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  addPill: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 11,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: c.accent,
    ...shadow.sm,
  },
  addPillText: {
    fontFamily: fonts.displayBold,
    color: c.textOnAccent,
    fontSize: font.size.sm,
    letterSpacing: 0.2,
  },

  modalContent: { padding: space.lg, paddingTop: space.xl, gap: space.md, backgroundColor: c.bg, flexGrow: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xs },
  modalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontFamily: fonts.displayBold,
    color: c.text,
    fontSize: font.size.xxl,
    letterSpacing: -0.6,
    marginTop: 4,
  },
  label: {
    fontFamily: fonts.displayBold,
    fontSize: font.size.xs,
    color: c.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: c.surface,
    borderRadius: radii.md,
    paddingHorizontal: space.base,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: c.text,
    fontFamily: fonts.display,
    fontSize: font.size.md,
    ...shadow.sm,
  },
  sexRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sexChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: c.surfaceHover,
  },
  sexChipSelected: { backgroundColor: c.accent },
  sexChipText: {
    fontFamily: fonts.displaySemi,
    color: c.textMuted,
    fontSize: font.size.xs,
    letterSpacing: 0.3,
    textTransform: 'capitalize',
  },
  sexChipTextSelected: { color: c.textOnAccent, fontFamily: fonts.displayBold },

  primaryBtn: {
    marginTop: space.sm,
    paddingVertical: space.base,
    paddingHorizontal: space.lg,
    borderRadius: radii.pill,
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
  cancelBtn: { alignSelf: 'center', paddingVertical: space.md },
  cancelLink: {
    fontFamily: fonts.displaySemi,
    color: c.textMuted,
    fontSize: font.size.sm,
    letterSpacing: 0.3,
  },
});

