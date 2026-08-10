import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  getVerificationStatus,
  submitVerification,
  type VerificationStatus,
} from '@/api/verification';
import { useAuth } from '@/auth/AuthContext';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, radiusXl2, shadow, space, type ThemeColors } from '@/theme/tokens';

const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10MB

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

export default function VerificationScreen() {
  const router = useRouter();
  const { getIdToken, profile } = useAuth();
  const c = useThemeColors();
  const styles = useStyles(makeStyles);

  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [medicalCouncil, setMedicalCouncil] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getIdToken();
      const s = await getVerificationStatus(token);
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load verification status');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    if (asset.size != null && asset.size > MAX_PROOF_BYTES) {
      setError('File is too large — the proof document must be 10MB or less.');
      return;
    }
    setError(null);
    setFile({
      uri: asset.uri,
      name: asset.name ?? 'document',
      // Some Android providers omit mimeType — sniff from the extension so
      // the backend allowlist (pdf/jpeg/png) doesn't reject a valid file.
      mimeType: asset.mimeType ?? sniffMimeType(asset.name ?? asset.uri),
    });
  }, []);

  const sniffMimeType = (nameOrUri: string): string => {
    const lower = nameOrUri.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    return 'application/pdf';
  };

  const submit = useCallback(async () => {
    if (submitting) return;
    if (!medicalCouncil.trim() || !registrationNumber.trim() || !file) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getIdToken();
      const s = await submitVerification(token, {
        medicalCouncil: medicalCouncil.trim(),
        registrationNumber: registrationNumber.trim(),
        fileUri: file.uri,
        mimeType: file.mimeType,
      });
      setStatus(s.status ? s : { ...s, status: 'pending' });
      setResubmitting(false);
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }, [file, getIdToken, medicalCouncil, registrationNumber, submitting]);

  const registrationId = profile?.profile.registration_id;
  const showForm =
    !loading &&
    status != null &&
    (status.status === 'unverified' || (status.status === 'rejected' && resubmitting));
  const canSubmit = !!medicalCouncil.trim() && !!registrationNumber.trim() && !!file;

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
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.pageTitle}>Doctor Verification</Text>

        {loading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Verified */}
            {status?.status === 'verified' ? (
              <View style={[styles.card, styles.successCard]}>
                <View style={styles.successIconWrap}>
                  <Feather name="check" size={28} color={c.textOnAccent} />
                </View>
                <Text style={styles.successTitle}>Verified Doctor</Text>
                {registrationId ? (
                  <Text style={styles.hint}>Registration ID: {registrationId}</Text>
                ) : null}
                {status.medical_council ? (
                  <Text style={styles.hint}>
                    {status.medical_council}
                    {status.registration_number ? ` — ${status.registration_number}` : ''}
                  </Text>
                ) : null}
                <Text style={styles.hint}>
                  Your verified badge is printed on every PDF letterhead.
                </Text>
              </View>
            ) : null}

            {/* Pending */}
            {status?.status === 'pending' ? (
              <View style={styles.card}>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>Under review</Text>
                </View>
                <View style={styles.pendingRow}>
                  <View style={styles.pendingIcon}>
                    <Feather name="clock" size={18} color={c.accent} />
                  </View>
                  <Text style={styles.pendingText}>Documents under review</Text>
                </View>
                <Text style={styles.hint}>
                  We are reviewing your submission
                  {status.submitted_at
                    ? ` from ${new Date(status.submitted_at).toLocaleDateString()}`
                    : ''}
                  . You will get the verified badge once approved.
                </Text>
              </View>
            ) : null}

            {/* Rejected */}
            {status?.status === 'rejected' && !resubmitting ? (
              <View style={styles.card}>
                <View style={[styles.tagPill, styles.tagPillDanger]}>
                  <Text style={[styles.tagPillText, { color: c.danger }]}>Rejected</Text>
                </View>
                <Text style={styles.rejectedText}>
                  {status.rejection_reason ?? 'Your submission could not be verified.'}
                </Text>
                <Pressable
                  onPress={() => {
                    setResubmitting(true);
                    setMedicalCouncil(status.medical_council ?? '');
                    setRegistrationNumber(status.registration_number ?? '');
                    setError(null);
                  }}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Resubmit verification documents"
                >
                  <Text style={styles.primaryBtnText}>RESUBMIT DOCUMENTS</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Form (unverified or resubmitting) */}
            {showForm ? (
              <View style={styles.card}>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>Get verified</Text>
                </View>
                <Text style={styles.hint}>
                  Submit your medical council registration and a proof document
                  (certificate or registration card).
                </Text>

                <Text style={styles.label}>MEDICAL COUNCIL</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Karnataka Medical Council"
                  placeholderTextColor={c.textSubtle}
                  value={medicalCouncil}
                  onChangeText={setMedicalCouncil}
                  autoCapitalize="words"
                />

                <Text style={styles.label}>REGISTRATION NUMBER</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. KMC/12345"
                  placeholderTextColor={c.textSubtle}
                  value={registrationNumber}
                  onChangeText={setRegistrationNumber}
                  autoCapitalize="characters"
                />

                <Pressable
                  onPress={() => void pickFile()}
                  style={({ pressed }) => [
                    styles.attachBtn,
                    pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Attach proof document"
                >
                  <Feather name="paperclip" size={16} color={c.accent} />
                  <Text style={styles.attachBtnText}>ATTACH PROOF (PDF/IMAGE)</Text>
                </Pressable>
                {file ? (
                  <View style={styles.fileRow}>
                    <Feather name="file" size={14} color={c.textMuted} />
                    <Text style={styles.fileName} numberOfLines={1}>
                      {file.name}
                    </Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={() => void submit()}
                  disabled={submitting || !canSubmit}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    (submitting || !canSubmit) && { opacity: 0.5 },
                    pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Submit for verification"
                >
                  {submitting ? (
                    <ActivityIndicator color={c.textOnAccent} />
                  ) : (
                    <Text style={styles.primaryBtnText}>SUBMIT FOR VERIFICATION</Text>
                  )}
                </Pressable>

                <Text style={styles.note}>
                  A verified badge will be printed on every PDF letterhead once approved.
                </Text>
              </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    scroll: { padding: space.lg, gap: space.md, paddingBottom: 60 },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
    backText: {
      fontFamily: fonts.displaySemi,
      color: c.text,
      fontSize: font.size.base,
      marginLeft: -2,
    },
    pageTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 34,
      lineHeight: 40,
      color: c.text,
      letterSpacing: -1,
      marginBottom: space.xs,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.xl,
      padding: space.lg,
      gap: space.sm,
      ...shadow.card,
    },
    successCard: {
      backgroundColor: c.successSoft,
      borderRadius: radiusXl2,
      alignItems: 'center',
      paddingVertical: space.xl,
      ...shadow.raised,
    },
    successIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.success,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: space.xs,
      ...shadow.card,
    },
    successTitle: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xl,
      color: c.success,
      letterSpacing: -0.3,
    },
    tagPill: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
    },
    tagPillDanger: {
      backgroundColor: c.dangerSoft,
    },
    tagPillText: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs - 1,
      color: c.accent,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    hint: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
      lineHeight: 18,
    },
    pendingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 4 },
    pendingIcon: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pendingText: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.base,
      color: c.text,
      letterSpacing: -0.2,
    },
    rejectedText: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.text,
      lineHeight: 18,
      marginTop: 4,
    },
    label: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs - 1,
      color: c.textMuted,
      letterSpacing: 0.8,
      marginTop: 6,
    },
    input: {
      borderRadius: radii.md,
      backgroundColor: c.surfaceElevated,
      color: c.text,
      fontFamily: fonts.display,
      fontSize: font.size.base,
      paddingHorizontal: space.md,
      paddingVertical: 14,
      ...shadow.sm,
    },
    attachBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.accentSoft,
      borderRadius: radii.md,
      paddingVertical: space.md,
      marginTop: 8,
    },
    attachBtnText: {
      fontFamily: fonts.displayBold,
      color: c.accent,
      fontSize: font.size.sm,
      letterSpacing: 1,
    },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    fileName: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
      flex: 1,
    },
    primaryBtn: {
      backgroundColor: c.accent,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      height: 52,
      marginTop: space.sm,
      ...shadow.card,
    },
    primaryBtnText: {
      fontFamily: fonts.displayBold,
      color: c.textOnAccent,
      fontSize: font.size.sm,
      letterSpacing: 1,
    },
    note: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textSubtle,
      lineHeight: 16,
      marginTop: 2,
    },
    errorText: { fontFamily: fonts.display, color: c.danger, fontSize: font.size.sm },
  });
