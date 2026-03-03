// ============================================================
// SIMES – Device Service (raw / unmapped devices)
// ============================================================

import type { RawDevice } from '@/models/measurement-point.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class DeviceServiceImpl implements IQueryService<RawDevice> {
  private get data() { return DataStore.getInstance().rawDevices; }

  getAll(): RawDevice[] { return this.data; }
  getById(id: string): RawDevice | undefined { return this.data.find(d => d.id === id); }
  findBy(predicate: (d: RawDevice) => boolean): RawDevice[] { return this.data.filter(predicate); }
  findOneBy(predicate: (d: RawDevice) => boolean): RawDevice | undefined { return this.data.find(predicate); }

  getByTerrainId(terrainId: string): RawDevice[] {
    return this.data.filter(d => d.terrainId === terrainId);
  }
}

export const DeviceService = new DeviceServiceImpl();
