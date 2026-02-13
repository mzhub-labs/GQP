/**
 * GQP Plugins
 * Optional capabilities
 */

// Vector search
export { VectorPlugin, createVectorPlugin } from "./vector/index.js";
export type {
    VectorPluginConfig,
    VectorProviderConfig,
    AutoIndexConfig,
} from "./vector/index.js";

// Temporal reasoning
export { TemporalPlugin, createTemporalPlugin } from "./temporal/index.js";
export type { TemporalPluginConfig } from "./temporal/index.js";

// Caching
export {
    CachePlugin,
    createCachePlugin,
    MemoryCacheProvider,
} from "./cache/index.js";
export type { CachePluginConfig, CacheProvider } from "./cache/index.js";
