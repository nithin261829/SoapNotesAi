import { StyleSheet, Text, View } from 'react-native';

import { ChipRow } from '@/components/Chip';
import { useStyles } from '@/theme/ThemeContext';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';
import type { Medication, SoapNote, Vitals } from '@/types/soap';

interface Props {
  soap: SoapNote;
  transcript: string;
}

const NOT_DOC = '— not documented';

export function SoapPreview({ soap, transcript }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      {/* PATIENT */}
      <CapabilityCard
        tag="Patient context"
        title="Patient"
        description="Demographic snapshot extracted at the time of the encounter."
      >
        <KV k="Name" v={soap.patient.name || NOT_DOC} />
        <KV
          k="Age"
          v={soap.patient.age != null ? `${soap.patient.age}` : NOT_DOC}
        />
        <KV k="Sex" v={soap.patient.sex ?? NOT_DOC} />
        <KV k="Encounter date" v={soap.patient.encounter_date} />
      </CapabilityCard>

      {/* SUBJECTIVE */}
      <CapabilityCard
        tag="Patient stated"
        title="Subjective"
        description="Chief complaint, HPI, symptoms, history, current meds, allergies — only what the patient said."
      >
        <KV k="Chief complaint" v={soap.subjective.chief_complaint ?? NOT_DOC} />
        {soap.subjective.history_present_illness ? (
          <KV k="HPI" v={soap.subjective.history_present_illness} />
        ) : null}
        {soap.subjective.relevant_history ? (
          <KV k="History" v={soap.subjective.relevant_history} />
        ) : null}

        <Group label="Symptoms">
          <ChipRow items={soap.subjective.symptoms} emptyHint={NOT_DOC} />
        </Group>

        <Group label="Current medications">
          {soap.subjective.current_medications.length > 0 ? (
            <View style={styles.list}>
              {soap.subjective.current_medications.map((m, i) => (
                <BulletLine key={i} text={medLine(m)} />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>{NOT_DOC}</Text>
          )}
        </Group>

        <Group label="Allergies">
          <ChipRow
            items={soap.subjective.allergies.map((a) =>
              a.severity ? `${a.substance} · ${a.severity}` : a.substance,
            )}
            emptyHint="None documented"
          />
        </Group>
      </CapabilityCard>

      {/* OBJECTIVE */}
      <CapabilityCard
        tag="Clinician observed"
        title="Objective"
        description="Vitals, exam findings, and labs — measurable, not stated."
      >
        <Group label="Vitals">
          <VitalsGrid vitals={soap.objective.vitals} />
        </Group>
        {soap.objective.physical_exam ? (
          <KV k="Physical exam" v={soap.objective.physical_exam} />
        ) : null}
        <Group label="Findings">
          {soap.objective.findings.length > 0 ? (
            <View style={styles.list}>
              {soap.objective.findings.map((f, i) => <BulletLine key={i} text={f} />)}
            </View>
          ) : (
            <Text style={styles.empty}>{NOT_DOC}</Text>
          )}
        </Group>
      </CapabilityCard>

      {/* ASSESSMENT */}
      <CapabilityCard
        tag="Clinical impression"
        title="Assessment"
        description="Working diagnosis and clinical impressions from the encounter."
      >
        <Group label="Impressions">
          <ChipRow items={soap.assessment.impressions} emptyHint={NOT_DOC} />
        </Group>
        <Group label="Diagnoses">
          <ChipRow items={soap.assessment.diagnoses} emptyHint={NOT_DOC} />
        </Group>
      </CapabilityCard>

      {/* PLAN */}
      <CapabilityCard
        tag="Treatment plan"
        title="Plan"
        description="Medications, tests, procedures, follow-up, and patient education."
      >
        <Group label="Medications">
          {soap.plan.medications.length > 0 ? (
            <View style={styles.list}>
              {soap.plan.medications.map((m, i) => <BulletLine key={i} text={medLine(m)} />)}
            </View>
          ) : (
            <Text style={styles.empty}>{NOT_DOC}</Text>
          )}
        </Group>
        <Group label="Tests ordered">
          <ChipRow items={soap.plan.tests_ordered} emptyHint="None" />
        </Group>
        {soap.plan.follow_up ? <KV k="Follow-up" v={soap.plan.follow_up} /> : null}
        {soap.plan.patient_education ? <KV k="Education" v={soap.plan.patient_education} /> : null}
      </CapabilityCard>

      {/* TRANSCRIPT */}
      <View style={styles.transcriptCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.tag}>Source · verbatim</Text>
          <Text style={styles.cardTitle}>Transcript</Text>
        </View>
        <Text style={styles.transcript}>{transcript}</Text>
      </View>
    </View>
  );
}

// ─── Building blocks ───────────────────────────────────────────────

function CapabilityCard({
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

function KV({ k, v }: { k: string; v: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={styles.kvValue}>{v}</Text>
    </View>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {children}
    </View>
  );
}

function BulletLine({ text }: { text: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.bulletLine}>
      <Text style={styles.bulletGlyph}>—</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function VitalsGrid({ vitals }: { vitals: Vitals }) {
  const styles = useStyles(makeStyles);
  const items: Array<{ label: string; value: string; unit?: string }> = [];
  if (vitals.blood_pressure) items.push({ label: 'BP', value: vitals.blood_pressure });
  if (vitals.heart_rate_bpm != null) items.push({ label: 'HR', value: String(vitals.heart_rate_bpm), unit: 'bpm' });
  if (vitals.respiratory_rate != null) items.push({ label: 'RR', value: String(vitals.respiratory_rate), unit: '/min' });
  if (vitals.temperature_c != null) items.push({ label: 'Temp', value: vitals.temperature_c.toFixed(1), unit: '°C' });
  if (vitals.spo2_percent != null) items.push({ label: 'SpO₂', value: String(vitals.spo2_percent), unit: '%' });
  if (vitals.weight_kg != null) items.push({ label: 'Wt', value: vitals.weight_kg.toFixed(1), unit: 'kg' });
  if (vitals.pain_scale_0_10 != null) items.push({ label: 'Pain', value: String(vitals.pain_scale_0_10), unit: '/10' });

  if (items.length === 0) return <Text style={styles.empty}>{NOT_DOC}</Text>;

  return (
    <View style={styles.vitalsGrid}>
      {items.map((it, i) => (
        <View key={i} style={styles.vitalCell}>
          <Text style={styles.vitalLabel}>{it.label}</Text>
          <View style={styles.vitalValueRow}>
            <Text style={styles.vitalValue}>{it.value}</Text>
            {it.unit ? <Text style={styles.vitalUnit}>{it.unit}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function medLine(m: Medication): string {
  return [m.name, m.dose, m.route, m.frequency, m.duration].filter(Boolean).join(' · ');
}

// ─── Styles ────────────────────────────────────────────────────────

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
  cardDescription: {
    fontSize: font.size.sm,
    color: c.textMuted,
    lineHeight: 18,
  },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 2 },
  cardBody: { gap: space.md },

  // KV rows
  kv: { gap: 4 },
  kvKey: {
    fontSize: font.size.xs,
    color: c.textSubtle,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  kvValue: { fontSize: font.size.base, color: c.text, lineHeight: 20 },

  // Groups
  group: { gap: 6 },
  groupLabel: {
    fontSize: font.size.xs,
    color: c.textSubtle,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Bullet list
  list: { gap: 4 },
  bulletLine: { flexDirection: 'row', gap: 8 },
  bulletGlyph: { color: c.accent, fontSize: font.size.base, lineHeight: 20 },
  bulletText: { color: c.text, fontSize: font.size.base, lineHeight: 20, flex: 1 },

  empty: { fontSize: font.size.sm, color: c.textDim, fontStyle: 'italic' },

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
    paddingVertical: 10,
    minWidth: 80,
  },
  vitalLabel: {
    fontSize: font.size.xs - 1,
    color: c.accent,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  vitalValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 4 },
  vitalValue: {
    fontSize: font.size.lg,
    color: c.text,
    fontWeight: font.weight.semibold as '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  vitalUnit: { fontSize: font.size.xs, color: c.textMuted },

  // Transcript
  transcriptCard: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.lg,
    gap: space.sm,
  },
  tag: {
    fontSize: font.size.xs - 1,
    color: c.textSubtle,
    fontWeight: font.weight.bold as '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  transcript: {
    fontSize: font.size.base - 1,
    color: c.textMuted,
    lineHeight: 22,
    marginTop: space.sm,
  },
});
