// ============================================================
// SIMES – Service Interfaces (SOLID: Dependency Inversion)
// ============================================================
// All concrete services implement these contracts so the
// frontend depends on abstractions, never on implementations.
// ============================================================

/**
 * Read-only access to a collection of domain entities.
 * (SOLID – Interface Segregation: smallest useful contract.)
 */
export interface IReadService<T> {
  getAll(): T[];
  getById(id: string): T | undefined;
}

/**
 * Read + filter access.
 */
export interface IQueryService<T> extends IReadService<T> {
  findBy(predicate: (item: T) => boolean): T[];
  findOneBy(predicate: (item: T) => boolean): T | undefined;
}


