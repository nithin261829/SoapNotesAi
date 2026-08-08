// Editable SOAP — every field the doctor might need to fix (typos, dose tweaks,
// extra medication, missing finding) is a real input. Controlled by the parent
// via `onChange`. The transcript stays read-only at the bottom.

import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';
import type {
  Allergy,
  Medication,
  Objective,
  Plan,
  Sex,
  SoapNote,
  Subjective,
  Vitals,
} from '@/types/soap';

interface Props {
  soap: SoapNote;
  transcript: string;
  onChange: (next: SoapNote) => void;
  /** Hide the internal transcript card (caller renders it separately). */
  hideTranscript?: boolean;
}

const SEXES: Sex[] = ['male', 'female', 'other', 'unknown'];
const SEVERITIES: NonNullable<Allergy['severity']>[] = ['mild', 'moderate', 'severe', 'unknown'];

export function SoapEditor({ soap, transcript, onChange, hideTranscript }: Props) {
  const styles = useStyles(makeStyles);
  const updatePatient = (patch: Partial<SoapNote['patient']>) =>
    onChange({ ...soap, patient: { ...soap.patient, ...patch } });
  const updateSubjective = (patch: Partial<Subjective>) =>
    onChange({ ...soap, subjective: { ...soap.subjective, ...patch } });
  const updateObjective = (patch: Partial<Objective>) =>
    onChange({ ...soap, objective: { ...soap.objective, ...patch } });
  const updateAssessment = (patch: Partial<SoapNote['assessment']>) =>
    onChange({ ...soap, assessment: { ...soap.assessment, ...patch } });
  const updatePlan = (patch: Partial<Plan>) =>
    onChange({ ...soap, plan: { ...soap.plan, ...patch } });

  return (
    <View style={styles.wrap}>
      {/* PATIENT */}
      <Card tag="Patient context" title="Patient" description="Tap any field to edit.">
        <Field
          label="Name"
          value={soap.patient.name}
          onChangeText={(v) => updatePatient({ name: v })}
          placeholder="Patient name"
        />
        <View style={styles.row}>
          <View style={styles.col}>
            <Field
              label="Age"
              value={soap.patient.age != null ? String(soap.patient.age) : ''}
              keyboardType="number-pad"
              onChangeText={(v) =>
                updatePatient({ age: v.trim() === '' ? null : Number.parseInt(v, 10) || null })
              }
              placeholder="—"
            />
          </View>
          <View style={styles.col}>
            <Picker
              label="Sex"
              value={soap.patient.sex ?? null}
              options={SEXES}
              onChange={(s) => updatePatient({ sex: s })}
            />
          </View>
        </View>
        <Field
          label="Encounter date"
          value={soap.patient.encounter_date}
          onChangeText={(v) => updatePatient({ encounter_date: v })}
          placeholder="YYYY-MM-DD"
        />
      </Card>

      {/* SUBJECTIVE */}
      <Card
        tag="Patient stated"
        title="Subjective"
        description="Chief complaint, HPI, symptoms, history, current meds, allergies."
      >
        <Field
          label="Chief complaint"
          value={soap.subjective.chief_complaint ?? ''}
          onChangeText={(v) => updateSubjective({ chief_complaint: v || null })}
          placeholder="Why is the patient here today?"
        />
        <Field
          label="History of present illness"
          multiline
          value={soap.subjective.history_present_illness ?? ''}
          onChangeText={(v) => updateSubjective({ history_present_illness: v || null })}
          placeholder="Narrative of the current problem"
        />
        <Field
          label="Relevant history"
          multiline
          value={soap.subjective.relevant_history ?? ''}
          onChangeText={(v) => updateSubjective({ relevant_history: v || null })}
          placeholder="Past medical / surgical / family history mentioned"
        />
        <StringListEditor
          label="Symptoms"
          items={soap.subjective.symptoms}
          placeholder="Add a symptom"
          onChange={(items) => updateSubjective({ symptoms: items })}
        />
        <MedListEditor
          label="Current medications"
          items={soap.subjective.current_medications}
          onChange={(items) => updateSubjective({ current_medications: items })}
        />
        <AllergyListEditor
          items={soap.subjective.allergies}
          onChange={(items) => updateSubjective({ allergies: items })}
        />
      </Card>

      {/* OBJECTIVE */}
      <Card
        tag="Clinician observed"
        title="Objective"
        description="Vitals, exam, findings, labs."
      >
        <VitalsEditor
          vitals={soap.objective.vitals}
          onChange={(vitals) => updateObjective({ vitals })}
        />
        <Field
          label="Physical exam"
          multiline
          value={soap.objective.physical_exam ?? ''}
          onChangeText={(v) => updateObjective({ physical_exam: v || null })}
          placeholder="Documented exam findings"
        />
        <StringListEditor
          label="Findings"
          items={soap.objective.findings}
          placeholder="Add a finding"
          onChange={(items) => updateObjective({ findings: items })}
        />
        <StringListEditor
          label="Labs reviewed"
          items={soap.objective.labs_reviewed}
          placeholder="Add a lab"
          onChange={(items) => updateObjective({ labs_reviewed: items })}
        />
      </Card>

      {/* ASSESSMENT */}
      <Card
        tag="Clinical impression"
        title="Assessment"
        description="Impressions and working diagnoses."
      >
        <StringListEditor
          label="Impressions"
          items={soap.assessment.impressions}
          placeholder="Add an impression"
          onChange={(items) => updateAssessment({ impressions: items })}
        />
        <StringListEditor
          label="Diagnoses"
          items={soap.assessment.diagnoses}
          placeholder="Add a diagnosis"
          onChange={(items) => updateAssessment({ diagnoses: items })}
        />
      </Card>

      {/* PLAN */}
      <Card tag="Treatment plan" title="Plan" description="What's being done about it.">
        <MedListEditor
          label="Medications"
          items={soap.plan.medications}
          onChange={(items) => updatePlan({ medications: items })}
        />
        <StringListEditor
          label="Tests ordered"
          items={soap.plan.tests_ordered}
          placeholder="Add a test"
          onChange={(items) => updatePlan({ tests_ordered: items })}
        />
        <StringListEditor
          label="Procedures"
          items={soap.plan.procedures}
          placeholder="Add a procedure"
          onChange={(items) => updatePlan({ procedures: items })}
        />
        <Field
          label="Follow-up"
          multiline
          value={soap.plan.follow_up ?? ''}
          onChangeText={(v) => updatePlan({ follow_up: v || null })}
          placeholder="When and how to follow up"
        />
        <Field
          label="Patient education"
          multiline
          value={soap.plan.patient_education ?? ''}
          onChangeText={(v) => updatePlan({ patient_education: v || null })}
          placeholder="What the patient was told / handed"
        />
        <StringListEditor
          label="Referrals"
          items={soap.plan.referrals}
          placeholder="Add a referral"
          onChange={(items) => updatePlan({ referrals: items })}
        />
      </Card>

      {/* TRANSCRIPT (read-only) — hidden when caller renders it separately */}
      {hideTranscript ? null : (
        <View style={styles.transcriptCard}>
          <View style={styles.tagPill}>
            <Text style={styles.tagPillText}>Source · verbatim</Text>
          </View>
          <Text style={styles.cardTitle}>Transcript</Text>
          <Text style={styles.transcript}>{transcript}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────

function Card({
  tag,
  title,
  description,
  children,
}: {
  tag: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.tagPill}>
          <Text style={styles.tagPillText}>{tag}</Text>
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDescription}>{description}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

// ─── Single text input ────────────────────────────────────────────

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
}) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textDim}
        multiline={multiline}
        keyboardType={keyboardType ?? 'default'}
      />
    </View>
  );
}

// ─── Inline picker (small chip-style) ─────────────────────────────

function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  onChange: (v: T | null) => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pickerRow}>
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(selected ? null : opt)}
              hitSlop={4}
              style={[styles.pickerChip, selected && styles.pickerChipSelected]}
            >
              <Text style={[styles.pickerChipText, selected && styles.pickerChipTextSelected]}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── String list editor (symptoms, findings, etc.) ────────────────

function StringListEditor({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...items, t]);
    setDraft('');
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const edit = (i: number, v: string) =>
    onChange(items.map((it, idx) => (idx === i ? v : it)));

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>None added</Text>
      ) : (
        <View style={styles.list}>
          {items.map((it, i) => (
            <View key={i} style={styles.rowItem}>
              <TextInput
                style={[styles.input, styles.rowItemInput]}
                value={it}
                onChangeText={(v) => edit(i, v)}
              />
              <Pressable
                onPress={() => remove(i)}
                hitSlop={6}
                style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.6 : 1 }]}
                accessibilityLabel={`Remove ${it}`}
              >
                <Text style={styles.removeBtnText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.addInput]}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={c.textDim}
          onSubmitEditing={add}
          returnKeyType="done"
        />
        <Pressable
          onPress={add}
          disabled={!draft.trim()}
          style={({ pressed }) => [
            styles.addBtn,
            { opacity: !draft.trim() ? 0.45 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.addBtnText}>ADD</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Medication list editor ───────────────────────────────────────

function MedListEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: Medication[];
  onChange: (items: Medication[]) => void;
}) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const add = () =>
    onChange([
      ...items,
      { name: '', dose: null, route: null, frequency: null, duration: null, notes: null },
    ]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const edit = (i: number, patch: Partial<Medication>) =>
    onChange(items.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      {items.length === 0 ? <Text style={styles.empty}>None added</Text> : null}
      <View style={styles.list}>
        {items.map((m, i) => (
          <View key={i} style={styles.medCard}>
            <View style={styles.medHeader}>
              <Text style={styles.medIndex}>#{i + 1}</Text>
              <Pressable
                onPress={() => remove(i)}
                hitSlop={6}
                style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.6 : 1 }]}
                accessibilityLabel="Remove medication"
              >
                <Text style={styles.removeBtnText}>×</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              value={m.name}
              onChangeText={(v) => edit(i, { name: v })}
              placeholder="Name (e.g. amoxicillin)"
              placeholderTextColor={c.textDim}
            />
            <View style={styles.row}>
              <View style={styles.col}>
                <TextInput
                  style={styles.input}
                  value={m.dose ?? ''}
                  onChangeText={(v) => edit(i, { dose: v || null })}
                  placeholder="Dose (500 mg)"
                  placeholderTextColor={c.textDim}
                />
              </View>
              <View style={styles.col}>
                <TextInput
                  style={styles.input}
                  value={m.route ?? ''}
                  onChangeText={(v) => edit(i, { route: v || null })}
                  placeholder="Route (PO)"
                  placeholderTextColor={c.textDim}
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.col}>
                <TextInput
                  style={styles.input}
                  value={m.frequency ?? ''}
                  onChangeText={(v) => edit(i, { frequency: v || null })}
                  placeholder="Frequency (TID)"
                  placeholderTextColor={c.textDim}
                />
              </View>
              <View style={styles.col}>
                <TextInput
                  style={styles.input}
                  value={m.duration ?? ''}
                  onChangeText={(v) => edit(i, { duration: v || null })}
                  placeholder="Duration (7 days)"
                  placeholderTextColor={c.textDim}
                />
              </View>
            </View>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={m.notes ?? ''}
              onChangeText={(v) => edit(i, { notes: v || null })}
              placeholder="Notes (with food, taper, etc.)"
              placeholderTextColor={c.textDim}
              multiline
            />
          </View>
        ))}
      </View>
      <Pressable
        onPress={add}
        style={({ pressed }) => [styles.fullAddBtn, { opacity: pressed ? 0.85 : 1 }]}
        accessibilityLabel="Add medication"
      >
        <Text style={styles.fullAddBtnText}>＋ ADD MEDICATION</Text>
      </Pressable>
    </View>
  );
}

// ─── Allergy list editor ──────────────────────────────────────────

function AllergyListEditor({
  items,
  onChange,
}: {
  items: Allergy[];
  onChange: (items: Allergy[]) => void;
}) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  const add = () =>
    onChange([...items, { substance: '', reaction: null, severity: null }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const edit = (i: number, patch: Partial<Allergy>) =>
    onChange(items.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>Allergies</Text>
      {items.length === 0 ? <Text style={styles.empty}>None added</Text> : null}
      <View style={styles.list}>
        {items.map((a, i) => (
          <View key={i} style={styles.medCard}>
            <View style={styles.medHeader}>
              <Text style={styles.medIndex}>#{i + 1}</Text>
              <Pressable
                onPress={() => remove(i)}
                hitSlop={6}
                style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.6 : 1 }]}
                accessibilityLabel="Remove allergy"
              >
                <Text style={styles.removeBtnText}>×</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              value={a.substance}
              onChangeText={(v) => edit(i, { substance: v })}
              placeholder="Substance (penicillin)"
              placeholderTextColor={c.textDim}
            />
            <TextInput
              style={styles.input}
              value={a.reaction ?? ''}
              onChangeText={(v) => edit(i, { reaction: v || null })}
              placeholder="Reaction (rash, anaphylaxis)"
              placeholderTextColor={c.textDim}
            />
            <Picker
              label="Severity"
              value={a.severity ?? null}
              options={SEVERITIES}
              onChange={(s) => edit(i, { severity: s })}
            />
          </View>
        ))}
      </View>
      <Pressable
        onPress={add}
        style={({ pressed }) => [styles.fullAddBtn, { opacity: pressed ? 0.85 : 1 }]}
        accessibilityLabel="Add allergy"
      >
        <Text style={styles.fullAddBtnText}>＋ ADD ALLERGY</Text>
      </Pressable>
    </View>
  );
}

// ─── Vitals editor (grid of small inputs) ─────────────────────────

function VitalsEditor({
  vitals,
  onChange,
}: {
  vitals: Vitals;
  onChange: (v: Vitals) => void;
}) {
  const styles = useStyles(makeStyles);
  const set = (patch: Partial<Vitals>) => onChange({ ...vitals, ...patch });
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>Vitals</Text>
      <View style={styles.vitalsGrid}>
        <VitalCell
          label="BP"
          value={vitals.blood_pressure ?? ''}
          onChange={(v) => set({ blood_pressure: v || null })}
          placeholder="120/80"
        />
        <VitalCell
          label="HR"
          unit="bpm"
          value={vitals.heart_rate_bpm != null ? String(vitals.heart_rate_bpm) : ''}
          onChange={(v) => set({ heart_rate_bpm: parseNum(v) })}
          keyboardType="number-pad"
          placeholder="72"
        />
        <VitalCell
          label="RR"
          unit="/min"
          value={vitals.respiratory_rate != null ? String(vitals.respiratory_rate) : ''}
          onChange={(v) => set({ respiratory_rate: parseNum(v) })}
          keyboardType="number-pad"
          placeholder="16"
        />
        <VitalCell
          label="Temp"
          unit="°C"
          value={vitals.temperature_c != null ? String(vitals.temperature_c) : ''}
          onChange={(v) => set({ temperature_c: parseFloatNum(v) })}
          keyboardType="decimal-pad"
          placeholder="37.0"
        />
        <VitalCell
          label="SpO₂"
          unit="%"
          value={vitals.spo2_percent != null ? String(vitals.spo2_percent) : ''}
          onChange={(v) => set({ spo2_percent: parseNum(v) })}
          keyboardType="number-pad"
          placeholder="98"
        />
        <VitalCell
          label="Wt"
          unit="kg"
          value={vitals.weight_kg != null ? String(vitals.weight_kg) : ''}
          onChange={(v) => set({ weight_kg: parseFloatNum(v) })}
          keyboardType="decimal-pad"
          placeholder="70"
        />
        <VitalCell
          label="Ht"
          unit="cm"
          value={vitals.height_cm != null ? String(vitals.height_cm) : ''}
          onChange={(v) => set({ height_cm: parseFloatNum(v) })}
          keyboardType="decimal-pad"
          placeholder="170"
        />
        <VitalCell
          label="Pain"
          unit="/10"
          value={vitals.pain_scale_0_10 != null ? String(vitals.pain_scale_0_10) : ''}
          onChange={(v) => set({ pain_scale_0_10: parseNum(v) })}
          keyboardType="number-pad"
          placeholder="0"
        />
      </View>
    </View>
  );
}

function VitalCell({
  label,
  unit,
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
}) {
  const c = useThemeColors();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.vitalCell}>
      <View style={styles.vitalLabelRow}>
        <Text style={styles.vitalLabel}>{label}</Text>
        {unit ? <Text style={styles.vitalUnit}>{unit}</Text> : null}
      </View>
      <TextInput
        style={styles.vitalInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.textDim}
        keyboardType={keyboardType ?? 'default'}
      />
    </View>
  );
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}
function parseFloatNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// ─── Styles ───────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: { gap: space.md, marginTop: space.base },

  card: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.base,
  },
  cardHeader: { gap: 6 },
  tagPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
    marginBottom: 4,
  },
  tagPillText: {
    fontSize: font.size.xs - 1,
    color: c.accent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold as '700',
    color: c.text,
    letterSpacing: -0.4,
  },
  cardDescription: { fontSize: font.size.sm, color: c.textMuted, lineHeight: 18 },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 2 },
  cardBody: { gap: space.md },

  // Fields
  fieldGroup: { gap: 6 },
  label: {
    fontSize: font.size.xs,
    color: c.textSubtle,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: space.md,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    color: c.text,
    fontSize: font.size.base,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },

  row: { flexDirection: 'row', gap: space.sm },
  col: { flex: 1 },

  // Picker chips
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pickerChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceElevated,
  },
  pickerChipSelected: {
    backgroundColor: c.accent,
    borderColor: c.accent,
  },
  pickerChipText: {
    color: c.textMuted,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pickerChipTextSelected: { color: c.textOnAccent },

  // List items (rows)
  list: { gap: 8 },
  rowItem: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowItemInput: { flex: 1 },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.dangerSoft,
    borderWidth: 1,
    borderColor: c.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: c.danger, fontSize: 18, fontWeight: '700', lineHeight: 20 },

  addRow: { flexDirection: 'row', gap: 8 },
  addInput: { flex: 1 },
  addBtn: {
    paddingHorizontal: space.base,
    justifyContent: 'center',
    backgroundColor: c.accent,
    borderRadius: radii.md,
  },
  addBtnText: {
    color: c.textOnAccent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1,
    fontSize: font.size.xs,
  },
  fullAddBtn: {
    paddingVertical: space.md,
    paddingHorizontal: space.base,
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentDim,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  fullAddBtnText: {
    color: c.accent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 1,
    fontSize: font.size.xs,
  },

  // Medication card
  medCard: {
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    padding: space.md,
    gap: 8,
  },
  medHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  medIndex: {
    color: c.textSubtle,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.6,
  },

  // Vitals
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vitalCell: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: c.surfaceElevated,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    minWidth: 96,
    gap: 4,
  },
  vitalLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  vitalLabel: {
    fontSize: font.size.xs - 1,
    color: c.accent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  vitalUnit: { fontSize: font.size.xs, color: c.textMuted },
  vitalInput: {
    color: c.text,
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold as '600',
    fontVariant: ['tabular-nums'],
    padding: 0,
  },

  // Transcript (read-only)
  transcriptCard: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.sm,
  },
  transcript: {
    fontSize: font.size.base - 1,
    color: c.textMuted,
    lineHeight: 22,
    marginTop: space.sm,
  },

  empty: { fontSize: font.size.sm, color: c.textDim, fontStyle: 'italic' },
});
