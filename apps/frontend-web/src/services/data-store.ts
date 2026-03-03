// ============================================================
// SIMES – Data Store (Singleton JSON Loader)
// ============================================================
// Central authority that loads all JSON data files, hydrates
// relative timestamps, and exposes typed arrays to services.
//
// SOLID:
//   S – solely responsible for loading & hydrating raw JSON
//   D – services depend on DataStore (abstraction over storage)
// ============================================================

import type { User } from '@/models/user.model';
import type { Organization, Site, Terrain } from '@/models/organization.model';
import type { MeasurementPoint, RawDevice, DeviceAlarm, HarmonicsData } from '@/models/measurement-point.model';
import type { Zone } from '@/models/zone.model';
import type { Anomaly, AnomalyNote } from '@/models/anomaly.model';
import type { ForecastSummary, ForecastPoint } from '@/models/forecast.model';
import type { InvoiceEstimate } from '@/models/invoice.model';
import type { PvAudit } from '@/models/energy.model';
import type { Report } from '@/models/report.model';
import type { Incident } from '@/models/incident.model';
import type { PipelineHealth } from '@/models/incident.model';

// ── JSON imports (Vite resolves these at build time) ────────
import usersJson from '@/data/users.json';
import organizationsJson from '@/data/organizations.json';
import sitesJson from '@/data/sites.json';
import terrainsJson from '@/data/terrains.json';
import measurementPointsJson from '@/data/measurement-points.json';
import rawDevicesJson from '@/data/raw-devices.json';
import zonesJson from '@/data/zones.json';
import anomaliesJson from '@/data/anomalies.json';
import forecastsJson from '@/data/forecasts.json';
import invoicesJson from '@/data/invoices.json';
import pvAuditsJson from '@/data/pv-audits.json';
import reportsJson from '@/data/reports.json';
import incidentsJson from '@/data/incidents.json';
import pipelineHealthJson from '@/data/pipeline-health.json';

// ============================================================
// Helpers
// ============================================================

const now = new Date();

/** Convert a "minutes ago" offset to an ISO-8601 string. */
function minutesAgo(min: number): string {
  return new Date(now.getTime() - min * 60 * 1000).toISOString();
}

/** Add N calendar days to today, return YYYY-MM-DD. */
function dayOffset(offset: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

// ── Harmonics generator (deterministic, same as old mock) ───

function generateHarmonics(thdA: number, thdB: number, thdC: number, seed: number): HarmonicsData[] {
  const peaks = new Set([5, 7, 11, 13]);
  const rand = (n: number) => {
    const x = Math.sin(n + seed) * 10000;
    return x - Math.floor(x);
  };
  const base = (order: number) => {
    const p = peaks.has(order) ? 1.6 : 0.7;
    return p * (0.6 + rand(order) * 0.8);
  };
  return Array.from({ length: 30 }, (_, idx) => {
    const order = idx + 2;
    const a = Math.max(0, base(order) * (thdA / 6) * 5);
    const b = Math.max(0, base(order) * (thdB / 6) * 5);
    const c = Math.max(0, base(order) * (thdC / 6) * 5);
    return {
      order,
      thd: Number(((a + b + c) / 3).toFixed(2)),
      values: {
        phaseA: Number(a.toFixed(2)),
        phaseB: Number(b.toFixed(2)),
        phaseC: Number(c.toFixed(2)),
      },
    };
  });
}

// ============================================================
// Data Store Singleton
// ============================================================

class DataStore {
  private static _instance: DataStore | null = null;

  // ── Typed collections ──
  readonly users: User[];
  readonly organizations: Organization[];
  readonly sites: Site[];
  readonly terrains: Terrain[];
  readonly measurementPoints: MeasurementPoint[];
  readonly rawDevices: RawDevice[];
  readonly zones: Zone[];
  readonly anomalies: Anomaly[];
  readonly forecastSummary: ForecastSummary;
  readonly invoiceEstimate: InvoiceEstimate;
  readonly pvAudit: PvAudit;
  readonly reports: Report[];
  readonly incidents: Incident[];
  readonly pipelineHealth: PipelineHealth[];

  // ── Constructor (private – singleton) ──

  private constructor() {
    // 1. Simple collections (no timestamp hydration needed)
    this.users = usersJson as unknown as User[];
    this.organizations = organizationsJson as unknown as Organization[];
    this.sites = sitesJson as unknown as Site[];
    this.reports = reportsJson as unknown as Report[];
    this.zones = zonesJson as unknown as Zone[];

    // 2. Terrains — hydrate lastSeen
    this.terrains = (terrainsJson as any[]).map(t => ({
      ...t,
      lastSeen: minutesAgo(t._lastSeenOffsetMin ?? 1),
    })) as Terrain[];

    // 3. Measurement points — hydrate timestamps + generate harmonics
    this.measurementPoints = (measurementPointsJson as any[]).map(raw => {
      const p = { ...raw } as any;

      // Hydrate lastSeen
      p.lastSeen = minutesAgo(raw._lastSeenOffsetMin ?? 1);

      // Hydrate alarm timestamps
      if (Array.isArray(p.activeAlarms)) {
        p.activeAlarms = p.activeAlarms.map((a: any) => ({
          ...a,
          startedAt: minutesAgo(a._startedAtOffsetMin ?? 0),
        } as DeviceAlarm));
      }

      // Generate harmonics from seed (if present)
      if (raw._harmonicsSeed != null) {
        const thdA = raw.metrics?.phaseA?.thd ?? 0;
        const thdB = raw.metrics?.phaseB?.thd ?? 0;
        const thdC = raw.metrics?.phaseC?.thd ?? 0;
        p.harmonics = generateHarmonics(thdA, thdB, thdC, raw._harmonicsSeed);
      }

      // Clean internal keys
      delete p._lastSeenOffsetMin;
      delete p._harmonicsSeed;
      if (Array.isArray(p.activeAlarms)) {
        p.activeAlarms.forEach((a: any) => { delete a._startedAtOffsetMin; });
      }

      return p as MeasurementPoint;
    });

    // 4. Raw devices — hydrate lastSeen
    this.rawDevices = (rawDevicesJson as any[]).map(d => ({
      ...d,
      lastSeen: minutesAgo(d._lastSeenOffsetMin ?? 5),
    })) as RawDevice[];

    // 5. Anomalies — hydrate startTime + note timestamps
    this.anomalies = (anomaliesJson as any[]).map(a => {
      const out = { ...a };
      out.startTime = minutesAgo(a._startTimeOffsetMin ?? 0);
      if (Array.isArray(out.notes)) {
        out.notes = out.notes.map((n: any) => ({
          ...n,
          timestamp: minutesAgo(n._timestampOffsetMin ?? 0),
        } as AnomalyNote));
        out.notes.forEach((n: any) => { delete n._timestampOffsetMin; });
      }
      delete out._startTimeOffsetMin;
      return out as Anomaly;
    });

    // 6. Forecast — hydrate generatedAt + point dates + risk period dates
    const fRaw = forecastsJson as any;
    const hydratedPoints: ForecastPoint[] = (fRaw.points ?? []).map((pt: any) => ({
      timestamp: dayOffset(pt._dayOffset ?? 0),
      p50: pt.p50,
      p90: pt.p90,
      baselineSeasonal: pt.baselineSeasonal,
      baselineEts: pt.baselineEts,
    }));
    this.forecastSummary = {
      terrainId: fRaw.terrainId,
      scope: fRaw.scope,
      horizon: fRaw.horizon,
      generatedAt: minutesAgo(fRaw._generatedAtOffsetMin ?? 60),
      modelQuality: fRaw.modelQuality,
      recentMape: fRaw.recentMape,
      missingDataPct: fRaw.missingDataPct,
      confidenceNote: fRaw.confidenceNote,
      totalP50Kwh: fRaw.totalP50Kwh,
      totalP90Kwh: fRaw.totalP90Kwh,
      riskPeriods: (fRaw.riskPeriods ?? []).map((rp: any) => ({
        startDate: dayOffset(rp._startDayOffset ?? 0),
        endDate: dayOffset(rp._endDayOffset ?? 0),
        reason: rp.reason,
        severity: rp.severity,
      })),
      points: hydratedPoints,
    } as ForecastSummary;

    // 7. Invoice — hydrate generatedAt
    const invRaw = invoicesJson as any;
    this.invoiceEstimate = {
      ...invRaw,
      generatedAt: minutesAgo(invRaw._generatedAtOffsetMin ?? 30),
    } as InvoiceEstimate;

    // 8. PV audit (static dates – no hydration needed)
    this.pvAudit = pvAuditsJson as unknown as PvAudit;

    // 9. Incidents — hydrate startedAt
    this.incidents = (incidentsJson as any[]).map(i => ({
      ...i,
      startedAt: minutesAgo(i._startedAtOffsetMin ?? 0),
    })) as Incident[];

    // 10. Pipeline health — hydrate lastCheck
    this.pipelineHealth = (pipelineHealthJson as any[]).map(ph => ({
      ...ph,
      lastCheck: minutesAgo(ph._lastCheckOffsetMin ?? 1),
    })) as PipelineHealth[];
  }

  // ── Public accessor ──

  static getInstance(): DataStore {
    if (!DataStore._instance) {
      DataStore._instance = new DataStore();
    }
    return DataStore._instance;
  }
}

export default DataStore;
