import React, { useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Banner, Btn, Card, Divider, Empty, Field, Loading, Row, Screen, SectionTitle, Segmented, Txt } from '@/components/ui';
import { formatTime, t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { spacing } from '@/theme';

/** Account, sync status, conflicts, guest-data merge, sign out and account deletion. Only reachable when a backend is configured. */
export default function Account() {
  const app = useApp();
  const { toast, confirm } = useFeedback();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delPw, setDelPw] = useState('');
  const { data: conflicts } = useLive((a) => a.db.all<{ id: string; tbl: string; row_id: string; local_data: string; remote_data: string }>('SELECT * FROM conflicts ORDER BY created_at'), ['conflicts', 'outbox']);
  const { cloud, sync } = app;

  if (!cloud.enabled) return <Screen title={t('account.title')} back><Empty icon="cloud-offline-outline" title={t('account.localOnly')} body={t('account.localOnlyBody')} /></Screen>;

  if (!cloud.userId) {
    return (
      <Screen testID="account-signin" title={t('account.title')} back>
        <Txt tone="textMuted">{t('account.why')}</Txt>
        <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
          <Segmented label={t('account.mode')} value={mode} onChange={setMode} options={[{ value: 'in', label: t('account.signIn') }, { value: 'up', label: t('account.signUp') }]} />
          <Field label={t('account.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
          <Field label={t('account.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'in' ? 'current-password' : 'new-password'} textContentType={mode === 'in' ? 'password' : 'newPassword'} hint={mode === 'up' ? t('account.passwordHint') : undefined} />
          {err ? <Banner tone="danger" icon="alert-circle-outline" text={err} /> : null}
          <Btn title={mode === 'in' ? t('account.signIn') : t('account.signUp')} loading={busy} disabled={!email.trim() || password.length < (mode === 'up' ? 8 : 1)} onPress={async () => {
            setBusy(true);
            setErr(null);
            const r = mode === 'in' ? await cloud.signIn(email, password) : await cloud.signUp(email, password);
            setBusy(false);
            if (r === 'confirm_email') toast({ message: t('account.confirmEmail') });
            else if (r) setErr(t('account.failed', { reason: r }));
          }} />
          <Txt variant="caption" tone="textMuted">{t('account.guestNote')}</Txt>
        </View>
      </Screen>
    );
  }

  const st = sync.status;
  return (
    <Screen testID="account" title={t('account.title')} subtitle={cloud.email ?? undefined} back>
      {cloud.guestRowsToMerge > 0 ? (
        <Card style={{ gap: spacing.sm, marginBottom: spacing.md }}>
          <Txt variant="headline">{t('merge.title')}</Txt>
          <Txt>{t('merge.body', { count: cloud.guestRowsToMerge })}</Txt>
          <Row wrap>
            <Btn testID="merge-yes" title={t('merge.yes')} onPress={async () => { await cloud.mergeGuest(true); toast({ message: t('merge.done') }); void sync.run(); }} />
            <Btn variant="outline" title={t('merge.no')} onPress={() => void cloud.mergeGuest(false)} />
          </Row>
          <Txt variant="caption" tone="textMuted">{t('merge.note')}</Txt>
        </Card>
      ) : null}
      <SectionTitle>{t('sync.title')}</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        {!st ? <Loading /> : (
          <>
            <Txt>{st.pending ? t('sync.pending', { count: st.pending }) : t('sync.upToDate')}</Txt>
            <Txt variant="caption" tone="textMuted">{st.lastSyncAt ? t('sync.last', { time: formatTime(st.lastSyncAt, app.tz) }) : t('sync.never')}</Txt>
            {st.lastError === 'network' ? <Banner tone="warning" icon="cloud-offline-outline" text={t('sync.offline')} /> : null}
            {st.lastError === 'auth' ? <Banner tone="danger" icon="key-outline" text={t('sync.authExpired')} /> : null}
            {st.lastError === 'server' ? <Banner tone="danger" icon="alert-circle-outline" text={t('sync.serverError')} /> : null}
            {st.failed > 0 || st.stuck > 0 ? <Banner tone="danger" icon="alert-circle-outline" text={t('sync.failedOps', { count: st.failed + st.stuck })} /> : null}
            <Row wrap>
              <Btn testID="sync-now" variant="secondary" icon="sync-outline" title={t('sync.now')} onPress={async () => { await app.engine?.retryFailed(); const r = await sync.run(); toast({ message: r?.stopped ? t('sync.stopped') : t('sync.done') }); }} />
            </Row>
          </>
        )}
      </Card>
      {conflicts && conflicts.length ? (
        <>
          <SectionTitle>{t('sync.conflicts')}</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Txt variant="caption" tone="textMuted">{t('sync.conflictsBody')}</Txt>
            {conflicts.map((c, i) => (
              <View key={c.id} style={{ gap: spacing.xs }}>
                {i > 0 ? <Divider /> : null}
                <Txt variant="bodyStrong">{t('sync.conflictItem', { table: c.tbl })}</Txt>
                <Txt variant="caption" tone="textMuted">{t('sync.mine')}: {summarize(c.local_data)}</Txt>
                <Txt variant="caption" tone="textMuted">{t('sync.theirs')}: {summarize(c.remote_data)}</Txt>
                <Row wrap>
                  <Btn size="sm" title={t('sync.keepMine')} onPress={async () => { await app.engine?.resolveConflict(c.id, 'mine'); void sync.run(); }} />
                  <Btn size="sm" variant="outline" title={t('sync.keepTheirs')} onPress={async () => { await app.engine?.resolveConflict(c.id, 'theirs'); void sync.run(); }} />
                </Row>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <SectionTitle>{t('account.signOut')}</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <Txt variant="caption" tone="textMuted">{st && st.pending ? t('account.signOutPending', { count: st.pending }) : t('account.signOutBody')}</Txt>
        <Btn variant="outline" title={t('account.signOutKeep')} onPress={() => void cloud.signOut(false)} />
        <Btn variant="outline" title={t('account.signOutRemove')} onPress={async () => { if (await confirm({ title: t('account.signOutRemove'), message: t('account.signOutRemoveBody'), destructive: true })) await cloud.signOut(true); }} />
      </Card>
      <SectionTitle>{t('account.delete')}</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <Txt>{t('account.deleteBody')}</Txt>
        <Field label={t('account.passwordConfirm')} value={delPw} onChangeText={setDelPw} secureTextEntry autoComplete="current-password" />
        <Btn variant="danger" title={t('account.delete')} disabled={!delPw} loading={busy} onPress={async () => {
          if (!(await confirm({ title: t('account.deleteConfirm'), message: t('account.deleteConfirmBody'), destructive: true, confirmLabel: t('account.delete') }))) return;
          setBusy(true);
          const r = await cloud.deleteAccount(delPw);
          setBusy(false);
          toast(r ? { message: t('account.deleteFailed', { reason: r }), tone: 'error' } : { message: t('account.deleted') });
        }} />
      </Card>
    </Screen>
  );
}

function summarize(json: string): string {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    return Object.entries(o).filter(([k]) => !['id', 'created_at', 'updated_at', 'rev', 'deleted_at', 'snapshot', 'doc'].includes(k)).slice(0, 5).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
  } catch {
    return '';
  }
}
