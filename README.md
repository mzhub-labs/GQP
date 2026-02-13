# @mzhub/gqp - The Universal Agent Data Layer

<p align="center">
  <strong>"Prisma for AI Agents"</strong>
</p>

<p align="center">
  Zero-config library that transforms messy databases and APIs into an intelligent, traversable graph optimized for LLM agents.
</p>

---

## The Problem

AI agents using tools face two critical problems:

1. **Token explosion**: 50+ tools x 200 tokens each = 10,000+ tokens just for tool descriptions
2. **Tool confusion**: Agents pick wrong tools, can't understand relationships between data

## The Solution

GQP consolidates all data access into **ONE dynamic tool** that navigates a graph of your data:

```
WITHOUT GQP:                    WITH GQP:
+-------------------+           +-------------------+
| 50 separate tools |           | 1 universal tool  |
| 10,000 tokens     |    ->     | 200-500 tokens    |
| No relationships  |           | Full graph nav    |
+-------------------+           +-------------------+
```

**Result:** 95%+ token reduction, smarter agents, zero tool confusion.

---

## Quick Start

### Installation

```bash
npm install @mzhub/gqp
```

### Basic Usage

```javascript
import { GQP } from "@mzhub/gqp";
import { fromPrisma } from "@mzhub/gqp/prisma";
import { prisma } from "./db";

// Create graph from your database
const graph = new GQP({
  sources: {
    database: fromPrisma(prisma),
  },
});

// Agent calls this ONE tool instead of 50+ separate tools
const result = await graph.handleToolCall({
  action: "explore",
});

// Returns available data nodes
// {
//   availableNodes: [
//     { name: 'User', description: 'User accounts', operations: ['query', 'filter'] },
//     { name: 'Order', description: 'Customer orders', operations: ['query', 'filter'] },
//     { name: 'Product', description: 'Product catalog', operations: ['query', 'filter'] }
//   ],
//   message: 'Start by navigating to one of these nodes',
//   totalNodes: 3
// }
```

---

## How It Works

### The One Tool Pattern

Instead of giving agents 50+ separate tools, GQP provides ONE tool with three actions:

| Action     | Description               | When to Use                  |
| ---------- | ------------------------- | ---------------------------- |
| `explore`  | List available data nodes | Start here to discover data  |
| `navigate` | Focus on a specific node  | See fields and relationships |
| `query`    | Search and filter data    | Get actual results           |

### Agent Workflow

```javascript
// Step 1: Explore - What data is available?
await graph.handleToolCall({ action: "explore" });
// -> ["User", "Order", "Product"]

// Step 2: Navigate - What's in Order?
await graph.handleToolCall({ action: "navigate", node: "Order" });
// -> { fields: [...], relatedNodes: ["User", "Product"], capabilities: [...] }

// Step 3: Query - Get the data
await graph.handleToolCall({
  action: "query",
  node: "Order",
  filters: { status: "pending" },
});
// -> { data: [...], meta: { total: 42 } }
```

---

## Framework Integrations

### MCP (Model Context Protocol)

```javascript
import { GQP } from "@mzhub/gqp";
import { serveMCP } from "@mzhub/gqp/mcp";
import { fromPrisma } from "@mzhub/gqp/prisma";

const graph = new GQP({
  sources: { db: fromPrisma(prisma) },
});

// Start MCP server with single tool
serveMCP(graph, {
  name: "my-data-server",
});
```

### OpenAI Functions

```javascript
import { toOpenAIFunctions, createExecutor } from '@mzhub/gqp/openai';

const functions = toOpenAIFunctions(graph);
const executor = createExecutor(graph);

const response = await openai.chat.completions.create({
  model: 'gpt-4-turbo',
  messages: [...],
  functions,
  function_call: 'auto'
});

// Execute the function call
if (response.choices[0].message.function_call) {
  const result = await executor(response.choices[0].message.function_call);
}
```

### LangChain

```javascript
import { createTool } from "@mzhub/gqp/langchain";
import { ChatOpenAI } from "langchain/chat_models/openai";

const tool = await createTool(graph);

const agent = createToolCallingAgent({
  llm: new ChatOpenAI({ modelName: "gpt-4" }),
  tools: [tool], // Just ONE tool!
});
```

### LangChain - Tool Wrapper Mode

**Already have hand-written tools?** Use `wrapTools` to consolidate them:

```javascript
import { wrapTools } from "@mzhub/gqp/langchain";
import {
  searchProductsTool,
  getProductDetailsTool,
  searchVendorsTool,
  listOrdersTool,
} from "./tools";

// Wrap existing tools into ONE navigable interface
const gqpTool = await wrapTools({
  graph: {
    Product: {
      description: "Product catalog",
      tools: {
        search: searchProductsTool,
        getDetails: getProductDetailsTool,
      },
      relations: { vendor: "Vendor" },
    },
    Vendor: {
      description: "Vendor search",
      tools: { search: searchVendorsTool },
    },
    Order: {
      description: "Order history",
      tools: { list: listOrdersTool },
    },
  },
});

// Now: 1 tool instead of 24!
const agent = createReactAgent({
  llm: new ChatOpenAI(),
  tools: [
    gqpTool, // Wraps all read tools
    createOrderTool, // Keep action tools separate
    addToCartTool,
  ],
});
```

**Agent workflow with wrapped tools:**

```javascript
// 1. Explore available nodes
{ action: 'explore' }
// -> { availableNodes: ['Product', 'Vendor', 'Order'] }

// 2. Navigate to see operations
{ action: 'navigate', node: 'Product' }
// -> { operations: ['search', 'getDetails'], relations: ['vendor'] }

// 3. Execute the actual tool
{ action: 'execute', node: 'Product', operation: 'search', params: { query: 'rice' } }
// -> Calls searchProductsTool.invoke({ query: 'rice' })
```

### Vercel AI SDK

```javascript
import { createTools } from "@mzhub/gqp/vercel-ai";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const tools = await createTools(graph);

const result = await streamText({
  model: openai("gpt-4-turbo"),
  prompt: "Find customers with high-value orders",
  tools,
});
```

---

## Data Source Adapters

### Prisma (Primary)

```javascript
import { fromPrisma } from "@mzhub/gqp/prisma";

const graph = new GQP({
  sources: {
    database: fromPrisma(prisma, {
      include: ["User", "Order", "Product"],
      exclude: ["_migrations"],
      descriptions: {
        User: "Customer accounts",
        Order: "Purchase orders",
      },
    }),
  },
});
```

### REST APIs

```javascript
import { fromREST } from "@mzhub/gqp/rest";

const graph = new GQP({
  sources: {
    stripe: fromREST({
      baseURL: "https://api.stripe.com/v1",
      auth: { type: "bearer", token: process.env.STRIPE_KEY },
      resources: {
        charges: {
          endpoint: "/charges",
          idField: "id",
          schema: {
            id: "String",
            amount: "Int",
            status: "String",
          },
        },
      },
    }),
  },
});
```

---

## Plugins

### Vector Search (Semantic Search)

```javascript
import { VectorPlugin } from "@mzhub/gqp/vector";

const graph = new GQP({
  sources: { db: fromPrisma(prisma) },
  plugins: [
    new VectorPlugin({
      provider: "pinecone",
      config: {
        pinecone: {
          apiKey: process.env.PINECONE_KEY,
          index: "products",
        },
        openai: {
          apiKey: process.env.OPENAI_KEY,
        },
      },
    }),
  ],
});

// Now queries support semantic search!
await graph.handleToolCall({
  action: "query",
  node: "Product",
  query: "comfortable running shoes", // Semantic search
});
```

### Temporal Reasoning (Natural Language Dates)

```javascript
import { TemporalPlugin } from "@mzhub/gqp/temporal";

const graph = new GQP({
  sources: { db: fromPrisma(prisma) },
  plugins: [
    new TemporalPlugin({
      timezone: "America/New_York",
      patterns: {
        Q1: { start: "01-01", end: "03-31" },
        Q2: { start: "04-01", end: "06-30" },
      },
    }),
  ],
});

// Natural language dates work automatically
await graph.handleToolCall({
  action: "query",
  node: "Order",
  filters: { createdAt: "last week" }, // Parsed to date range
});
```

### Caching

```javascript
import { CachePlugin } from "@mzhub/gqp/cache";

const graph = new GQP({
  sources: { db: fromPrisma(prisma) },
  plugins: [
    new CachePlugin({
      provider: "memory",
      ttl: 300, // 5 minutes
      maxSize: 1000,
    }),
  ],
});
```

---

## API Reference

### GQP Class

```typescript
class GQP {
  constructor(config: GQPConfig);

  // Main tool interface
  handleToolCall(params: ToolCallParams): Promise<ToolCallResult>;

  // Get tool definition for frameworks
  getToolDefinition(): {
    name: string;
    description: string;
    inputSchema: object;
  };

  // Create navigation cursor
  createCursor(startNode?: string): GQPGraphCursor;
}
```

### ToolCallParams

```typescript
interface ToolCallParams {
  action: "explore" | "navigate" | "query" | "introspect";
  node?: string; // Required for navigate/query
  query?: string; // Semantic search query
  filters?: object; // Field filters
  options?: {
    limit?: number;
    offset?: number;
    include?: string[];
  };
}
```

### Configuration

```typescript
interface GQPConfig {
  sources: Record<string, GQPAdapter>;
  features?: {
    fuzzySearch?: boolean;
    temporalReasoning?: boolean;
    neighborhoodSize?: number; // Default: 5
    maxDepth?: number; // Default: 4
  };
  plugins?: GQPPlugin[];
}
```

---

## Security

GQP includes production-ready security features that are **opt-in** and **configurable**.

### Input Validation

```javascript
import { GQP } from "@mzhub/gqp";

const graph = new GQP({
  sources: { db: fromPrisma(prisma) },
  validation: {
    strictNodeNames: true,
    maxFilterDepth: 5,
    maxArrayInFilter: 100,
    allowedFilterOperators: ["equals", "in", "lt", "gt", "contains"],
  },
  limits: {
    maxLimit: 100,
    defaultLimit: 10,
    maxOffset: 10000,
    maxIncludeDepth: 3,
    timeout: 30000,
  },
});
```

### Error Handling

Errors are environment-aware - detailed in development, safe in production:

```javascript
import { GQPError, isGQPError } from "@mzhub/gqp";

try {
  await graph.handleToolCall({ action: "query", node: "InvalidNode" });
} catch (error) {
  if (isGQPError(error)) {
    console.log(error.code); // 'NODE_NOT_FOUND'
    console.log(error.message); // Safe for clients
  }
}
```

### Access Control & Row-Level Security

```javascript
import { createSecurityManager } from "@mzhub/gqp";

const graph = new GQP({
  sources: { db: fromPrisma(prisma) },
  security: {
    hiddenNodes: ["AuditLog", "InternalConfig"],
    hiddenFields: { User: ["passwordHash", "ssn"] },
    nodeAccess: {
      Order: (ctx) => ctx.user?.role === "admin" || ctx.user?.id != null,
    },
    rowLevelSecurity: {
      Order: (ctx) => ({ userId: ctx.user?.id }),
    },
    introspection: "nodes-only", // 'full' | 'nodes-only' | 'none'
  },
});

// Pass security context with each call
await graph.handleToolCall(
  { action: "query", node: "Order" },
  { user: { id: 123, role: "customer" } },
);
```

### Adapter Security

**Prisma Adapter:** Operator allowlist, field validation, include depth limiting.

**REST Adapter:** SSRF protection, protocol validation, header injection prevention.

### Safe JSON Utilities

```javascript
import { safeJsonParse, safeJsonStringify } from "@mzhub/gqp";

const data = safeJsonParse(untrustedInput, { default: "value" });
const json = safeJsonStringify(objectWithCircularRefs);
```

---

## Package Exports

```javascript
// Core
import { GQP, GQPSchema, GQPGraphCursor } from "@mzhub/gqp";

// Adapters
import { fromPrisma } from "@mzhub/gqp/prisma";
import { fromREST } from "@mzhub/gqp/rest";

// Bridges
import { serveMCP } from "@mzhub/gqp/mcp";
import { toOpenAIFunctions } from "@mzhub/gqp/openai";
import { createTool } from "@mzhub/gqp/langchain";
import { createTools } from "@mzhub/gqp/vercel-ai";

// Plugins
import { VectorPlugin } from "@mzhub/gqp/vector";
import { TemporalPlugin } from "@mzhub/gqp/temporal";
import { CachePlugin } from "@mzhub/gqp/cache";
```

---

## Token Efficiency Comparison

| Approach         | Tools | Tokens       | Setup     |
| ---------------- | ----- | ------------ | --------- |
| Manual MCP tools | 50+   | ~10,000      | Days      |
| LangChain tools  | 50+   | ~10,000      | Hours     |
| **GQP**          | **1** | **~200-500** | **5 min** |

---

## License

MIT

---
