// ============================================================
// SIMES – Terrain Service
// ============================================================

import type { Terrain } from '@/models/organization.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class TerrainServiceImpl implements IQueryService<Terrain> {
  private get data() { return DataStore.getInstance().terrains; }

  getAll(): Terrain[] { return this.data; }
  getById(id: string): Terrain | undefined { return this.data.find(t => t.id === id); }
  findBy(predicate: (t: Terrain) => boolean): Terrain[] { return this.data.filter(predicate); }
  findOneBy(predicate: (t: Terrain) => boolean): Terrain | undefined { return this.data.find(predicate); }

  getBySiteId(siteId: string): Terrain[] {
    return this.data.filter(t => t.siteId === siteId);
  }
}

export const TerrainService = new TerrainServiceImpl();
