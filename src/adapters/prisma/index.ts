/**
 * Prisma Adapter for GQP
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { fromPrisma } from '@mzhub/gqp/prisma';
 * import { prisma } from './db';
 *
 * const graph = new GQP({
 *   sources: {
 *     database: fromPrisma(prisma)
 *   }
 * });
 * ```
 */

export { PrismaAdapter, fromPrisma } from "./adapter.js";
export type { PrismaAdapterConfig } from "./adapter.js";
