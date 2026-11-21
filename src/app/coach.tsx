import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Banner, Btn, Card, Empty, IconBtn, ListItem, Loading, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import { contextLine, type CoachConfig } from '@/coach/contract';
import { CoachEngine, type EngineEvent } from '@/coach/engine';
import { CoachError } from '@/coach/transport';
import type { CoachAction, CoachMessage } from '@/data/coach';
import { nowMs } from '@/domain/clock';
import { t, weekdayName, type StringKey } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { weekdayOf } from '@/domain/time';
import { InsightCard } from '@/screens/coach/insight-card';
import { ProposalCard } from '@/screens/coach/proposal-card';
import { radius, spacing, TOUCH, type } from '@/theme';
import { cloudEnabled } from '@/sync/cloud';

const DATA_TABLES = ['sessions', 'session_sets', 'scheduled_workouts', 'programs', 'water_logs', 'sleep_logs', 'checkins', 'reminders', 'prefs', 'progression_decisions'];

type TimelineItem = { at: number; seq: number; kind: 'msg'; msg: CoachMessage } | { at: number; seq: number; kind: 'action'; action: CoachAction };

function errorMessage(e: unknown): string {
  if (e instanceof CoachError) {
    switch (e.code) {
      case 'rate_limited': return t('coach.err.rate', { min: Math.max(1, Math.ceil((e.retryAfterSec ?? 60) / 60)) });
      case 'network': return t('coach.err.offline');
      case 'timeout': return t('coach.err.timeout');
      case 'unauthorized': return t('coach.err.signin');
      case 'not_configured': return t('coach.err.notConfigured');
      case 'invalid_request': return t('coach.err.invalid');
      default: return t('coach.err.unavailable');
    }
  }
  return t('coach.err.unavailable');
}

export default function CoachScreen() {
  const app = useApp();
  const { c } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confirm } = useFeedback();
  const scroll = useRef<ScrollViewInstance>(null);
  const [freshThread, setFreshThread] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetAction, setSheetAction] = useState<CoachAction | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [config, setConfig] = useState<CoachConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const transport = app.coachTransport;
  const { prefs } = app;
  const consented = !!prefs.coachConsent && (!config || prefs.coachConsent.provider === config.provider);

  const { data: insights } = useLive((a) => a.coach.insights(a.coachCtx()), DATA_TABLES);
  const { data: latest } = useLive((a) => a.coach.latestThread(), ['coach_threads']);
  const threadId = freshThread ? null : (latest?.id ?? null);
  const { data: messages } = useLive((a) => (threadId ? a.coach.listMessages(threadId) : Promise.resolve([] as CoachMessage[])), ['coach_messages'], [threadId]);
  const { data: actions } = useLive((a) => a.coach.listActions(200), ['coach_actions']);

  // Provider and model for the consent text; fetched only when chat is possible.
  useEffect(() => {
    if (!transport) return;
    let alive = true;
    transport.config().then((cfg) => alive && setConfig(cfg), (e) => alive && setConfigError(errorMessage(e)));
    return () => { alive = false; };
  }, [transport]);

  const timeline: TimelineItem[] = [
    ...(messages ?? []).filter((m) => m.role === 'user' || m.role === 'event' || (m.role === 'assistant' && m.display_text)).map((m) => ({ at: m.created_at, seq: m.seq, kind: 'msg' as const, msg: m })),
    ...(actions ?? []).filter((a) => a.thread_id === threadId && threadId != null).map((a) => ({ at: a.created_at, seq: 0.5, kind: 'action' as const, action: a })),
  ].sort((x, y) => x.at - y.at || x.seq - y.seq);
  // Assistant replies are stored once per round; show each distinct text once.
  const shown = timeline.filter((it, i) => !(it.kind === 'msg' && it.msg.role === 'assistant' && timeline.slice(i + 1).some((n) => n.kind === 'msg' && n.msg.role === 'assistant' && n.msg.display_text === it.msg.display_text)));
  const lastUser = [...(messages ?? [])].reverse().find((m) => m.role === 'user');

  const recordDecision = async (a: CoachAction, applied: boolean) => {
    if (!a.thread_id) return;
    const label = t(`coach.tool.${a.tool}` as StringKey);
    await app.coach.appendMessages(a.thread_id, [{ role: 'event', displayText: applied ? t('coach.event.applied', { what: label, subject: a.preview.subject }) : t('coach.event.declined', { what: label, subject: a.preview.subject }) }], nowMs());
  };

  const send = async () => {
    if (!transport || !text.trim() || sending) return;
    const message = text;
    setText('');
    setSending(true);
    setErrorText(null);
    setNotice(null);
    const onEvent = (e: EngineEvent) => {
      if (e.type === 'tool') setActivity(t(`coach.activity.${e.name}` as StringKey) === `coach.activity.${e.name}` ? t('coach.thinking') : t(`coach.activity.${e.name}` as StringKey));
      else setNotice(t(`coach.newThread.${e.reason}` as StringKey));
    };
    try {
      const ctx = app.coachCtx();
      const units = `${prefs.weightUnit}, ${prefs.volumeUnit === 'ml' ? 'mL' : 'fl oz'}, ${prefs.distanceUnit}`;
      const engine = new CoachEngine(app.coach, transport, app.coachCtx, onEvent);
      const r = await engine.send(threadId, message, contextLine({ today: ctx.today, weekday: weekdayName(weekdayOf(ctx.today), 'long'), timeZone: ctx.tz, units }));
      setFreshThread(false);
      if (r.stop === 'refused') setNotice(t('coach.refused'));
      else if (r.stop === 'truncated') setNotice(t('coach.truncated'));
      else if (r.stop === 'round_limit') setNotice(t('coach.roundLimit'));
    } catch (e) {
      setText(message); // keep what the user typed
      setErrorText(errorMessage(e));
    } finally {
      setSending(false);
      setActivity(null);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const chatBlocked = !cloudEnabled ? 'noServer' : !transport ? (app.isDemo ? 'demo' : 'signedOut') : !consented ? 'consent' : null;

  return (
    <Screen testID="coach-screen" title={t('coach.title')} back scroll={false} padded={false}
      right={<Row gap={0}>
        <IconBtn icon="list-outline" label={t('coach.changes')} onPress={() => setLogOpen(true)} testID="coach-changes" />
        {chatBlocked == null ? <IconBtn icon="create-outline" label={t('coach.newChat')} onPress={() => { setFreshThread(true); setNotice(null); setErrorText(null); }} testID="coach-new" /> : null}
      </Row>}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl, maxWidth: 640, width: '100%', alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <Txt variant="caption" tone="textMuted">{t('coach.disclaimer')}</Txt>

        <SectionTitle>{t('coach.insights')}</SectionTitle>
        {!insights ? <Loading /> : insights.length === 0 ? <Txt tone="textMuted">{t('coach.noInsights')}</Txt> : (
          insights.map((i, idx) => <InsightCard key={i.id} insight={i} testID={`insight-${idx}`} onProposed={setSheetAction} />)
        )}

        <SectionTitle>{t('coach.chat')}</SectionTitle>
        {chatBlocked === 'noServer' ? <Card><Txt tone="textMuted">{t('coach.chatNeedsServer')}</Txt></Card> : null}
        {chatBlocked === 'demo' ? <Card><Txt tone="textMuted">{t('coach.chatDemo')}</Txt></Card> : null}
        {chatBlocked === 'signedOut' ? (
          <Card style={{ gap: spacing.sm }}>
            <Txt>{t('coach.chatNeedsAccount')}</Txt>
            <Btn testID="coach-signin" title={t('account.signIn')} onPress={() => router.push('/settings/account')} />
          </Card>
        ) : null}
        {chatBlocked === 'consent' ? (
          <Card testID="coach-consent" style={{ gap: spacing.sm }}>
            <Txt variant="headline">{t('coach.consent.title')}</Txt>
            {config ? <Txt>{t('coach.consent.body', { provider: t(`coach.provider.${config.provider}` as StringKey), model: config.model })}</Txt> : configError ? <Banner tone="warning" text={configError} /> : <Loading />}
            <Txt variant="caption" tone="textMuted">{t('coach.consent.points')}</Txt>
            <Btn testID="coach-consent-agree" title={t('coach.consent.agree')} disabled={!config} onPress={() => config && void app.setPrefs({ coachConsent: { at: nowMs(), provider: config.provider } })} />
            <Btn variant="ghost" title={t('coach.consent.privacy')} onPress={() => router.push('/settings/privacy')} />
          </Card>
        ) : null}

        {chatBlocked == null ? (
          <>
            {shown.length === 0 ? <Empty icon="chatbubbles-outline" title={t('coach.empty.title')} body={t('coach.empty.body')} /> : null}
            {shown.map((it) => it.kind === 'action'
              ? <ProposalCard key={it.action.id} action={it.action} testID={`chat-proposal-${it.action.tool}`} onDecided={(a, applied) => void recordDecision(a, applied)} />
              : <Bubble key={it.msg.id} msg={it.msg} />)}
            {lastUser && lastUser.safety.length > 0 ? (
              <Banner tone="danger" icon="medkit-outline" text={t('coach.safetyBanner')} />
            ) : null}
            {sending ? <Txt testID="coach-activity" variant="caption" tone="textMuted" accessibilityLiveRegion="polite">{activity ?? t('coach.thinking')}</Txt> : null}
            {notice ? <Banner tone="info" icon="information-circle-outline" text={notice} /> : null}
            {errorText ? <Banner tone="warning" icon="cloud-offline-outline" text={errorText} /> : null}
          </>
        ) : null}
      </ScrollView>

      {chatBlocked == null ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: Math.max(insets.bottom, spacing.sm) }}>
          <Row style={{ maxWidth: 640, width: '100%', alignSelf: 'center', alignItems: 'flex-end' }}>
            <TextInput
              testID="coach-input"
              accessibilityLabel={t('coach.inputLabel')}
              placeholder={t('coach.placeholder')}
              placeholderTextColor={c.textFaint}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={2000}
              editable={!sending}
              style={[type.body, { flex: 1, minHeight: TOUCH, maxHeight: 140, color: c.text, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}
            />
            <IconBtn icon="arrow-up-circle" size={32} tone="primary" label={t('coach.send')} disabled={sending || !text.trim()} onPress={() => void send()} testID="coach-send" />
          </Row>
        </View>
      ) : null}

      <Sheet visible={!!sheetAction} onClose={() => setSheetAction(null)} title={t('coach.reviewChange')} testID="insight-proposal-sheet">
        {sheetAction ? <SheetProposal id={sheetAction.id} onDone={() => setSheetAction(null)} /> : null}
      </Sheet>

      <Sheet visible={logOpen} onClose={() => setLogOpen(false)} title={t('coach.changes')}>
        <Txt variant="caption" tone="textMuted">{t('coach.changesBody')}</Txt>
        {(actions ?? []).filter((a) => a.status !== 'proposed').length === 0 ? <Txt tone="textMuted">{t('coach.noChanges')}</Txt> : null}
        {(actions ?? []).filter((a) => a.status !== 'proposed').slice(0, 30).map((a) => <ProposalCard key={a.id} action={a} testID={`log-${a.tool}`} />)}
        <ListItem icon="trash-outline" destructive title={t('coach.deleteHistory')} onPress={async () => {
          if (await confirm({ title: t('coach.deleteHistory'), message: t('coach.deleteHistoryBody'), destructive: true, confirmLabel: t('common.delete') })) {
            await app.coach.deleteHistory();
            setLogOpen(false);
          }
        }} />
      </Sheet>
    </Screen>
  );
}

/** The proposal sheet follows the live row, so its status updates after Apply. */
function SheetProposal({ id, onDone }: { id: string; onDone: () => void }) {
  const { data } = useLive((a) => a.coach.getAction(id), ['coach_actions'], [id]);
  if (!data) return <Loading />;
  return <ProposalCard action={data} testID="sheet-proposal" onDecided={() => onDone()} />;
}

function Bubble({ msg }: { msg: CoachMessage }) {
  const { c } = useTheme();
  if (msg.role === 'event') return <Txt variant="caption" tone="textMuted" style={{ textAlign: 'center' }}>{msg.display_text}</Txt>;
  const mine = msg.role === 'user';
  return (
    <View testID={mine ? 'bubble-user' : 'bubble-coach'} accessibilityLabel={`${mine ? t('coach.you') : t('coach.title')}: ${msg.display_text}`}
      style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: mine ? c.primary : c.surface, borderColor: c.border, borderWidth: mine ? 0 : 1, borderRadius: radius.lg, padding: spacing.md }}>
      <Txt tone={mine ? 'onPrimary' : 'text'} selectable>{msg.display_text}</Txt>
    </View>
  );
}
