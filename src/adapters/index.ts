/**
 * GQP Adapters
 * Data source connectors
 */

export { PrismaAdapter, fromPrisma } from "./prisma/index.js";
export type { PrismaAdapterConfig } from "./prisma/index.js";

export { RESTAdapter, fromREST } from "./rest/index.js";
export type { RESTAdapterConfig, RESTResource } from "./rest/index.js";
