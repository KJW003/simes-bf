// ============================================================
// SIMES – User Service
// ============================================================

import type { User } from '@/models/user.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class UserServiceImpl implements IQueryService<User> {
  private get data() { return DataStore.getInstance().users; }

  getAll(): User[] { return this.data; }
  getById(id: string): User | undefined { return this.data.find(u => u.id === id); }
  findBy(predicate: (u: User) => boolean): User[] { return this.data.filter(predicate); }
  findOneBy(predicate: (u: User) => boolean): User | undefined { return this.data.find(predicate); }

  getByEmail(email: string): User | undefined {
    return this.data.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  getByOrgId(orgId: string): User[] {
    return this.data.filter(u => u.orgId === orgId);
  }
}

export const UserService = new UserServiceImpl();
