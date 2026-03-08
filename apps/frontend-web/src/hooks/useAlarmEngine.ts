import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useTerrainOverview } from './useApi';

/* ── Types ── */

export interface AlarmRule {
  id: number;
  condition: string;
  element: string;
  value: string;
  active: boolean;
  pointId?: string | null; // null/empty = all devices
}

export interface AlarmEntry {
  id: string;
  key: string;
  pointId: string;
  pointName: string;
  type: string;
  severity: 'warning' | 'critical';
  triggeredAt: string;
  resolvedAt: string | null;
  source: 'rule' | 'device';
  ruleId?: number;
}

/* ── Constants ── */

const HISTORY_KEY = 'simes_alarm_history';
const RULES_KEY = 'simes_alarm_rules';
const MAX_HISTORY = 500;

/* ── Persistence helpers ── */

function loadHistory(): AlarmEntry[] {
  try { const s = localStorage.getItem(HISTORY_KEY); return s ? JSON.parse(s) : []; }
  catch { return []; }
}

function saveHistory(entries: AlarmEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-MAX_HISTORY)));
}

export function loadRules(): AlarmRule[] {
  try { const s = localStorage.getItem(RULES_KEY); return s ? JSON.parse(s) : []; }
  catch { return []; }
}

export function saveRules(rules: AlarmRule[]) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

/* ── Evaluation ── */

function evaluateCondition(actual: number, condition: string, threshold: number): boolean {
  switch (condition) {
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    case '==': return Math.abs(actual - threshold) < 0.001;
    default: return false;
  }
}

function severityFor(element: string): 'warning' | 'critical' {
  if (['voltage_a', 'voltage_b', 'voltage_c', 'current_a', 'current_b', 'current_c'].includes(element)) return 'critical';
  return 'warning';
}

/* ── Hook ── */

export function useAlarmEngine(terrainId: string | null) {
  const { data: overviewData } = useTerrainOverview(terrainId);
  const points = (overviewData?.points ?? []) as Array<Record<string, any>>;
  const prevSerialRef = useRef('');

  const { history } = useMemo(() => {
    if (!points.length) return { history: loadHistory() };

    const rules = loadRules().filter(r => r.active);
    const now = new Date().toISOString();

    // Build set of currently triggering alarm keys
    const triggering = new Map<string, Omit<AlarmEntry, 'id' | 'key' | 'triggeredAt' | 'resolvedAt'>>();

    for (const p of points) {
      const r = p.readings;
      if (!r) continue;
      const pid = String(p.id);
      const pname = String(p.name);

      // 1. Device hardware alarm_state bitflags (always valid)
      const alarmState = r.alarm_state != null ? Number(r.alarm_state) : 0;
      if (alarmState > 0) {
        const flags = [
          { bit: 1, type: 'Surtension', severity: 'critical' as const },
          { bit: 2, type: 'Sous-tension', severity: 'critical' as const },
          { bit: 4, type: 'Surintensité', severity: 'critical' as const },
          { bit: 8, type: 'Perte de phase', severity: 'critical' as const },
          { bit: 16, type: 'THD élevé', severity: 'warning' as const },
          { bit: 32, type: 'PF faible', severity: 'warning' as const },
        ];
        for (const f of flags) {
          if (alarmState & f.bit) {
            triggering.set(`device_${pid}_${f.bit}`, { pointId: pid, pointName: pname, type: f.type, severity: f.severity, source: 'device' });
          }
        }
      }

      // 2. Configured rule-based alarms
      for (const rule of rules) {
        if (rule.pointId && rule.pointId !== pid) continue;
        const actual = r[rule.element] != null ? Number(r[rule.element]) : null;
        if (actual == null || isNaN(actual)) continue;
        const threshold = Number(rule.value);
        if (isNaN(threshold)) continue;

        if (evaluateCondition(actual, rule.condition, threshold)) {
          const label = rule.element.replace(/_/g, ' ');
          triggering.set(`rule_${rule.id}_${pid}`, {
            pointId: pid, pointName: pname,
            type: `${label} ${rule.condition} ${rule.value} (actuel: ${actual.toFixed(2)})`,
            severity: severityFor(rule.element),
            source: 'rule', ruleId: rule.id,
          });
        }
      }
    }

    // 3. Reconcile with stored history
    const prev = loadHistory();
    const updated = [...prev];
    const activeKeys = new Set(triggering.keys());

    // Create entries for NEW triggering alarms
    for (const [key, alarm] of triggering) {
      const alreadyActive = updated.find(h => h.key === key && h.resolvedAt === null);
      if (!alreadyActive) {
        updated.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          key, triggeredAt: now, resolvedAt: null, ...alarm,
        });
      }
    }

    // Resolve alarms that are no longer triggering
    for (const entry of updated) {
      if (entry.resolvedAt === null && !activeKeys.has(entry.key)) {
        entry.resolvedAt = now;
      }
    }

    return { history: updated };
  }, [points]);

  // Persist history (skip if unchanged)
  useEffect(() => {
    const serial = JSON.stringify(history);
    if (serial !== prevSerialRef.current) {
      prevSerialRef.current = serial;
      saveHistory(history);
    }
  }, [history]);

  const activeAlarms = useMemo(() => history.filter(h => h.resolvedAt === null), [history]);
  const resolvedAlarms = useMemo(() => history.filter(h => h.resolvedAt !== null), [history]);

  const alarmsByDay = useMemo(() => {
    const byDay = new Map<string, { active: number; resolved: number }>();
    for (const h of history) {
      const day = new Date(h.triggeredAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const e = byDay.get(day) ?? { active: 0, resolved: 0 };
      if (h.resolvedAt) e.resolved++; else e.active++;
      byDay.set(day, e);
    }
    return Array.from(byDay.entries()).map(([day, c]) => ({ day, ...c, total: c.active + c.resolved }));
  }, [history]);

  const clearHistory = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    prevSerialRef.current = '';
  }, []);

  return {
    activeAlarms, resolvedAlarms, allAlarms: history, alarmsByDay,
    stats: { active: activeAlarms.length, resolved: resolvedAlarms.length, total: history.length },
    clearHistory, points,
  };
}
