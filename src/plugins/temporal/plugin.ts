/**
 * Temporal Reasoning Plugin for GQP
 * Enables natural language date parsing
 */

import type {
    GQPPlugin,
    GQPField,
    PluginContext,
} from "../../core/types.js";

/**
 * Temporal plugin configuration
 */
export interface TemporalPluginConfig {
    /** Timezone for date parsing */
    timezone?: string;
    /** Custom date patterns */
    patterns?: Record<string, { start: string; end: string }>;
    /** Relative date anchors */
    anchors?: Record<string, string>;
}

/**
 * Parsed date range
 */
interface DateRange {
    gte?: Date;
    lte?: Date;
    eq?: Date;
}

/**
 * Temporal Reasoning Plugin
 *
 * Parses natural language date expressions into date ranges.
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { TemporalPlugin } from '@mzhub/gqp/temporal';
 *
 * const graph = new GQP({
 *   sources: { db: fromPrisma(prisma) },
 *   plugins: [
 *     new TemporalPlugin({
 *       timezone: 'America/New_York',
 *       patterns: {
 *         'Q1': { start: '01-01', end: '03-31' },
 *         'Q2': { start: '04-01', end: '06-30' }
 *       }
 *     })
 *   ]
 * });
 *
 * // Query with natural language date
 * await graph.handleToolCall({
 *   action: 'query',
 *   node: 'Order',
 *   filters: { createdAt: 'last week' }
 * });
 * ```
 */
export class TemporalPlugin implements GQPPlugin {
    name = "temporal";
    private config: TemporalPluginConfig;
    private chronoParser: unknown = null;

    constructor(config: TemporalPluginConfig = {}) {
        this.config = {
            timezone: "UTC",
            ...config,
        };
    }

    /**
     * Initialize plugin - try to load chrono-node
     */
    async onInit(): Promise<void> {
        try {
            const chrono = (await import("chrono-node" as any)) as any;
            this.chronoParser = chrono;
        } catch {
            // chrono-node not available, use built-in parser
            this.chronoParser = null;
        }
    }

    /**
     * Translate filter values for DateTime fields
     */
    translateFilter(
        field: GQPField,
        value: unknown,
        _context: PluginContext
    ): unknown | null {
        // Only handle DateTime fields
        if (field.type !== "DateTime") {
            return null;
        }

        // Only handle string values (natural language)
        if (typeof value !== "string") {
            return null;
        }

        // Check for custom patterns first
        const customRange = this.matchCustomPattern(value);
        if (customRange) {
            return customRange;
        }

        // Parse with chrono if available
        if (this.chronoParser) {
            return this.parseWithChrono(value);
        }

        // Fall back to built-in parsing
        return this.parseBuiltIn(value);
    }

    /**
     * Match custom patterns (Q1, Q2, fiscal year, etc.)
     */
    private matchCustomPattern(value: string): DateRange | null {
        if (!this.config.patterns) return null;

        const lowerValue = value.toLowerCase().trim();
        const year = new Date().getFullYear();

        for (const [pattern, range] of Object.entries(this.config.patterns)) {
            if (lowerValue.includes(pattern.toLowerCase())) {
                // Extract year if mentioned
                const yearMatch = lowerValue.match(/\d{4}/);
                const targetYear = yearMatch ? parseInt(yearMatch[0]) : year;

                return {
                    gte: new Date(`${targetYear}-${range.start}T00:00:00Z`),
                    lte: new Date(`${targetYear}-${range.end}T23:59:59Z`),
                };
            }
        }

        return null;
    }

    /**
     * Parse with chrono-node
     */
    private parseWithChrono(value: string): DateRange | null {
        const chrono = this.chronoParser as {
            parse: (text: string, ref?: Date) => Array<{
                start: { date: () => Date };
                end?: { date: () => Date };
            }>;
        };

        const results = chrono.parse(value, new Date());
        if (results.length === 0) return null;

        const result = results[0];

        if (result.end) {
            // Range expression ("last week", "from Monday to Friday")
            return {
                gte: result.start.date(),
                lte: result.end.date(),
            };
        }

        // Single date expression ("yesterday", "on Monday")
        const date = result.start.date();
        return {
            gte: this.startOfDay(date),
            lte: this.endOfDay(date),
        };
    }

    /**
     * Built-in natural language date parser
     */
    private parseBuiltIn(value: string): DateRange | null {
        const now = new Date();
        const lowerValue = value.toLowerCase().trim();

        // Today
        if (lowerValue === "today") {
            return {
                gte: this.startOfDay(now),
                lte: this.endOfDay(now),
            };
        }

        // Yesterday
        if (lowerValue === "yesterday") {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            return {
                gte: this.startOfDay(yesterday),
                lte: this.endOfDay(yesterday),
            };
        }

        // Last N days/weeks/months
        const lastMatch = lowerValue.match(
            /last\s+(\d+)?\s*(day|days|week|weeks|month|months)/
        );
        if (lastMatch) {
            const count = lastMatch[1] ? parseInt(lastMatch[1]) : 1;
            const unit = lastMatch[2];

            const start = new Date(now);
            if (unit.startsWith("day")) {
                start.setDate(start.getDate() - count);
            } else if (unit.startsWith("week")) {
                start.setDate(start.getDate() - count * 7);
            } else if (unit.startsWith("month")) {
                start.setMonth(start.getMonth() - count);
            }

            return {
                gte: this.startOfDay(start),
                lte: this.endOfDay(now),
            };
        }

        // This week
        if (lowerValue === "this week") {
            const start = new Date(now);
            const dayOfWeek = start.getDay();
            start.setDate(start.getDate() - dayOfWeek);
            return {
                gte: this.startOfDay(start),
                lte: this.endOfDay(now),
            };
        }

        // Last week
        if (lowerValue === "last week") {
            const end = new Date(now);
            const dayOfWeek = end.getDay();
            end.setDate(end.getDate() - dayOfWeek - 1);

            const start = new Date(end);
            start.setDate(start.getDate() - 6);

            return {
                gte: this.startOfDay(start),
                lte: this.endOfDay(end),
            };
        }

        // This month
        if (lowerValue === "this month") {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            return {
                gte: this.startOfDay(start),
                lte: this.endOfDay(now),
            };
        }

        // Last month
        if (lowerValue === "last month") {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return {
                gte: this.startOfDay(start),
                lte: this.endOfDay(end),
            };
        }

        // This year
        if (lowerValue === "this year") {
            const start = new Date(now.getFullYear(), 0, 1);
            return {
                gte: this.startOfDay(start),
                lte: this.endOfDay(now),
            };
        }

        // Specific date (YYYY-MM-DD)
        const dateMatch = lowerValue.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) {
            const date = new Date(`${dateMatch[0]}T00:00:00Z`);
            return {
                gte: this.startOfDay(date),
                lte: this.endOfDay(date),
            };
        }

        // Unable to parse
        return null;
    }

    /**
     * Get start of day
     */
    private startOfDay(date: Date): Date {
        const result = new Date(date);
        result.setHours(0, 0, 0, 0);
        return result;
    }

    /**
     * Get end of day
     */
    private endOfDay(date: Date): Date {
        const result = new Date(date);
        result.setHours(23, 59, 59, 999);
        return result;
    }
}

/**
 * Factory function
 */
export function createTemporalPlugin(
    config: TemporalPluginConfig = {}
): TemporalPlugin {
    return new TemporalPlugin(config);
}
