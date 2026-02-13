/**
 * Temporal Reasoning Plugin for GQP
 *
 * @example
 * ```typescript
 * import { TemporalPlugin } from '@mzhub/gqp/temporal';
 *
 * const graph = new GQP({
 *   plugins: [
 *     new TemporalPlugin({ timezone: 'America/New_York' })
 *   ]
 * });
 * ```
 */

export { TemporalPlugin, createTemporalPlugin } from "./plugin.js";
export type { TemporalPluginConfig } from "./plugin.js";
