import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "adapters/prisma/index": "src/adapters/prisma/index.ts",
        "adapters/rest/index": "src/adapters/rest/index.ts",
        "bridges/mcp/index": "src/bridges/mcp/index.ts",
        "bridges/openai/index": "src/bridges/openai/index.ts",
        "bridges/langchain/index": "src/bridges/langchain/index.ts",
        "bridges/vercel-ai/index": "src/bridges/vercel-ai/index.ts",
        "plugins/vector/index": "src/plugins/vector/index.ts",
        "plugins/temporal/index": "src/plugins/temporal/index.ts",
        "plugins/cache/index": "src/plugins/cache/index.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: [
        "@modelcontextprotocol/sdk",
        "@prisma/client",
        "@pinecone-database/pinecone",
        "langchain",
        "chrono-node",
        "zod",
        "ai",
    ],
});
