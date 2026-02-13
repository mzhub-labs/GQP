/**
 * GQP Cursor Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { GQPGraphCursor, CursorManager } from "../src/core/cursor.js";
import { GQPSchema } from "../src/core/schema.js";
import type { GQPNode } from "../src/core/types.js";

describe("GQPGraphCursor", () => {
    let schema: GQPSchema;

    const testNodes: GQPNode[] = [
        {
            name: "User",
            description: "User accounts",
            fields: [],
            edges: [{ name: "orders", to: "Order", relation: "hasMany" }],
            capabilities: [],
            source: "test",
        },
        {
            name: "Order",
            description: "Customer orders",
            fields: [],
            edges: [
                { name: "user", to: "User", relation: "belongsTo" },
                { name: "products", to: "Product", relation: "hasMany" },
            ],
            capabilities: [],
            source: "test",
        },
        {
            name: "Product",
            description: "Product catalog",
            fields: [],
            edges: [],
            capabilities: [],
            source: "test",
        },
    ];

    beforeEach(() => {
        schema = new GQPSchema();
        for (const node of testNodes) {
            schema.addNode(node);
        }
    });

    describe("navigation", () => {
        it("should start with no current node", () => {
            const cursor = new GQPGraphCursor(schema);
            expect(cursor.getCurrentNode()).toBeNull();
        });

        it("should start with specified node", () => {
            const cursor = new GQPGraphCursor(schema, "User");
            expect(cursor.getCurrentNode()).toBe("User");
        });

        it("should navigate to a node", () => {
            const cursor = new GQPGraphCursor(schema);
            const view = cursor.navigateTo("Order");

            expect(cursor.getCurrentNode()).toBe("Order");
            expect(view.currentNode?.name).toBe("Order");
            expect(view.path).toEqual(["Order"]);
        });

        it("should track navigation path", () => {
            const cursor = new GQPGraphCursor(schema);

            cursor.navigateTo("User");
            cursor.navigateTo("Order");
            cursor.navigateTo("Product");

            const state = cursor.getState();
            expect(state.path).toEqual(["User", "Order", "Product"]);
            expect(state.depth).toBe(2);
        });

        it("should go back to previous node", () => {
            const cursor = new GQPGraphCursor(schema);

            cursor.navigateTo("User");
            cursor.navigateTo("Order");

            const view = cursor.goBack();

            expect(cursor.getCurrentNode()).toBe("User");
            expect(view?.path).toEqual(["User"]);
        });

        it("should return null when going back from root", () => {
            const cursor = new GQPGraphCursor(schema);
            cursor.navigateTo("User");

            const view = cursor.goBack();
            expect(view).toBeNull();
        });

        it("should throw when navigating to non-existent node", () => {
            const cursor = new GQPGraphCursor(schema);

            expect(() => cursor.navigateTo("NonExistent")).toThrow(
                'Node "NonExistent" not found'
            );
        });
    });

    describe("neighborhood", () => {
        it("should show root nodes as neighbors when at root", () => {
            const cursor = new GQPGraphCursor(schema);
            const view = cursor.getNeighborhood();

            expect(view.currentNode).toBeNull();
            expect(view.neighbors.length).toBe(3);
        });

        it("should show related nodes as neighbors", () => {
            const cursor = new GQPGraphCursor(schema, "Order");
            const view = cursor.getNeighborhood();

            expect(view.neighbors.length).toBe(2);
            expect(view.neighbors.some((n) => n.name === "User")).toBe(true);
            expect(view.neighbors.some((n) => n.name === "Product")).toBe(true);
        });

        it("should limit neighborhood size", () => {
            const cursor = new GQPGraphCursor(schema, "Order");
            const view = cursor.getNeighborhood(1);

            expect(view.neighbors.length).toBe(1);
        });
    });

    describe("state", () => {
        it("should have unique ID", () => {
            const cursor1 = new GQPGraphCursor(schema);
            const cursor2 = new GQPGraphCursor(schema);

            expect(cursor1.getId()).not.toBe(cursor2.getId());
        });

        it("should track explored nodes count", () => {
            const cursor = new GQPGraphCursor(schema);

            cursor.navigateTo("User");
            cursor.navigateTo("Order");
            cursor.navigateTo("User"); // Back to User

            const state = cursor.getState();
            expect(state.metadata.exploredNodes).toBe(2); // Only unique nodes
        });

        it("should reset cursor state", () => {
            const cursor = new GQPGraphCursor(schema, "User");
            cursor.navigateTo("Order");

            cursor.reset();

            expect(cursor.getCurrentNode()).toBeNull();
            expect(cursor.getState().path).toEqual([]);
        });
    });

    describe("suggestions", () => {
        it("should suggest unvisited neighbors", () => {
            const cursor = new GQPGraphCursor(schema, "Order");

            const suggestions = cursor.getSuggestedNodes(3);

            expect(suggestions.length).toBe(2);
            expect(suggestions).toContain("User");
            expect(suggestions).toContain("Product");
        });

        it("should not suggest visited nodes", () => {
            const cursor = new GQPGraphCursor(schema);
            cursor.navigateTo("User");
            cursor.navigateTo("Order");

            const suggestions = cursor.getSuggestedNodes(3);

            expect(suggestions).not.toContain("User");
        });
    });
});

describe("CursorManager", () => {
    let schema: GQPSchema;
    let manager: CursorManager;

    beforeEach(() => {
        schema = new GQPSchema();
        schema.addNode({
            name: "User",
            fields: [],
            edges: [],
            capabilities: [],
            source: "test",
        });

        manager = new CursorManager(schema, 3); // Max 3 cursors
    });

    it("should create cursors", () => {
        const cursor = manager.create();
        expect(cursor).toBeDefined();
        expect(manager.size()).toBe(1);
    });

    it("should create cursors with start node", () => {
        const cursor = manager.create("User");
        expect(cursor.getCurrentNode()).toBe("User");
    });

    it("should get cursor by ID", () => {
        const cursor = manager.create();
        const id = cursor.getId();

        const retrieved = manager.get(id);
        expect(retrieved).toBe(cursor);
    });

    it("should return undefined for non-existent ID", () => {
        const cursor = manager.get("non-existent");
        expect(cursor).toBeUndefined();
    });

    it("should delete cursors", () => {
        const cursor = manager.create();
        const id = cursor.getId();

        const deleted = manager.delete(id);

        expect(deleted).toBe(true);
        expect(manager.get(id)).toBeUndefined();
    });

    it("should evict oldest cursor when at capacity", () => {
        const cursor1 = manager.create();
        const id1 = cursor1.getId();

        manager.create();
        manager.create();

        // This should evict cursor1
        manager.create();

        expect(manager.size()).toBe(3);
        expect(manager.get(id1)).toBeUndefined();
    });

    it("should get or create cursor", () => {
        const cursor1 = manager.create();
        const id1 = cursor1.getId();

        // Get existing
        const same = manager.getOrCreate(id1);
        expect(same).toBe(cursor1);

        // Create new when not found
        const newCursor = manager.getOrCreate("non-existent");
        expect(newCursor).not.toBe(cursor1);
    });

    it("should clear all cursors", () => {
        manager.create();
        manager.create();

        manager.clear();

        expect(manager.size()).toBe(0);
    });
});
