/**
 * Vector Search Plugin for GQP
 * Enables semantic search on text fields
 */

import type {
    GQPPlugin,
    GQPNode,
    QueryFilters,
    PluginContext,
    GQPEngine,
} from "../../core/types.js";

/**
 * Vector provider configuration
 */
export interface VectorProviderConfig {
    /** Pinecone configuration */
    pinecone?: {
        apiKey: string;
        index: string;
        environment?: string;
    };
    /** OpenAI embedding configuration */
    openai?: {
        apiKey: string;
        model?: string;
    };
    /** Custom embedding function */
    customEmbed?: (text: string) => Promise<number[]>;
    /** Custom search function */
    customSearch?: (
        namespace: string,
        embedding: number[],
        limit: number
    ) => Promise<Array<{ id: string; score: number }>>;
}

/**
 * Auto-indexing configuration
 */
export interface AutoIndexConfig {
    /** Enable auto-indexing */
    enabled: boolean;
    /** Fields to index (e.g., ['Order.customerNotes', 'Product.description']) */
    fields?: string[];
    /** Batch size for indexing */
    batchSize?: number;
}

/**
 * Vector plugin configuration
 */
export interface VectorPluginConfig {
    /** Vector provider */
    provider: "pinecone" | "custom";
    /** Provider-specific configuration */
    config: VectorProviderConfig;
    /** Similarity threshold (0-1) */
    threshold?: number;
    /** Max results from vector search before SQL filtering */
    maxResults?: number;
    /** Enable hybrid search (vector + SQL) */
    hybrid?: boolean;
    /** Auto-indexing configuration */
    autoIndex?: AutoIndexConfig;
}

/**
 * Vector Search Plugin
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { VectorPlugin } from '@mzhub/gqp/vector';
 *
 * const graph = new GQP({
 *   sources: { db: fromPrisma(prisma) },
 *   plugins: [
 *     new VectorPlugin({
 *       provider: 'pinecone',
 *       config: {
 *         pinecone: {
 *           apiKey: process.env.PINECONE_KEY,
 *           index: 'products'
 *         },
 *         openai: {
 *           apiKey: process.env.OPENAI_KEY
 *         }
 *       }
 *     })
 *   ]
 * });
 * ```
 */
export class VectorPlugin implements GQPPlugin {
    name = "vector";
    private config: VectorPluginConfig;
    private _indexedFields: Set<string> = new Set();

    constructor(config: VectorPluginConfig) {
        this.config = {
            threshold: 0.7,
            maxResults: 50,
            hybrid: true,
            ...config,
        };
    }

    /**
     * Initialize plugin
     */
    async onInit(_engine: GQPEngine): Promise<void> {

        // Set up auto-indexed fields
        if (this.config.autoIndex?.enabled && this.config.autoIndex.fields) {
            for (const field of this.config.autoIndex.fields) {
                this._indexedFields.add(field);
            }
        }
    }

    /**
     * Pre-query hook - handle semantic search
     */
    async onPreQuery(
        node: GQPNode,
        filters: QueryFilters,
        context: PluginContext
    ): Promise<QueryFilters> {
        // Check if there's a semantic query
        if (!context.query) {
            return filters;
        }

        // Find searchable fields on this node
        const searchableFields = node.fields.filter((f: any) =>
            f.directives.some((d: any) => d.name === "@search")
        );

        if (searchableFields.length === 0) {
            return filters;
        }

        // Perform vector search
        const matchingIds = await this.vectorSearch(
            node.name,
            context.query,
            this.config.maxResults || 50
        );

        if (matchingIds.length === 0) {
            // No matches - return filter that matches nothing
            return { ...filters, id: { in: [] } };
        }

        // Add ID filter to narrow down results
        if (this.config.hybrid) {
            return {
                ...filters,
                id: { in: matchingIds },
            };
        }

        // Non-hybrid: only use vector results
        return { id: { in: matchingIds } };
    }

    /**
     * Perform vector search
     */
    private async vectorSearch(
        namespace: string,
        query: string,
        limit: number
    ): Promise<string[]> {
        // Get embedding for query
        const embedding = await this.embed(query);

        // Search vector store
        const results = await this.search(namespace, embedding, limit);

        // Filter by threshold
        const threshold = this.config.threshold || 0.7;
        return results
            .filter((r) => r.score >= threshold)
            .map((r) => r.id);
    }

    /**
     * Generate embedding for text
     */
    private async embed(text: string): Promise<number[]> {
        // Custom embedding function
        if (this.config.config.customEmbed) {
            return this.config.config.customEmbed(text);
        }

        // OpenAI embedding
        if (this.config.config.openai) {
            return this.embedWithOpenAI(text);
        }

        throw new Error("No embedding provider configured");
    }

    /**
     * Search vector store
     */
    private async search(
        namespace: string,
        embedding: number[],
        limit: number
    ): Promise<Array<{ id: string; score: number }>> {
        // Custom search function
        if (this.config.config.customSearch) {
            return this.config.config.customSearch(namespace, embedding, limit);
        }

        // Pinecone search
        if (this.config.provider === "pinecone" && this.config.config.pinecone) {
            return this.searchWithPinecone(namespace, embedding, limit);
        }

        throw new Error("No vector search provider configured");
    }

    /**
     * Embed text using OpenAI
     */
    private async embedWithOpenAI(text: string): Promise<number[]> {
        const config = this.config.config.openai;
        if (!config) throw new Error("OpenAI config not found");

        const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model || "text-embedding-3-small",
                input: text,
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenAI embedding error: ${response.statusText}`);
        }

        const data = (await response.json()) as any;
        return data.data[0].embedding;
    }

    /**
     * Search using Pinecone
     */
    private async searchWithPinecone(
        namespace: string,
        embedding: number[],
        limit: number
    ): Promise<Array<{ id: string; score: number }>> {
        const config = this.config.config.pinecone;
        if (!config) throw new Error("Pinecone config not found");

        // Pinecone API call
        const response = await fetch(
            `https://${config.index}.svc.${config.environment || "us-east1-gcp"}.pinecone.io/query`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Api-Key": config.apiKey,
                },
                body: JSON.stringify({
                    namespace,
                    vector: embedding,
                    topK: limit,
                    includeMetadata: false,
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`Pinecone search error: ${response.statusText}`);
        }

        const data = (await response.json()) as any;
        return data.matches.map((m: { id: string; score: number }) => ({
            id: m.id,
            score: m.score,
        }));
    }

    /**
     * Index a field for vector search
     */
    async indexField(
        fieldPath: string,
        getData: () => Promise<Array<{ id: string; text: string }>>,
        options: { batchSize?: number; onProgress?: (percent: number) => void } = {}
    ): Promise<void> {
        const batchSize = options.batchSize || 100;
        const data = await getData();
        const total = data.length;

        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);

            // Generate embeddings for batch
            const embeddings = await Promise.all(
                batch.map((item) => this.embed(item.text))
            );

            // Upsert to vector store
            await this.upsertVectors(
                fieldPath,
                batch.map((item, idx) => ({
                    id: item.id,
                    embedding: embeddings[idx],
                }))
            );

            // Report progress
            if (options.onProgress) {
                options.onProgress(Math.min(100, ((i + batchSize) / total) * 100));
            }
        }

        this._indexedFields.add(fieldPath);
    }

    /**
     * Upsert vectors to store
     */
    private async upsertVectors(
        namespace: string,
        vectors: Array<{ id: string; embedding: number[] }>
    ): Promise<void> {
        if (this.config.provider === "pinecone" && this.config.config.pinecone) {
            const config = this.config.config.pinecone;

            await fetch(
                `https://${config.index}.svc.${config.environment || "us-east1-gcp"}.pinecone.io/vectors/upsert`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Api-Key": config.apiKey,
                    },
                    body: JSON.stringify({
                        namespace,
                        vectors: vectors.map((v) => ({
                            id: v.id,
                            values: v.embedding,
                        })),
                    }),
                }
            );
        }
    }

    /**
     * Check if a field is indexed
     */
    isIndexed(fieldPath: string): boolean {
        return this._indexedFields.has(fieldPath);
    }
}

/**
 * Factory function
 */
export function createVectorPlugin(config: VectorPluginConfig): VectorPlugin {
    return new VectorPlugin(config);
}
