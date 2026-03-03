// ============================================================
// SIMES – Site Service
// ============================================================

import type { Site } from '@/models/organization.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class SiteServiceImpl implements IQueryService<Site> {
  private get data() { return DataStore.getInstance().sites; }

  getAll(): Site[] { return this.data; }
  getById(id: string): Site | undefined { return this.data.find(s => s.id === id); }
  findBy(predicate: (s: Site) => boolean): Site[] { return this.data.filter(predicate); }
  findOneBy(predicate: (s: Site) => boolean): Site | undefined { return this.data.find(predicate); }

  getByOrgId(orgId: string): Site[] {
    return this.data.filter(s => s.orgId === orgId);
  }
}

export const SiteService = new SiteServiceImpl();
