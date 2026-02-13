/**
 * GQP Schema Manager
 * Manages the virtual schema representing all data sources
 */

import type {
    GQPNode,
    GQPEdge,
    GQPCapability,
    GQPSchema as IGQPSchema,
} from "./types.js";

export class GQPSchema implements IGQPSchema {
    private nodes: Map<string, GQPNode> = new Map();
    private rootNodeNames: Set<string> = new Set();
    private edgeIndex: Map<string, Set<string>> = new Map();

    /**
     * Add a node to the schema
     */
    addNode(node: GQPNode, isRoot = true): void {
        this.nodes.set(node.name, node);

        if (isRoot) {
            this.rootNodeNames.add(node.name);
        }

        // Index edges for fast neighbor lookup
        for (const edge of node.edges) {
            if (!this.edgeIndex.has(node.name)) {
                this.edgeIndex.set(node.name, new Set());
            }
            this.edgeIndex.get(node.name)!.add(edge.to);
        }
    }

    /**
     * Get a node by name
     */
    getNode(name: string): GQPNode | undefined {
        return this.nodes.get(name);
    }

    /**
     * Get all root nodes (entry points for exploration)
     */
    getRootNodes(): GQPNode[] {
        const roots: GQPNode[] = [];
        for (const name of this.rootNodeNames) {
            const node = this.nodes.get(name);
            if (node) {
                roots.push(node);
            }
        }
        return roots;
    }

    /**
     * Get neighboring nodes (connected via edges)
     */
    getNeighbors(nodeName: string, limit = 5): GQPNode[] {
        const node = this.nodes.get(nodeName);
        if (!node) return [];

        const neighbors: GQPNode[] = [];
        const edgeTargets = this.edgeIndex.get(nodeName) || new Set();

        for (const targetName of edgeTargets) {
            if (neighbors.length >= limit) break;
            const targetNode = this.nodes.get(targetName);
            if (targetNode) {
                neighbors.push(targetNode);
            }
        }

        // Also include nodes that point TO this node (reverse edges)
        for (const [sourceNodeName, targets] of this.edgeIndex.entries()) {
            if (neighbors.length >= limit) break;
            if (targets.has(nodeName) && sourceNodeName !== nodeName) {
                const sourceNode = this.nodes.get(sourceNodeName);
                if (sourceNode && !neighbors.includes(sourceNode)) {
                    neighbors.push(sourceNode);
                }
            }
        }

        return neighbors.slice(0, limit);
    }

    /**
     * Get all nodes in the schema
     */
    getAllNodes(): GQPNode[] {
        return Array.from(this.nodes.values());
    }

    /**
     * Get total node count
     */
    getNodeCount(): number {
        return this.nodes.size;
    }

    /**
     * Get all unique capabilities across the schema
     */
    getAllCapabilities(): GQPCapability[] {
        const caps = new Set<GQPCapability>();
        for (const node of this.nodes.values()) {
            for (const cap of node.capabilities) {
                caps.add(cap);
            }
        }
        return Array.from(caps);
    }

    /**
     * Find shortest path between two nodes
     */
    findPath(from: string, to: string, maxDepth = 4): string[] | null {
        if (from === to) return [from];
        if (!this.nodes.has(from) || !this.nodes.has(to)) return null;

        const visited = new Set<string>();
        const queue: Array<{ node: string; path: string[] }> = [
            { node: from, path: [from] },
        ];

        while (queue.length > 0) {
            const current = queue.shift()!;

            if (current.path.length > maxDepth) continue;
            if (visited.has(current.node)) continue;

            visited.add(current.node);

            const neighbors = this.edgeIndex.get(current.node) || new Set();
            for (const neighbor of neighbors) {
                const newPath = [...current.path, neighbor];
                if (neighbor === to) {
                    return newPath;
                }
                queue.push({ node: neighbor, path: newPath });
            }
        }

        return null;
    }

    /**
     * Get edge information between two nodes
     */
    getEdge(from: string, to: string): GQPEdge | undefined {
        const node = this.nodes.get(from);
        if (!node) return undefined;
        return node.edges.find((e) => e.to === to);
    }

    /**
     * Search nodes by name or description
     */
    searchNodes(query: string, limit = 10): GQPNode[] {
        const lowerQuery = query.toLowerCase();
        const results: GQPNode[] = [];

        for (const node of this.nodes.values()) {
            if (results.length >= limit) break;

            const nameMatch = node.name.toLowerCase().includes(lowerQuery);
            const descMatch = node.description?.toLowerCase().includes(lowerQuery);

            if (nameMatch || descMatch) {
                results.push(node);
            }
        }

        return results;
    }

    /**
     * Clear all nodes
     */
    clear(): void {
        this.nodes.clear();
        this.rootNodeNames.clear();
        this.edgeIndex.clear();
    }

    /**
     * Export schema as JSON-serializable object
     */
    toJSON(): {
        nodes: GQPNode[];
        rootNodes: string[];
        capabilities: GQPCapability[];
    } {
        return {
            nodes: this.getAllNodes(),
            rootNodes: Array.from(this.rootNodeNames),
            capabilities: this.getAllCapabilities(),
        };
    }

    /**
     * Create schema from JSON
     */
    static fromJSON(data: { nodes: GQPNode[]; rootNodes: string[] }): GQPSchema {
        const schema = new GQPSchema();
        const rootSet = new Set(data.rootNodes);

        for (const node of data.nodes) {
            schema.addNode(node, rootSet.has(node.name));
        }

        return schema;
    }
}
