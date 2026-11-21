import React, { useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Btn, Icon, Row, Txt } from '@/components/ui';
import type { CoachAction } from '@/data/coach';
import { nowMs } from '@/domain/clock';
import { t, type StringKey } from '@/i18n';
import { useApp } from '@/state/app';
import { radius, spacing } from '@/theme';
import { useCoachFormat } from './format';

/** A proposed change, its before → after, and the only way to apply it: an explicit tap. */
export function ProposalCard({ action, onDecided, testID }: { action: CoachAction; onDecided?: (a: CoachAction, applied: boolean) => void; testID?: string }) {
  const app = useApp();
  const { c } = useTheme();
  const { toast, confirm } = useFeedback();
  const cf = useCoachFormat();
  const [busy, setBusy] = useState(false);
  const pv = action.preview;
  const pending = action.status === 'proposed';

  const apply = async () => {
    if (pv.destructive && !(await confirm({ title: t('coach.confirmDeleteTitle'), message: `${pv.subject}\n${pv.reason}`, confirmLabel: t('common.delete'), destructive: true }))) return;
    setBusy(true);
    const r = await app.coach.apply(action.id, app.coachCtx());
    setBusy(false);
    if (r.ok) {
      toast({ message: t('coach.applied'), actionLabel: pv.undoable ? t('common.undo') : undefined, onAction: pv.undoable ? () => void undo() : undefined });
      onDecided?.(r.value, true);
    } else toast({ message: t('coach.applyFailed', { reason: r.error }), tone: 'error' });
  };
  const undo = async () => {
    const r = await app.coach.undo(action.id, app.coachCtx());
    toast(r.ok ? { message: t('coach.undone') } : { message: r.error === 'changed_since' ? t('coach.undoChanged') : t('coach.undoFailed'), tone: 'error' });
  };

  return (
    <View testID={testID} accessibilityLabel={t('coach.proposalA11y', { tool: t(`coach.tool.${action.tool}` as StringKey) })}
      style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: pending ? c.primary : c.border, backgroundColor: c.surface, padding: spacing.md, gap: spacing.sm }}>
      <Row>
        <Icon name={pv.destructive ? 'trash-outline' : 'sparkles-outline'} size={18} tone={pv.destructive ? 'danger' : 'primary'} />
        <Txt variant="overline" tone={pv.destructive ? 'danger' : 'primary'} style={{ flex: 1 }}>{t(`coach.tool.${action.tool}` as StringKey)}</Txt>
        <Txt variant="caption" tone="textMuted">{t(`coach.status.${action.status}` as StringKey)}</Txt>
      </Row>
      {pv.subject ? <Txt variant="bodyStrong">{pv.subject}</Txt> : null}
      <View style={{ gap: 2 }}>
        {pv.changes.map((ch, i) => (
          <Row key={i} wrap gap={6}>
            <Txt variant="label" tone="textMuted">{cf.field(ch.field)}:</Txt>
            {ch.from != null ? <Txt variant="label" style={{ textDecorationLine: 'line-through' }} tone="textMuted">{cf.value(ch.from, ch.unit)}</Txt> : null}
            {ch.from != null && ch.to != null ? <Txt variant="label" tone="textMuted">→</Txt> : null}
            {ch.to != null ? <Txt variant="label">{cf.value(ch.to, ch.unit)}</Txt> : null}
          </Row>
        ))}
      </View>
      {pv.reason ? <Txt variant="caption" tone="textMuted">{t('coach.why', { reason: pv.reason })}</Txt> : null}
      {action.status === 'failed' && action.error ? <Txt variant="caption" tone="danger">{action.error}</Txt> : null}
      {pending ? (
        <Row>
          <Btn testID={`${testID ?? 'proposal'}-apply`} size="sm" variant={pv.destructive ? 'danger' : 'primary'} icon="checkmark" title={pv.destructive ? t('coach.applyDelete') : t('coach.apply')} loading={busy} onPress={() => void apply()} style={{ flex: 1 }} />
          <Btn testID={`${testID ?? 'proposal'}-decline`} size="sm" variant="outline" title={t('coach.decline')} onPress={async () => { await app.coach.decline(action.id, nowMs()); onDecided?.(action, false); }} style={{ flex: 1 }} />
        </Row>
      ) : action.status === 'applied' && pv.undoable ? (
        <Btn testID={`${testID ?? 'proposal'}-undo`} size="sm" variant="ghost" icon="arrow-undo-outline" title={t('common.undo')} onPress={() => void undo()} />
      ) : null}
    </View>
  );
}
