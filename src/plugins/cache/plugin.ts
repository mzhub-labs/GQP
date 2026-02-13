/**
 * Cache Plugin for GQP
 * Query result caching with multiple backends
 */

import type {
  GQPPlugin,
  GQPNode,
  PluginContext,
  QueryFilters,
  GQPEngine,
} from "../../core/types.js";

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryCacheProvider implements CacheProvider {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(maxSize = 1000, cleanupIntervalMs = 60000) {
    this.maxSize = maxSize;

    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.evictExpired();
      }, cleanupIntervalMs);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
      createdAt: Date.now(),
    });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.cache.clear();
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  size(): number {
    return this.cache.size;
  }
}

export interface CachePluginConfig {
  provider?: "memory" | "redis" | CacheProvider;
  redis?: {
    url: string;
    prefix?: string;
  };
  ttl?: number;
  maxSize?: number;
  cleanupInterval?: number;
  strategies?: Record<
    string,
    {
      ttl?: number;
      invalidateOn?: string[];
    }
  >;
}

export class CachePlugin implements GQPPlugin {
  name = "cache";
  private config: CachePluginConfig;
  private provider: CacheProvider;
  private memoryProvider?: MemoryCacheProvider;
  private pendingQueries: Map<string, Promise<unknown[]>> = new Map();
  private stats = {
    hits: 0,
    misses: 0,
  };

  constructor(config: CachePluginConfig = {}) {
    this.config = {
      ttl: 300,
      maxSize: 1000,
      cleanupInterval: 60000,
      ...config,
    };

    if (config.provider instanceof Object && "get" in config.provider) {
      this.provider = config.provider as CacheProvider;
    } else if (config.provider === "redis" && config.redis) {
      this.memoryProvider = new MemoryCacheProvider(
        this.config.maxSize,
        this.config.cleanupInterval,
      );
      this.provider = this.memoryProvider;
    } else {
      this.memoryProvider = new MemoryCacheProvider(
        this.config.maxSize,
        this.config.cleanupInterval,
      );
      this.provider = this.memoryProvider;
    }
  }

  async onInit(_engine: GQPEngine): Promise<void> {}

  async onDestroy(): Promise<void> {
    if (this.memoryProvider) {
      this.memoryProvider.destroy();
    }
    this.pendingQueries.clear();
  }

  async onPreQuery(
    node: GQPNode,
    filters: QueryFilters,
    context: PluginContext,
  ): Promise<QueryFilters> {
    const cacheKey = this.generateCacheKey(node.name, context);

    const cached = await this.provider.get<unknown[]>(cacheKey);
    if (cached !== null) {
      this.stats.hits++;
      (context as { _cachedResults?: unknown[] })._cachedResults = cached;
    } else {
      this.stats.misses++;
      (context as { _cacheKey?: string })._cacheKey = cacheKey;
    }

    return filters;
  }

  async onPostQuery(
    node: GQPNode,
    results: unknown[],
    context: PluginContext,
  ): Promise<unknown[]> {
    const ctx = context as { _cachedResults?: unknown[]; _cacheKey?: string };

    if (ctx._cachedResults) {
      return ctx._cachedResults;
    }

    if (ctx._cacheKey) {
      const ttl = this.getTTL(node.name);
      await this.provider.set(ctx._cacheKey, results, ttl);
    }

    return results;
  }

  private generateCacheKey(nodeName: string, context: PluginContext): string {
    const parts = [
      "gqp",
      nodeName,
      this.safeStringify(context.filters),
      this.safeStringify(context.options),
    ];

    if (context.query) {
      parts.push(context.query);
    }

    const str = parts.join(":");
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return `gqp:${nodeName}:${Math.abs(hash).toString(36)}`;
  }

  private safeStringify(obj: unknown): string {
    const seen = new WeakSet();
    return JSON.stringify(obj, (_, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[circular]";
        seen.add(value);
      }
      return value;
    });
  }

  private getTTL(nodeName: string): number {
    const strategy = this.config.strategies?.[nodeName];
    return strategy?.ttl || this.config.ttl || 300;
  }

  async invalidate(_pattern: string): Promise<void> {
    if (this.memoryProvider) {
      await this.memoryProvider.clear();
    }
  }

  getStats(): {
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  async clear(): Promise<void> {
    await this.provider.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }
}

export function createCachePlugin(config: CachePluginConfig = {}): CachePlugin {
  return new CachePlugin(config);
}
