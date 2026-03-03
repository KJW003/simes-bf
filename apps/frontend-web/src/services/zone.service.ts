// ============================================================
// SIMES – Zone Service
// ============================================================

import type { Zone } from '@/models/zone.model';
import type { MeasurementPoint } from '@/models/measurement-point.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class ZoneServiceImpl implements IQueryService<Zone> {
  private get data() { return DataStore.getInstance().zones; }

  getAll(): Zone[] { return this.data; }
  getById(id: string): Zone | undefined { return this.data.find(z => z.id === id); }
  findBy(predicate: (z: Zone) => boolean): Zone[] { return this.data.filter(predicate); }
  findOneBy(predicate: (z: Zone) => boolean): Zone | undefined { return this.data.find(predicate); }

  getByTerrainId(terrainId: string): Zone[] {
    return this.data.filter(z => z.terrainId === terrainId);
  }

  getPointIds(zoneId: string): string[] {
    const zone = this.getById(zoneId);
    return zone ? zone.pointIds : [];
  }

  getPoints(zoneId: string): MeasurementPoint[] {
    const zone = this.getById(zoneId);
    if (!zone) return [];
    const store = DataStore.getInstance();
    return store.measurementPoints.filter(p => zone.pointIds.includes(p.id));
  }
}

export const ZoneService = new ZoneServiceImpl();
