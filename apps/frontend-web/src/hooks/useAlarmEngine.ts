import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
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
  dbId?: string; // incident UUID from DB
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
        try {
          const local = localStorage.getItem('simes-map-config');
          const localCfg = local ? JSON.parse(local) : {};
          const merged = { ...localCfg, ...serverMapConfig };
          if (localCfg.mapLocked !== undefined && (serverMapConfig as any).mapLocked === undefined) {
            merged.mapLocked = localCfg.mapLocked;
          }
          localStorage.setItem('simes-map-config', JSON.stringify(merged));
        } catch {
          localStorage.setItem('simes-map-config', JSON.stringify(serverMapConfig));
        }
      }
    }
  } catch {
    // Server unavailable — use local cache
  }
}

/* ── DB sync helpers ── */

/** Create an incident in the DB for a new alarm (fire-and-forget) */
function syncAlarmToDB(entry: AlarmEntry, terrainId: string): Promise<string | null> {
  return api.createIncident({
    title: entry.type,
    description: `Alerte ${entry.source === 'device' ? 'matérielle' : 'règle'} — ${entry.pointName}`,
    severity: entry.severity,
    source: 'alarm-engine',
    terrain_id: terrainId,
    point_id: entry.pointId || undefined,
    metadata: { alarmKey: entry.key, alarmSource: entry.source, ruleId: entry.ruleId },
  }).then(res => res.ok ? res.incident.id : null)
    .catch(() => null);
}

/** Resolve an incident in the DB */
function resolveAlarmInDB(dbId: string): void {
  api.updateIncident(dbId, { status: 'resolved' }).catch(() => {/* silent */});
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
  const dbLoadedRef = useRef(false);
  const [dbHistory, setDbHistory] = useState<AlarmEntry[]>([]);

  // Load alarm history from DB on terrain change
  useEffect(() => {
    if (!terrainId) return;
    dbLoadedRef.current = false;
    api.getIncidents({ source: 'alarm-engine', terrain_id: terrainId, limit: 500 })
      .then(res => {
        if (!res.ok) return;
        const entries: AlarmEntry[] = res.incidents.map((inc: any) => ({
          id: inc.metadata?.alarmKey ? `db_${inc.id}` : inc.id,
          key: inc.metadata?.alarmKey ?? `db_${inc.id}`,
          pointId: inc.point_id ?? '',
          pointName: inc.metadata?.pointName ?? inc.terrain_name ?? '',
          type: inc.title,
          severity: inc.severity as 'warning' | 'critical',
          triggeredAt: inc.created_at,
          resolvedAt: inc.resolved_at,
          source: (inc.metadata?.alarmSource ?? 'device') as 'rule' | 'device',
          ruleId: inc.metadata?.ruleId,
          dbId: inc.id,
        }));
        setDbHistory(entries);
        dbLoadedRef.current = true;
      })
      .catch(() => { dbLoadedRef.current = true; });
  }, [terrainId]);

  const { history, newAlarms, resolvedAlarms: justResolved } = useMemo(() => {
    if (!points.length) {
      const merged = mergeHistories(loadHistory(), dbHistory);
      return { history: merged, newAlarms: [] as AlarmEntry[], resolvedAlarms: [] as AlarmEntry[] };
    }

    const rules = loadRules().filter(r => r.active);
    const now = new Date().toISOString();

    // Build set of currently triggering alarm keys
    const triggering = new Map<string, Omit<AlarmEntry, 'id' | 'key' | 'triggeredAt' | 'resolvedAt'>>();

    for (const p of points) {
      const r = p.readings;
      if (!r) continue;
      const pid = String(p.id);
      const pname = String(p.name);

      // 1. Device hardware alarm_state bitflags
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

    // 3. Reconcile with stored history (local + DB)
    const prev = mergeHistories(loadHistory(), dbHistory);
    const updated = [...prev];
    const activeKeys = new Set(triggering.keys());
    const newAlarms: AlarmEntry[] = [];
    const justResolvedAlarms: AlarmEntry[] = [];

    // Create entries for NEW triggering alarms
    for (const [key, alarm] of triggering) {
      const alreadyActive = updated.find(h => h.key === key && h.resolvedAt === null);
      if (!alreadyActive) {
        const entry: AlarmEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          key, triggeredAt: now, resolvedAt: null, ...alarm,
        };
        updated.push(entry);
        newAlarms.push(entry);
      }
    }

    // Resolve alarms that are no longer triggering
    for (const entry of updated) {
      if (entry.resolvedAt === null && !activeKeys.has(entry.key)) {
        entry.resolvedAt = now;
        justResolvedAlarms.push(entry);
      }
    }

    return { history: updated, newAlarms, resolvedAlarms: justResolvedAlarms };
  }, [points, dbHistory]);

  // Persist history to localStorage + sync new/resolved alarms to DB
  useEffect(() => {
    const serial = JSON.stringify(history);
    if (serial !== prevSerialRef.current) {
      prevSerialRef.current = serial;
      saveHistory(history);

      // Sync new alarms to DB
      if (terrainId) {
        for (const alarm of newAlarms) {
          syncAlarmToDB(alarm, terrainId).then(dbId => {
            if (dbId) {
              alarm.dbId = dbId;
              saveHistory(history); // Update with dbId
            }
          });
        }

        // Resolve alarms in DB
        for (const alarm of justResolved) {
          if (alarm.dbId) resolveAlarmInDB(alarm.dbId);
        }
      }
    }
  }, [history, newAlarms, justResolved, terrainId]);

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

/** Merge localStorage history with DB-loaded history, deduplicating by key */
function mergeHistories(local: AlarmEntry[], db: AlarmEntry[]): AlarmEntry[] {
  const byKey = new Map<string, AlarmEntry>();
  // DB entries first (they have dbId)
  for (const e of db) byKey.set(e.key, e);
  // Local entries override if they are more recent or have no DB match
  for (const e of local) {
    const existing = byKey.get(e.key);
    if (!existing) {
      byKey.set(e.key, e);
    } else if (e.dbId && !existing.dbId) {
      // Local has dbId, DB entry doesn't — keep local
      byKey.set(e.key, e);
    } else if (!existing.resolvedAt && e.resolvedAt) {
      // Local is resolved, DB isn't — keep local (more up to date)
      byKey.set(e.key, { ...existing, resolvedAt: e.resolvedAt });
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
  );
}
