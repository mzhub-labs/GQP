/**
 * REST Adapter for GQP
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { fromREST } from '@mzhub/gqp/rest';
 *
 * const graph = new GQP({
 *   sources: {
 *     myApi: fromREST({
 *       baseURL: 'https://api.example.com',
 *       resources: {
 *         users: { endpoint: '/users' }
 *       }
 *     })
 *   }
 * });
 * ```
 */

export { RESTAdapter, fromREST } from "./adapter.js";
export type { RESTAdapterConfig, RESTResource } from "./adapter.js";
