// ============================================================
// SIMES – Anomaly Service
// ============================================================

import type { Anomaly } from '@/models/anomaly.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class AnomalyServiceImpl implements IQueryService<Anomaly> {
  private get data() { return DataStore.getInstance().anomalies; }

  getAll(): Anomaly[] { return this.data; }
  getById(id: string): Anomaly | undefined { return this.data.find(a => a.id === id); }
  findBy(predicate: (a: Anomaly) => boolean): Anomaly[] { return this.data.filter(predicate); }
  findOneBy(predicate: (a: Anomaly) => boolean): Anomaly | undefined { return this.data.find(predicate); }

  getByTerrainId(terrainId: string): Anomaly[] {
    return this.data.filter(a => a.terrainId === terrainId);
  }

  getBySiteId(siteId: string): Anomaly[] {
    return this.data.filter(a => a.siteId === siteId);
  }
}

export const AnomalyService = new AnomalyServiceImpl();
