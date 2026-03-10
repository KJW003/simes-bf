import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useTerrainOverview } from './useApi';
import api from '@/lib/api';

/* ── Types ── */

export interface AlarmCondition {
  element: string;
  condition: string;   // >, <, >=, <=, ==
  value: string;
}

export interface AlarmRule {
  id: number;
  conditions: AlarmCondition[];
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
  try {
    const s = localStorage.getItem(RULES_KEY);
    if (!s) return [];
    const raw: any[] = JSON.parse(s);
    // Migrate old single-condition format → conditions array
    return raw.map(r => {
      if (r.conditions) return r as AlarmRule;
      return {
        id: r.id,
        conditions: [{ element: r.element, condition: r.condition, value: r.value }],
        active: r.active,
        pointId: r.pointId ?? null,
      } as AlarmRule;
    });
  } catch { return []; }
}

// Debounce timer for server sync of alarm rules
let _alarmSyncTimer: ReturnType<typeof setTimeout> | null = null;

export function saveRules(rules: AlarmRule[]) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  // Debounced server sync
  if (_alarmSyncTimer) clearTimeout(_alarmSyncTimer);
  _alarmSyncTimer = setTimeout(() => {
    api.patchSettings({ alarmRules: rules }).catch(() => {/* silent */});
  }, 500);
}

/** Load alarm rules from server and merge into local cache */
export async function loadAlarmSettingsFromServer(): Promise<void> {
  try {
    const res = await api.getSettings();
    if (res.ok && res.settings) {
      const serverRules = res.settings.alarmRules as AlarmRule[] | undefined;
      if (Array.isArray(serverRules) && serverRules.length > 0) {
        localStorage.setItem(RULES_KEY, JSON.stringify(serverRules));
      }
      const serverMapConfig = res.settings.mapConfig;
      if (serverMapConfig && typeof serverMapConfig === 'object') {
        // Merge server config with local config to preserve local-only fields (e.g. mapLocked)
        try {
          const local = localStorage.getItem('simes-map-config');
          const localCfg = local ? JSON.parse(local) : {};
          const merged = { ...localCfg, ...serverMapConfig };
          // Preserve mapLocked from local if server doesn't have it
          if (localCfg.mapLocked !== undefined && (serverMapConfig as any).mapLocked === undefined) {
            merged.mapLocked = localCfg.mapLocked;
          }
          localStorage.setItem('simes-map-config', JSON.stringify(merged));
        } catch {
          localStorage.setItem('simes-map-config', JSON.stringify(serverMapConfig));
        }
      }
      const serverWidgetLayout = res.settings.widgetLayout;
      if (serverWidgetLayout && typeof serverWidgetLayout === 'object') {
        // Store under the versioned key — will be loaded by WidgetBoard
        const userId = (res.settings as any)._userId; // not available here, so use generic approach
        // Widget layout sync is handled differently — see WidgetBoard
      }
    }
  } catch {
    // Server unavailable — use local cache
  }
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

      // 2. Configured rule-based alarms (all conditions must match = AND logic)
      for (const rule of rules) {
        if (rule.pointId && rule.pointId !== pid) continue;
        if (!rule.conditions.length) continue;

        let allMatch = true;
        const parts: string[] = [];

        for (const cond of rule.conditions) {
          const actual = r[cond.element] != null ? Number(r[cond.element]) : null;
          if (actual == null || isNaN(actual)) { allMatch = false; break; }
          const threshold = Number(cond.value);
          if (isNaN(threshold)) { allMatch = false; break; }
          if (!evaluateCondition(actual, cond.condition, threshold)) { allMatch = false; break; }
          parts.push(`${cond.element.replace(/_/g, ' ')} ${cond.condition} ${cond.value} (${actual.toFixed(2)})`);
        }

        if (allMatch) {
          const firstEl = rule.conditions[0].element;
          triggering.set(`rule_${rule.id}_${pid}`, {
            pointId: pid, pointName: pname,
            type: parts.join(' ET '),
            severity: severityFor(firstEl),
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
