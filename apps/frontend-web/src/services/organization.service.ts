// ============================================================
// SIMES – Organization Service
// ============================================================

import type { Organization } from '@/models/organization.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class OrganizationServiceImpl implements IQueryService<Organization> {
  private get data() { return DataStore.getInstance().organizations; }

  getAll(): Organization[] { return this.data; }
  getById(id: string): Organization | undefined { return this.data.find(o => o.id === id); }
  findBy(predicate: (o: Organization) => boolean): Organization[] { return this.data.filter(predicate); }
  findOneBy(predicate: (o: Organization) => boolean): Organization | undefined { return this.data.find(predicate); }
}

export const OrganizationService = new OrganizationServiceImpl();
