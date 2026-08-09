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
  getLetterhead,
  updateLetterhead,
  LetterheadError,
  type LetterheadResponse,
  type UpdateLetterheadParams,
} from '@/api/letterhead';
import { useAuth } from '@/auth/AuthContext';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, space, type ThemeColors } from '@/theme/tokens';

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5MB

interface PickedLogo {
  uri: string;
  name: string;
  mimeType: string;
}

interface FormValues {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
}

function toFormValues(data: LetterheadResponse): FormValues {
  const lh = data.letterhead;
  return {
    name: lh.name ?? '',
    tagline: lh.tagline ?? '',
    address: lh.address_lines.join('\n'),
    phone: lh.phone ?? '',
    email: lh.email ?? '',
  };
}

function saveErrorMessage(e: unknown): string {
  if (e instanceof LetterheadError) {
    if (e.status === 402 || e.code === 'insufficient_wallet_balance') {
      return 'Not enough wallet balance for the change fee — top up in Payments & Plans.';
    }
    if (e.status === 403 || e.code === 'owner_required') {
      return 'Only the primary doctor (owner) account can change the letterhead.';
    }
    if (e.status === 415 || e.code === 'logo_must_be_png_or_jpeg') {
      return 'The logo must be a PNG or JPEG image.';
    }
    if (e.status === 413 || e.code === 'logo_too_large') {
      return 'The logo is too large — it must be 5MB or less.';
    }
  }
  return e instanceof Error ? e.message : 'Failed to save letterhead';
}

export default function LetterheadScreen() {
  const router = useRouter();
  const { getIdToken } = useAuth();
  const c = useThemeColors();
  const styles = useStyles(makeStyles);

  const [data, setData] = useState<LetterheadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<FormValues>({
    name: '',
    tagline: '',
    address: '',
    phone: '',
    email: '',
  });
  const [initial, setInitial] = useState<FormValues | null>(null);
  const [logo, setLogo] = useState<PickedLogo | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getIdToken();
      const res = await getLetterhead(token);
      setData(res);
      const form = toFormValues(res);
      setValues(form);
      setInitial(form);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load letterhead');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = useCallback((key: keyof FormValues, value: string) => {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const pickLogo = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/png', 'image/jpeg'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    if (asset.size != null && asset.size > MAX_LOGO_BYTES) {
      setError('The logo is too large — it must be 5MB or less.');
      return;
    }
    setError(null);
    setSaved(false);
    setLogo({
      uri: asset.uri,
      name: asset.name ?? 'logo',
      mimeType: asset.mimeType ?? 'image/png',
    });
  }, []);

  // Only send the fields the user actually changed.
  const changedFields = (): UpdateLetterheadParams => {
    const params: UpdateLetterheadParams = {};
    if (!initial || values.name !== initial.name) params.name = values.name.trim();
    if (!initial || values.tagline !== initial.tagline) params.tagline = values.tagline.trim();
    if (!initial || values.address !== initial.address) params.address = values.address.trim();
    if (!initial || values.phone !== initial.phone) params.phone = values.phone.trim();
    if (!initial || values.email !== initial.email) params.email = values.email.trim();
    if (logo) {
      params.logoUri = logo.uri;
      params.logoMimeType = logo.mimeType;
    }
    return params;
  };

  const hasChanges = Object.keys(changedFields()).length > 0;

  const save = useCallback(async () => {
    if (saving) return;
    const params = changedFields();
    if (Object.keys(params).length === 0) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const token = await getIdToken();
      const res = await updateLetterhead(token, params);
      setData(res);
      const form = toFormValues(res);
      setValues(form);
      setInitial(form);
      setLogo(null);
      setSaved(true);
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getIdToken, initial, logo, saving, values]);

  const feeRupees = data ? data.next_change_fee_paise / 100 : 0;

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
        <Text style={styles.pageTitle}>Letterhead</Text>

        {loading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Fee banner */}
            {data ? (
              data.change_count === 0 ? (
                <View style={[styles.feeBanner, styles.feeBannerFree]}>
                  <Feather name="gift" size={16} color={c.success} />
                  <Text style={[styles.feeBannerText, { color: c.success }]}>
                    First letterhead setup is FREE
                  </Text>
                </View>
              ) : (
                <View style={styles.feeBanner}>
                  <Feather name="info" size={16} color={c.accent} />
                  <Text style={styles.feeBannerText}>
                    Each letterhead change costs ₹{feeRupees}, deducted from your wallet
                  </Text>
                </View>
              )
            ) : null}

            <View style={styles.card}>
              <View style={styles.tagPill}>
                <Text style={styles.tagPillText}>Clinic branding</Text>
              </View>
              <Text style={styles.hint}>
                These details are printed at the top of every SOAP-note PDF.
              </Text>

              <Text style={styles.label}>CLINIC NAME</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Sunrise Physiotherapy Clinic"
                placeholderTextColor={c.textSubtle}
                value={values.name}
                onChangeText={(t) => setField('name', t)}
                autoCapitalize="words"
              />

              <Text style={styles.label}>TAGLINE</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Movement is medicine"
                placeholderTextColor={c.textSubtle}
                value={values.tagline}
                onChangeText={(t) => setField('tagline', t)}
                autoCapitalize="sentences"
              />

              <Text style={styles.label}>ADDRESS</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder={'Street\nCity, State\nPIN code'}
                placeholderTextColor={c.textSubtle}
                value={values.address}
                onChangeText={(t) => setField('address', t)}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              <Text style={styles.label}>PHONE</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. +91 98765 43210"
                placeholderTextColor={c.textSubtle}
                value={values.phone}
                onChangeText={(t) => setField('phone', t)}
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>EMAIL</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. clinic@example.com"
                placeholderTextColor={c.textSubtle}
                value={values.email}
                onChangeText={(t) => setField('email', t)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable
                onPress={() => void pickLogo()}
                style={({ pressed }) => [styles.attachBtn, { opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Choose logo image"
              >
                <Feather name="image" size={16} color={c.accent} />
                <Text style={styles.attachBtnText}>CHOOSE LOGO (PNG/JPG)</Text>
              </Pressable>
              {logo ? (
                <View style={styles.fileRow}>
                  <Feather name="file" size={14} color={c.textMuted} />
                  <Text style={styles.fileName} numberOfLines={1}>
                    {logo.name}
                  </Text>
                </View>
              ) : data?.has_logo ? (
                <View style={styles.fileRow}>
                  <Feather name="check-circle" size={14} color={c.success} />
                  <Text style={styles.fileName}>Logo already uploaded</Text>
                </View>
              ) : null}
              <Text style={styles.note}>Logo prints at the top of every PDF</Text>

              <Pressable
                onPress={() => void save()}
                disabled={saving || !hasChanges}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { opacity: saving || !hasChanges ? 0.5 : pressed ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save letterhead"
              >
                {saving ? (
                  <ActivityIndicator color={c.textOnAccent} />
                ) : (
                  <Text style={styles.primaryBtnText}>SAVE LETTERHEAD</Text>
                )}
              </Pressable>

              {saved ? (
                <View style={styles.fileRow}>
                  <Feather name="check" size={14} color={c.success} />
                  <Text style={[styles.fileName, { color: c.success }]}>Letterhead saved</Text>
                </View>
              ) : null}
            </View>

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
    scroll: { padding: space.lg, gap: space.lg, paddingBottom: 60 },
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
    },
    feeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentDim,
      borderRadius: radii.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm + 2,
    },
    feeBannerFree: {
      backgroundColor: c.successSoft,
      borderColor: c.success,
    },
    feeBannerText: {
      flex: 1,
      fontFamily: fonts.displaySemi,
      fontSize: font.size.sm,
      color: c.accent,
      lineHeight: 18,
    },
    card: {
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
    label: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs - 1,
      color: c.textMuted,
      letterSpacing: 0.8,
      marginTop: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      backgroundColor: c.surfaceElevated,
      color: c.text,
      fontFamily: fonts.display,
      fontSize: font.size.base,
      paddingHorizontal: space.md,
      paddingVertical: 10,
    },
    inputMultiline: {
      minHeight: 84,
      paddingTop: 10,
    },
    attachBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: c.accentDim,
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
    note: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textSubtle,
      lineHeight: 16,
      marginTop: 2,
    },
    primaryBtn: {
      backgroundColor: c.accent,
      borderRadius: radii.md,
      alignItems: 'center',
      paddingVertical: space.md,
      marginTop: 6,
    },
    primaryBtnText: {
      fontFamily: fonts.displayBold,
      color: c.textOnAccent,
      fontSize: font.size.sm,
      letterSpacing: 1,
    },
    errorText: { fontFamily: fonts.display, color: c.danger, fontSize: font.size.sm },
  });
