/**
 * DEPRECATED: Invoice page
 * 
 * This file is kept for backward compatibility but should not be used.
 * All functionality has been moved to Invoice.improved.tsx with:
 * - Simplified contract configuration (optional fields hidden)
 * - Better toast notifications
 * - Improved table layout with visual grouping
 * - Fixed 401 auth errors by using proper api.ts methods
 * 
 * See Invoice.improved.tsx for the active implementation.
 */

// Re-export the improved version as default for backward compatibility
export { default } from './Invoice.improved';
