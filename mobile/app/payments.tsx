import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createOrder,
  formatInr,
  getPlans,
  getWallet,
  verifyPayment,
  type PaymentPurpose,
  type PlansResponse,
  type WalletResponse,
} from '@/api/billing';
import { useAuth } from '@/auth/AuthContext';
import {
  CheckoutCancelledError,
  RazorpayUnavailableError,
  openCheckout,
} from '@/payments/razorpay';
import { useStyles, useThemeColors } from '@/theme/ThemeContext';
import { fonts } from '@/theme/fonts';
import { font, radii, radiusXl2, shadow, space, type ThemeColors } from '@/theme/tokens';

const TOPUP_PRESETS_INR = [100, 250, 500, 1000];

export default function PaymentsScreen() {
  const router = useRouter();
  const { user, getIdToken } = useAuth();
  const c = useThemeColors();
  const styles = useStyles(makeStyles);

  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState<string | null>(null); // purpose being paid
  const [error, setError] = useState<string | null>(null);
  const [topupInr, setTopupInr] = useState<number>(500);
  const [customTopup, setCustomTopup] = useState('');

  const load = useCallback(async () => {
    try {
      const token = await getIdToken();
      const [w, p] = await Promise.all([getWallet(token), getPlans(token)]);
      setWallet(w);
      setPlans(p);
      setError(null);
    } catch (e) {
      const err = e as { status?: number; code?: string | null };
      if (err.code === 'otp_verification_required') {
        // Session needs OTP re-verification — send them to the OTP screen.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.replace('/(auth)/otp' as any);
        return;
      }
      setError(
        err.status === 403
          ? 'Only the primary doctor (owner) account can view and manage payments.'
          : e instanceof Error
            ? e.message
            : 'Failed to load billing info',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getIdToken, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = useCallback(
    async (purpose: PaymentPurpose, label: string, amountInr?: number) => {
      if (paying) return;
      setError(null);
      setPaying(purpose);
      try {
        const token = await getIdToken();
        const order = await createOrder(token, purpose, amountInr);
        const result = await openCheckout({
          keyId: order.key_id,
          orderId: order.order_id,
          amountPaise: order.amount_paise,
          currency: order.currency,
          name: 'SoapNotesAi',
          description: label,
          prefillEmail: user?.email ?? undefined,
          themeColor: c.accent,
        });
        const verified = await verifyPayment(token, result);
        setWallet((prev) =>
          prev
            ? {
                ...prev,
                balance_paise: verified.wallet_balance_paise,
                subscription: verified.subscription,
              }
            : prev,
        );
        Alert.alert('Payment successful', `${label} — completed.`);
        void load();
      } catch (e) {
        if (e instanceof CheckoutCancelledError) {
          // user closed the sheet — not an error worth showing
        } else if (e instanceof RazorpayUnavailableError) {
          Alert.alert(
            'Development build required',
            'Payments use the Razorpay native SDK, which is not available inside Expo Go. Install the dev/release build of the app to pay.',
          );
        } else {
          setError(e instanceof Error ? e.message : 'Payment failed');
        }
      } finally {
        setPaying(null);
      }
    },
    [c.accent, getIdToken, load, paying, user?.email],
  );

  const sub = wallet?.subscription;
  const effectiveTopup = customTopup ? Number(customTopup) : topupInr;
  const customValid = !customTopup || (Number.isFinite(Number(customTopup)) && Number(customTopup) >= 50 && Number(customTopup) <= 50000);

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
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={c.accent}
          />
        }
      >
        <Text style={styles.pageTitle}>Payments</Text>

        {loading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Wallet — premium hero */}
            <View style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>Wallet balance</Text>
              <Text style={styles.balance}>{formatInr(wallet?.balance_paise ?? 0)}</Text>
              <Text style={styles.heroHint}>
                Prepaid balance. Pay-per-note generation costs{' '}
                {plans ? formatInr(plans.per_note_paise) : '₹5'} per note.
              </Text>

              <View style={styles.heroDivider} />

              <Text style={styles.eyebrow}>Add money</Text>
              <View style={styles.presetRow}>
                {TOPUP_PRESETS_INR.map((amt) => {
                  const active = !customTopup && topupInr === amt;
                  return (
                    <Pressable
                      key={amt}
                      onPress={() => {
                        setTopupInr(amt);
                        setCustomTopup('');
                      }}
                      style={({ pressed }) => [
                        styles.presetBtn,
                        active && styles.presetBtnActive,
                        pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                      ]}
                    >
                      <Text style={[styles.presetText, active && styles.presetTextActive]}>
                        ₹{amt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                style={styles.customInput}
                placeholder="Custom amount (₹50 – ₹50,000)"
                placeholderTextColor={c.textSubtle}
                keyboardType="number-pad"
                value={customTopup}
                onChangeText={setCustomTopup}
              />
              {!customValid ? (
                <Text style={styles.errorTextSm}>Enter an amount between ₹50 and ₹50,000</Text>
              ) : null}
              <Pressable
                onPress={() => void pay('wallet_topup', `Wallet top-up ₹${effectiveTopup}`, effectiveTopup)}
                disabled={paying !== null || !customValid || !effectiveTopup}
                style={({ pressed }) => [
                  styles.payBtn,
                  (paying !== null || !customValid) && { opacity: 0.5 },
                  pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                ]}
              >
                {paying === 'wallet_topup' ? (
                  <ActivityIndicator color={c.textOnAccent} />
                ) : (
                  <Text style={styles.payBtnText}>ADD ₹{effectiveTopup || 0} TO WALLET</Text>
                )}
              </Pressable>
            </View>

            {/* Joining fee / trial */}
            {sub && !sub.joining_fee_paid && plans ? (
              <View style={styles.card}>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>Get started</Text>
                </View>
                <Text style={styles.planName}>Joining fee — {formatInr(plans.joining_fee_paise)}</Text>
                <Text style={styles.hint}>
                  One-time fee. Includes a {plans.trial_days}-day free trial, account
                  verification, and letterhead + digital signature setup.
                </Text>
                <Pressable
                  onPress={() => void pay('joining_fee', 'Joining fee')}
                  disabled={paying !== null}
                  style={({ pressed }) => [
                    styles.payBtn,
                    paying !== null && { opacity: 0.5 },
                    pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                  ]}
                >
                  {paying === 'joining_fee' ? (
                    <ActivityIndicator color={c.textOnAccent} />
                  ) : (
                    <Text style={styles.payBtnText}>PAY JOINING FEE</Text>
                  )}
                </Pressable>
              </View>
            ) : null}

            {/* Current subscription */}
            {sub ? (
              <View style={styles.card}>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>Current plan</Text>
                </View>
                <Text style={styles.planName}>
                  {sub.tier === 'none' ? 'No plan yet' : sub.tier.toUpperCase()}{' '}
                  <Text style={styles.planStatus}>({sub.status})</Text>
                </Text>
                {sub.current_period_end ? (
                  <Text style={styles.hint}>
                    Renews / expires {new Date(sub.current_period_end).toLocaleDateString()}
                  </Text>
                ) : null}
                {sub.status === 'trial' && sub.trial_ends_at ? (
                  <Text style={styles.hint}>
                    Free trial until {new Date(sub.trial_ends_at).toLocaleDateString()}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Plans */}
            {plans?.plans.map((plan) => (
              <View key={plan.id} style={styles.card}>
                <View style={styles.planHeader}>
                  <View style={styles.tagPill}>
                    <Text style={styles.tagPillText}>{plan.badge}</Text>
                  </View>
                  <Text style={styles.planPrice}>{plan.price_label}</Text>
                </View>
                <Text style={styles.planName}>{plan.name}</Text>
                {plan.limit_label ? <Text style={styles.hint}>{plan.limit_label}</Text> : null}
                <Text style={styles.hint}>{plan.backup}</Text>
                <View style={styles.featureList}>
                  {plan.features.map((f) => (
                    <View key={f} style={styles.featureRow}>
                      <View style={styles.featureTick}>
                        <Feather name="check" size={12} color={c.accent} />
                      </View>
                      <Text style={styles.featureText}>{f}</Text>
                    </View>
                  ))}
                </View>
                {plan.amount_paise != null ? (
                  <Pressable
                    onPress={() =>
                      void pay(
                        plan.id === 'standard' ? 'subscription_standard' : 'subscription_premium',
                        `${plan.name} subscription`,
                      )
                    }
                    disabled={paying !== null}
                    style={({ pressed }) => [
                      styles.payBtn,
                      paying !== null && { opacity: 0.5 },
                      pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                    ]}
                  >
                    {paying ===
                    (plan.id === 'standard' ? 'subscription_standard' : 'subscription_premium') ? (
                      <ActivityIndicator color={c.textOnAccent} />
                    ) : (
                      <Text style={styles.payBtnText}>
                        SUBSCRIBE — {formatInr(plan.amount_paise)}/MO
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            ))}

            {/* Recent transactions */}
            {wallet && wallet.transactions.length > 0 ? (
              <View style={styles.card}>
                <View style={styles.tagPill}>
                  <Text style={styles.tagPillText}>Recent activity</Text>
                </View>
                {wallet.transactions.map((tx, i) => (
                  <View key={`${tx.created_at}-${i}`} style={styles.txRow}>
                    <View
                      style={[
                        styles.txIcon,
                        { backgroundColor: tx.type === 'credit' ? c.accentSoft : c.surfaceElevated },
                      ]}
                    >
                      <Feather
                        name={tx.type === 'credit' ? 'arrow-down-left' : 'arrow-up-right'}
                        size={15}
                        color={tx.type === 'credit' ? c.accent : c.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txReason}>{tx.reason.replace(/_/g, ' ')}</Text>
                      <Text style={styles.txDate}>
                        {new Date(tx.created_at).toLocaleString()}
                      </Text>
                    </View>
                    <Text style={styles.txAmount}>
                      {tx.type === 'credit' ? '+' : '−'}
                      {formatInr(tx.amount_paise)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Text style={styles.securedBy}>Payments secured by Razorpay</Text>
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

    // Standard card — soft-shadowed, borderless.
    card: {
      backgroundColor: c.surface,
      borderRadius: radii.xl,
      padding: space.lg,
      gap: space.sm,
      ...shadow.card,
    },

    // Premium wallet hero.
    heroCard: {
      backgroundColor: c.surface,
      borderRadius: radiusXl2,
      padding: space.lg,
      gap: space.sm,
      ...shadow.raised,
    },
    heroEyebrow: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs,
      color: c.textMuted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    heroHint: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
      lineHeight: 18,
    },
    heroDivider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: space.sm,
    },
    eyebrow: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.xs,
      color: c.textMuted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },

    tagPill: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 4,
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
    hint: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.textMuted,
      lineHeight: 18,
    },
    balance: {
      fontFamily: fonts.displayExtra,
      fontSize: font.size.hero,
      color: c.text,
      letterSpacing: -1.5,
      marginTop: 2,
    },
    presetRow: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
    presetBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radii.md,
      backgroundColor: c.surfaceElevated,
      ...shadow.sm,
    },
    presetBtnActive: { backgroundColor: c.accent },
    presetText: { fontFamily: fonts.displayBold, color: c.text, fontSize: font.size.base },
    presetTextActive: { color: c.textOnAccent },
    customInput: {
      borderRadius: radii.md,
      backgroundColor: c.surfaceElevated,
      color: c.text,
      fontFamily: fonts.display,
      fontSize: font.size.base,
      paddingHorizontal: space.md,
      paddingVertical: 14,
      marginTop: 4,
      ...shadow.sm,
    },
    payBtn: {
      backgroundColor: c.accent,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      height: 52,
      marginTop: space.sm,
      ...shadow.card,
    },
    payBtnText: {
      fontFamily: fonts.displayBold,
      color: c.textOnAccent,
      fontSize: font.size.sm,
      letterSpacing: 1,
    },
    planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    planName: {
      fontFamily: fonts.displayBold,
      fontSize: font.size.lg,
      color: c.text,
      letterSpacing: -0.3,
      marginTop: 4,
    },
    planStatus: { fontFamily: fonts.display, fontSize: font.size.sm, color: c.textMuted },
    planPrice: { fontFamily: fonts.displayBold, fontSize: font.size.base, color: c.accent },
    featureList: { gap: 8, marginTop: 6 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    featureTick: {
      width: 20,
      height: 20,
      borderRadius: radii.pill,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureText: {
      fontFamily: fonts.display,
      fontSize: font.size.sm,
      color: c.text,
      flex: 1,
      lineHeight: 18,
    },
    txRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    txIcon: {
      width: 34,
      height: 34,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    txReason: {
      fontFamily: fonts.displaySemi,
      fontSize: font.size.sm,
      color: c.text,
      textTransform: 'capitalize',
    },
    txDate: { fontFamily: fonts.display, fontSize: font.size.xs, color: c.textSubtle, marginTop: 1 },
    txAmount: { fontFamily: fonts.displayBold, fontSize: font.size.sm, color: c.text },
    errorText: { fontFamily: fonts.display, color: c.danger, fontSize: font.size.sm },
    errorTextSm: { fontFamily: fonts.display, color: c.danger, fontSize: font.size.xs },
    securedBy: {
      fontFamily: fonts.display,
      fontSize: font.size.xs,
      color: c.textSubtle,
      textAlign: 'center',
      marginTop: 4,
    },
  });
