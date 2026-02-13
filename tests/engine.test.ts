/**
 * GQP Engine Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { GQP } from "../src/core/engine.js";
import { GQPSchema } from "../src/core/schema.js";
import type { GQPAdapter, GQPNode, QueryFilters, QueryOptions } from "../src/core/types.js";

/**
 * Mock adapter for testing
 */
class MockAdapter implements GQPAdapter {
    name = "mock";
    private nodes: GQPNode[];
    private data: Map<string, unknown[]> = new Map();

    constructor(nodes: GQPNode[]) {
        this.nodes = nodes;
    }

    setData(nodeName: string, data: unknown[]): void {
        this.data.set(nodeName, data);
    }

    async introspect(): Promise<GQPNode[]> {
        return this.nodes;
    }

    async execute(
        nodeName: string,
        _filters: QueryFilters,
        options: QueryOptions
    ): Promise<unknown[]> {
        const data = this.data.get(nodeName) || [];
        const limit = options.limit || 10;
        return data.slice(0, limit);
    }

    async count(nodeName: string): Promise<number> {
        return (this.data.get(nodeName) || []).length;
    }
}

describe("GQP Engine", () => {
    let mockAdapter: MockAdapter;
    let graph: GQP;

    const testNodes: GQPNode[] = [
        {
            name: "User",
            description: "User accounts",
            fields: [
                { name: "id", type: "ID", nullable: false, isList: false, directives: [] },
                { name: "name", type: "String", nullable: false, isList: false, directives: [] },
                { name: "email", type: "String", nullable: false, isList: false, directives: [{ name: "@search", args: { type: "fuzzy" } }] },
                { name: "createdAt", type: "DateTime", nullable: false, isList: false, directives: [{ name: "@reasoning", args: { type: "temporal" } }] },
            ],
            edges: [
                { name: "orders", to: "Order", relation: "hasMany" },
            ],
            capabilities: ["fuzzy_search", "temporal_filter"],
            source: "mock",
        },
        {
            name: "Order",
            description: "Customer orders",
            fields: [
                { name: "id", type: "ID", nullable: false, isList: false, directives: [] },
                { name: "total", type: "Float", nullable: false, isList: false, directives: [] },
                { name: "status", type: "Enum", nullable: false, isList: false, directives: [], enumValues: ["pending", "completed", "cancelled"] },
                { name: "createdAt", type: "DateTime", nullable: false, isList: false, directives: [{ name: "@reasoning", args: { type: "temporal" } }] },
            ],
            edges: [
                { name: "user", to: "User", relation: "belongsTo" },
                { name: "products", to: "Product", relation: "hasMany" },
            ],
            capabilities: ["temporal_filter", "enum_filter"],
            source: "mock",
        },
        {
            name: "Product",
            description: "Product catalog",
            fields: [
                { name: "id", type: "ID", nullable: false, isList: false, directives: [] },
                { name: "name", type: "String", nullable: false, isList: false, directives: [] },
                { name: "description", type: "String", nullable: true, isList: false, directives: [{ name: "@search", args: { type: "fuzzy" } }] },
                { name: "price", type: "Float", nullable: false, isList: false, directives: [] },
            ],
            edges: [],
            capabilities: ["fuzzy_search", "full_text"],
            source: "mock",
        },
    ];

    beforeEach(() => {
        mockAdapter = new MockAdapter(testNodes);
        mockAdapter.setData("User", [
            { id: "1", name: "Alice", email: "alice@example.com" },
            { id: "2", name: "Bob", email: "bob@example.com" },
        ]);
        mockAdapter.setData("Order", [
            { id: "1", total: 99.99, status: "completed", userId: "1" },
            { id: "2", total: 149.99, status: "pending", userId: "2" },
        ]);
        mockAdapter.setData("Product", [
            { id: "1", name: "Widget", description: "A useful widget", price: 29.99 },
        ]);

        graph = new GQP({
            sources: { mock: mockAdapter },
        });
    });

    describe("handleToolCall", () => {
        it("should explore available nodes", async () => {
            const result = await graph.handleToolCall({ action: "explore" });

            expect(result).toHaveProperty("availableNodes");
            expect(result).toHaveProperty("message");
            expect(result).toHaveProperty("totalNodes");

            const exploreResult = result as { availableNodes: { name: string }[]; totalNodes: number };
            expect(exploreResult.availableNodes.length).toBeGreaterThan(0);
            expect(exploreResult.totalNodes).toBe(3);
        });

        it("should navigate to a node", async () => {
            const result = await graph.handleToolCall({
                action: "navigate",
                node: "User",
            });

            expect(result).toHaveProperty("currentNode", "User");
            expect(result).toHaveProperty("fields");
            expect(result).toHaveProperty("relatedNodes");

            const navResult = result as {
                fields: { name: string }[];
                relatedNodes: { name: string }[];
            };
            expect(navResult.fields.length).toBe(4);
            expect(navResult.relatedNodes.some(r => r.name === "Order")).toBe(true);
        });

        it("should throw error when navigating to non-existent node", async () => {
            await expect(
                graph.handleToolCall({ action: "navigate", node: "NonExistent" })
            ).rejects.toThrow('Node "NonExistent" not found');
        });

        it("should query a node", async () => {
            const result = await graph.handleToolCall({
                action: "query",
                node: "User",
                options: { limit: 10 },
            });

            expect(result).toHaveProperty("data");
            expect(result).toHaveProperty("meta");

            const queryResult = result as { data: unknown[]; meta: { executionTimeMs: number } };
            expect(queryResult.data.length).toBe(2);
            expect(queryResult.meta.executionTimeMs).toBeGreaterThanOrEqual(0);
        });

        it("should introspect the schema", async () => {
            const result = await graph.handleToolCall({ action: "introspect" });

            expect(result).toHaveProperty("nodes");
            expect(result).toHaveProperty("capabilities");
            expect(result).toHaveProperty("version");

            const introResult = result as { nodes: GQPNode[] };
            expect(introResult.nodes.length).toBe(3);
        });

        it("should throw error for unknown action", async () => {
            await expect(
                graph.handleToolCall({ action: "unknown" as any })
            ).rejects.toThrow("Unknown action: unknown");
        });
    });

    describe("getToolDefinition", () => {
        it("should return valid tool definition", async () => {
            await graph.handleToolCall({ action: "explore" }); // Initialize

            const toolDef = graph.getToolDefinition();

            expect(toolDef.name).toBe("navigate_data_graph");
            expect(toolDef.description).toBeTruthy();
            expect(toolDef.inputSchema).toHaveProperty("type", "object");
            expect(toolDef.inputSchema).toHaveProperty("properties");
        });
    });
});

describe("GQPSchema", () => {
    let schema: GQPSchema;

    beforeEach(() => {
        schema = new GQPSchema();

        schema.addNode({
            name: "User",
            fields: [],
            edges: [{ name: "orders", to: "Order", relation: "hasMany" }],
            capabilities: [],
            source: "test",
        });

        schema.addNode({
            name: "Order",
            fields: [],
            edges: [
                { name: "user", to: "User", relation: "belongsTo" },
                { name: "products", to: "Product", relation: "hasMany" },
            ],
            capabilities: [],
            source: "test",
        });

        schema.addNode({
            name: "Product",
            fields: [],
            edges: [],
            capabilities: [],
            source: "test",
        });
    });

    it("should add and retrieve nodes", () => {
        const user = schema.getNode("User");
        expect(user).toBeDefined();
        expect(user?.name).toBe("User");
    });

    it("should return undefined for non-existent node", () => {
        const node = schema.getNode("NonExistent");
        expect(node).toBeUndefined();
    });

    it("should get root nodes", () => {
        const roots = schema.getRootNodes();
        expect(roots.length).toBe(3);
    });

    it("should get neighbors", () => {
        const neighbors = schema.getNeighbors("Order");
        expect(neighbors.length).toBe(2);
        expect(neighbors.some(n => n.name === "User")).toBe(true);
        expect(neighbors.some(n => n.name === "Product")).toBe(true);
    });

    it("should find path between nodes", () => {
        const path = schema.findPath("User", "Product");
        expect(path).toEqual(["User", "Order", "Product"]);
    });

    it("should return null for unreachable nodes", () => {
        // Add isolated node
        schema.addNode({
            name: "Isolated",
            fields: [],
            edges: [],
            capabilities: [],
            source: "test",
        }, false);

        const path = schema.findPath("User", "Isolated");
        expect(path).toBeNull();
    });

    it("should get all nodes", () => {
        const allNodes = schema.getAllNodes();
        expect(allNodes.length).toBe(3);
    });

    it("should search nodes by name", () => {
        const results = schema.searchNodes("ord");
        expect(results.length).toBe(1);
        expect(results[0].name).toBe("Order");
    });
});
