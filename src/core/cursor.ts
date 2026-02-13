/**
 * GQP Graph Cursor
 * Manages navigation state through the data graph
 */

import type {
  GQPCursor,
  NeighborhoodView,
  GQPAction,
  RelationType,
} from "./types.js";
import type { GQPSchema } from "./schema.js";
import { createError } from "./errors.js";

/**
 * Generate a unique cursor ID
 */
function generateCursorId(): string {
  return `cursor_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export class GQPGraphCursor {
  private schema: GQPSchema;
  private cursor: GQPCursor;
  private maxPathLength: number;

  constructor(schema: GQPSchema, startNode?: string, maxPathLength = 100) {
    this.schema = schema;
    this.maxPathLength = maxPathLength;

    this.cursor = {
      id: generateCursorId(),
      currentNode: startNode || null,
      neighbors: [],
      path: startNode ? [startNode] : [],
      depth: startNode ? 0 : -1,
      createdAt: Date.now(),
      metadata: {
        totalNodes: schema.getNodeCount(),
        exploredNodes: startNode ? 1 : 0,
      },
    };

    if (startNode) {
      this.updateNeighbors();
    }
  }

  /**
   * Get the cursor ID
   */
  getId(): string {
    return this.cursor.id;
  }

  /**
   * Get the current cursor state
   */
  getState(): GQPCursor {
    return { ...this.cursor };
  }

  /**
   * Get current node name
   */
  getCurrentNode(): string | null {
    return this.cursor.currentNode;
  }

  /**
   * Get cursor creation time
   */
  getCreatedAt(): number {
    return this.cursor.createdAt;
  }

  /**
   * Navigate to a specific node
   */
  navigateTo(nodeName: string): NeighborhoodView {
    const node = this.schema.getNode(nodeName);
    if (!node) {
      throw createError.nodeNotFound(nodeName);
    }

    this.cursor.currentNode = nodeName;
    this.cursor.depth = this.cursor.path.length;

    if (this.cursor.path.length >= this.maxPathLength) {
      this.cursor.path.shift();
    }
    this.cursor.path.push(nodeName);

    this.cursor.metadata.exploredNodes = new Set(this.cursor.path).size;

    this.updateNeighbors();

    return this.getNeighborhood();
  }

  /**
   * Go back to previous node
   */
  goBack(): NeighborhoodView | null {
    if (this.cursor.path.length <= 1) {
      return null;
    }

    this.cursor.path.pop();
    const previousNode = this.cursor.path[this.cursor.path.length - 1];
    this.cursor.currentNode = previousNode || null;
    this.cursor.depth = Math.max(0, this.cursor.depth - 1);

    this.updateNeighbors();

    return this.getNeighborhood();
  }

  /**
   * Reset cursor to initial state
   */
  reset(): void {
    this.cursor.currentNode = null;
    this.cursor.neighbors = [];
    this.cursor.path = [];
    this.cursor.depth = -1;
    this.cursor.metadata.exploredNodes = 0;
  }

  /**
   * Get current neighborhood view (limited context for agents)
   */
  getNeighborhood(size = 5): NeighborhoodView {
    const currentNodeName = this.cursor.currentNode;
    const currentNode = currentNodeName
      ? this.schema.getNode(currentNodeName)
      : null;

    if (!currentNode) {
      const rootNodes = this.schema.getRootNodes().slice(0, size);
      return {
        currentNode: null,
        neighbors: rootNodes.map((n) => ({
          name: n.name,
          description: n.description,
          relation: "hasMany" as RelationType,
          distance: 1,
        })),
        path: [],
        depth: -1,
        availableActions: ["explore", "navigate", "introspect"],
      };
    }

    const neighbors = this.schema.getNeighbors(currentNodeName!, size);
    const neighborViews = neighbors.map((n) => {
      const edge = this.schema.getEdge(currentNodeName!, n.name);
      return {
        name: n.name,
        description: n.description,
        relation: edge?.relation || ("hasMany" as RelationType),
        distance: 1,
      };
    });

    const availableActions: GQPAction[] = ["navigate", "query"];
    if (this.cursor.path.length > 1) {
      availableActions.push("explore");
    }

    return {
      currentNode,
      neighbors: neighborViews,
      path: [...this.cursor.path],
      depth: this.cursor.depth,
      availableActions,
    };
  }

  /**
   * Check if a node is reachable from current position
   */
  canReach(nodeName: string, maxDepth = 4): boolean {
    if (!this.cursor.currentNode) return true;
    const path = this.schema.findPath(
      this.cursor.currentNode,
      nodeName,
      maxDepth,
    );
    return path !== null;
  }

  /**
   * Get suggested next nodes based on traversal patterns
   */
  getSuggestedNodes(limit = 3): string[] {
    if (!this.cursor.currentNode) {
      return this.schema
        .getRootNodes()
        .slice(0, limit)
        .map((n) => n.name);
    }

    const visited = new Set(this.cursor.path);
    const neighbors = this.schema.getNeighbors(this.cursor.currentNode, 10);

    const unvisited = neighbors
      .filter((n) => !visited.has(n.name))
      .slice(0, limit);

    return unvisited.map((n) => n.name);
  }

  /**
   * Update neighbors list based on current position
   */
  private updateNeighbors(): void {
    if (!this.cursor.currentNode) {
      this.cursor.neighbors = this.schema.getRootNodes().map((n) => n.name);
    } else {
      const neighbors = this.schema.getNeighbors(this.cursor.currentNode);
      this.cursor.neighbors = neighbors.map((n) => n.name);
    }
  }

  /**
   * Serialize cursor for storage/transport
   */
  toJSON(): GQPCursor {
    return this.getState();
  }

  /**
   * Restore cursor from serialized state
   */
  static fromJSON(
    schema: GQPSchema,
    state: GQPCursor,
    maxPathLength = 100,
  ): GQPGraphCursor {
    const cursor = new GQPGraphCursor(schema, undefined, maxPathLength);
    cursor.cursor = { ...state };
    return cursor;
  }
}

/**
 * Cursor manager for handling multiple cursors (multi-session support)
 */
export class CursorManager {
  private cursors: Map<string, GQPGraphCursor> = new Map();
  private schema: GQPSchema;
  private maxCursors: number;
  private cursorTTL: number;
  private maxPathLength: number;

  constructor(
    schema: GQPSchema,
    maxCursors = 100,
    cursorTTL = 30 * 60 * 1000,
    maxPathLength = 100,
  ) {
    this.schema = schema;
    this.maxCursors = maxCursors;
    this.cursorTTL = cursorTTL;
    this.maxPathLength = maxPathLength;
  }

  /**
   * Create a new cursor
   */
  create(startNode?: string): GQPGraphCursor {
    this.evictExpired();

    if (this.cursors.size >= this.maxCursors) {
      this.evictOldest();
    }

    const cursor = new GQPGraphCursor(
      this.schema,
      startNode,
      this.maxPathLength,
    );
    this.cursors.set(cursor.getId(), cursor);
    return cursor;
  }

  /**
   * Get cursor by ID
   */
  get(id: string): GQPGraphCursor | undefined {
    const cursor = this.cursors.get(id);

    if (cursor && this.isExpired(cursor)) {
      this.cursors.delete(id);
      return undefined;
    }

    return cursor;
  }

  /**
   * Delete a cursor
   */
  delete(id: string): boolean {
    return this.cursors.delete(id);
  }

  /**
   * Get or create cursor
   */
  getOrCreate(id?: string, startNode?: string): GQPGraphCursor {
    if (id) {
      const existing = this.get(id);
      if (existing) return existing;
    }
    return this.create(startNode);
  }

  /**
   * Clear all cursors
   */
  clear(): void {
    this.cursors.clear();
  }

  /**
   * Get cursor count
   */
  size(): number {
    return this.cursors.size;
  }

  /**
   * Check if cursor is expired
   */
  private isExpired(cursor: GQPGraphCursor): boolean {
    return Date.now() - cursor.getCreatedAt() > this.cursorTTL;
  }

  /**
   * Evict expired cursors
   */
  private evictExpired(): void {
    const now = Date.now();
    for (const [id, cursor] of this.cursors.entries()) {
      if (now - cursor.getCreatedAt() > this.cursorTTL) {
        this.cursors.delete(id);
      }
    }
  }

  /**
   * Evict oldest cursor
   */
  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, cursor] of this.cursors.entries()) {
      const createdAt = cursor.getCreatedAt();
      if (createdAt < oldestTime) {
        oldestTime = createdAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.cursors.delete(oldestId);
    }
  }
}
