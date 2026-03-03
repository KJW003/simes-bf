// ============================================================
// SIMES – Zone Model
// (SOLID: Single Responsibility – logical grouping of points)
// ============================================================

import type { IEntity } from './base';

/**
 * A named zone within a terrain that groups measurement points
 * for navigation and aggregation (e.g. "Administration", "Salle Serveur").
 */
export interface Zone extends IEntity {
  terrainId: string;
  name: string;
  /** IDs of all measurement points belonging to this zone. */
  pointIds: string[];
}
