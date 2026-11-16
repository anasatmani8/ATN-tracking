import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Banner, Btn, Card, Field, Loading, Row, Screen, Txt } from '@/components/ui';
import { configuredProvider } from '@/data/barcode-config';
import type { LookupResult } from '@/data/barcode';
import type { LogInput } from '@/data/nutrition';
import { newId } from '@/data/store';
import { createScanDebouncer, isValidBarcode } from '@/domain/nutrition';
import { t, type StringKey } from '@/i18n';
import { useApp } from '@/state/app';
import { errorText } from '@/state/hooks';
import { PortionForm } from '@/screens/nutrition/portion-sheet';
import { radius, spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

type State =
  | { kind: 'idle' }
  | { kind: 'looking'; code: string }
  | { kind: 'found'; code: string; item: LogInput; foodId: string | null; providerResult: Extract<LookupResult, { status: 'found' }> | null }
  | { kind: 'problem'; code: string; status: Exclude<LookupResult['status'], 'found'> };

/**
 * Barcode lookup. Local foods first, then the configured provider. Every failure
 * (camera denied, unknown code, offline, throttled, timeout) leads to manual entry.
 * Nothing is saved until the product and serving are confirmed.
 */
export default function Scan() {
  const p = useLocalSearchParams<{ date?: string; slot?: string; mode?: 'log' | 'plan' }>();
  const app = useApp();
  const router = useRouter();
  const { toast } = useFeedback();
  const provider = useMemo(() => configuredProvider(), []);
  const [perm, requestPerm] = useCameraPermissions();
  const [cameraOn, setCameraOn] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const debouncer = useRef(createScanDebouncer()).current;
  const opId = useRef(newId());
  const date = p.date ?? app.today;
  const mode = p.mode === 'plan' ? 'plan' : 'log';
  const native = Platform.OS !== 'web';

  const lookup = async (raw: string) => {
    const code = raw.trim();
    if (!isValidBarcode(code)) {
      setState({ kind: 'problem', code, status: 'invalid' });
      debouncer.release();
      return;
    }
    setCameraOn(false);
    setState({ kind: 'looking', code });
    try {
      const local = await app.nutrition.findByBarcode(code);
      if (local) {
        const s = local.snapshot;
        setState({ kind: 'found', code, foodId: local.id, providerResult: null, item: { name: local.brand ? `${local.name} (${local.brand})` : local.name, sourceKind: 'barcode', sourceId: local.id, snapshot: s, qty: s.basis === 'per_serving' ? 1 : (s.servingG ?? s.servingMl ?? 100), unit: s.basis === 'per_serving' ? 'serving' : s.basis === 'per_100ml' ? 'ml' : 'g' } });
        return;
      }
      const r = await provider.lookup(code);
      if (r.status === 'found') {
        const s = r.snapshot;
        setState({ kind: 'found', code, foodId: null, providerResult: r, item: { name: r.brand ? `${r.name} (${r.brand})` : r.name, sourceKind: 'barcode', sourceId: null, snapshot: s, qty: s.servingG ?? s.servingMl ?? 100, unit: s.basis === 'per_100ml' ? 'ml' : 'g' } });
      } else setState({ kind: 'problem', code, status: r.status });
    } finally {
      debouncer.release();
    }
  };

  const onScanned = ({ data }: { data: string }) => {
    if (!debouncer.accept(data)) return;
    void lookup(data);
  };

  const openCamera = async () => {
    const r = perm?.granted ? perm : await requestPerm();
    if (r?.granted) setCameraOn(true);
  };

  const confirm = async (qty: number, unit: LogInput['unit'], slot: string) => {
    if (state.kind !== 'found') return;
    try {
      let foodId = state.foodId;
      // Save provider data as your own food so the next scan works offline.
      if (!foodId && state.providerResult) foodId = await app.nutrition.saveFood({ name: state.providerResult.name, brand: state.providerResult.brand, barcode: state.code, snapshot: state.providerResult.snapshot });
      const item = { ...state.item, sourceId: foodId, qty, unit };
      if (mode === 'plan') await app.nutrition.plan(date, slot, item);
      else await app.nutrition.log(date, slot, item, nowMs(), app.tz, opId.current);
      toast({ message: mode === 'plan' ? t('nutrition.planAdd') : t('nutrition.loggedToast', { name: item.name, slot }) });
      router.back();
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  };

  const denied = perm && !perm.granted && !perm.canAskAgain;
  return (
    <Screen testID="scan" title={t('scan.title')} back>
      <View style={{ gap: spacing.md }}>
        {state.kind === 'found' ? (
          <Card testID="scan-found" style={{ gap: spacing.md }}>
            <Txt variant="overline" tone="textMuted">{t('scan.confirmProduct')}</Txt>
            <Txt variant="headline">{state.item.name}</Txt>
            <Txt variant="caption" tone="textMuted">{t('scan.code', { code: state.code })}</Txt>
            {state.providerResult ? <Txt variant="caption" tone="textMuted">{provider.attribution}</Txt> : null}
            <PortionForm item={state.item} slot={p.slot} confirmLabel={mode === 'plan' ? t('nutrition.planAdd') : t('nutrition.logIt')} onConfirm={confirm} />
            <Btn variant="ghost" title={t('scan.notThis')} onPress={() => router.replace(`/nutrition/food?barcode=${state.code}`)} />
          </Card>
        ) : state.kind === 'looking' ? (
          <Card><Loading /><Txt tone="textMuted" style={{ textAlign: 'center' }}>{t('scan.looking', { code: state.code })}</Txt></Card>
        ) : (
          <>
            {state.kind === 'problem' ? (
              <Card testID="scan-problem" style={{ gap: spacing.sm }}>
                <Banner tone={state.status === 'not_found' || state.status === 'disabled' ? 'info' : 'warning'} icon="alert-circle-outline" text={t(`scan.status.${state.status}` as StringKey, { code: state.code })} />
                <Row wrap>
                  {state.status !== 'invalid' ? <Btn testID="scan-manual" title={t('scan.createWithCode')} onPress={() => router.replace(`/nutrition/food?barcode=${state.code}`)} /> : null}
                  {['network', 'timeout', 'throttled'].includes(state.status) ? <Btn variant="outline" title={t('common.retry')} onPress={() => void lookup(state.code)} /> : null}
                  <Btn variant="ghost" title={t('scan.searchInstead')} onPress={() => router.back()} />
                </Row>
              </Card>
            ) : null}
            {native ? (
              cameraOn ? (
                <View style={{ borderRadius: radius.lg, overflow: 'hidden', height: 320 }}>
                  <CameraView style={{ flex: 1 }} facing="back" onBarcodeScanned={onScanned} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14'] }} accessibilityLabel={t('scan.cameraA11y')} />
                </View>
              ) : (
                <Card style={{ gap: spacing.sm }}>
                  <Txt>{t('scan.why')}</Txt>
                  {denied ? (
                    <>
                      <Banner tone="warning" icon="camera-outline" text={t('scan.denied')} />
                      <Btn variant="outline" title={t('common.openSettings')} onPress={() => void Linking.openSettings()} />
                    </>
                  ) : <Btn testID="scan-open-camera" icon="camera-outline" title={t('scan.openCamera')} onPress={() => void openCamera()} />}
                  {perm && !perm.granted && perm.canAskAgain && perm.status === 'denied' ? <Txt variant="caption" tone="textMuted">{t('scan.deniedOnce')}</Txt> : null}
                </Card>
              )
            ) : <Banner icon="information-circle-outline" text={t('scan.webOnly')} />}
            <Card style={{ gap: spacing.sm }}>
              <Field testID="scan-typed" label={t('scan.typeCode')} value={typed} onChangeText={setTyped} keyboardType="number-pad" maxLength={14} hint={t('scan.typeHint')} />
              <Btn testID="scan-lookup" variant="secondary" title={t('scan.lookup')} disabled={typed.trim().length < 8} onPress={() => void lookup(typed)} />
            </Card>
            {provider.id === 'off' ? <Txt variant="caption" tone="textMuted">{t('scan.localOnly')}</Txt> : <Txt variant="caption" tone="textMuted">{t('scan.providerNote')}</Txt>}
          </>
        )}
      </View>
    </Screen>
  );
}
