/**
 * Cache Plugin for GQP
 *
 * @example
 * ```typescript
 * import { CachePlugin } from '@mzhub/gqp/cache';
 *
 * const graph = new GQP({
 *   plugins: [
 *     new CachePlugin({ ttl: 300 })
 *   ]
 * });
 * ```
 */

export {
    CachePlugin,
    createCachePlugin,
    MemoryCacheProvider,
} from "./plugin.js";

export type { CachePluginConfig, CacheProvider } from "./plugin.js";
