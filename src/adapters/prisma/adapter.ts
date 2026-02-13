/**
 * Prisma Adapter for GQP
 * Introspects Prisma schema and translates GQP queries to Prisma operations
 */

import type {
  GQPAdapter,
  GQPNode,
  GQPField,
  GQPEdge,
  GQPCapability,
  GQPDirective,
  FieldType,
  RelationType,
  QueryFilters,
  QueryOptions,
} from "../../core/types.js";

/**
 * Prisma DMMF types (internal to Prisma client)
 */
interface PrismaDMMF {
  datamodel: {
    models: PrismaModel[];
    enums: PrismaEnum[];
  };
}

interface PrismaModel {
  name: string;
  fields: PrismaField[];
  documentation?: string;
}

interface PrismaField {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  isList: boolean;
  isRequired: boolean;
  isId: boolean;
  isUnique: boolean;
  isReadOnly: boolean;
  hasDefaultValue: boolean;
  relationName?: string;
  relationFromFields?: string[];
  relationToFields?: string[];
  documentation?: string;
}

interface PrismaEnum {
  name: string;
  values: Array<{ name: string }>;
}

/**
 * Prisma adapter configuration
 */
export interface PrismaAdapterConfig {
  /** Models to include (if not specified, all models are included) */
  include?: string[];
  /** Models to exclude */
  exclude?: string[];
  /** Custom descriptions for models */
  descriptions?: Record<string, string>;
  /** Models to treat as root nodes (entry points) */
  rootNodes?: string[];
}

/**
 * Prisma Adapter Implementation
 */
export class PrismaAdapter implements GQPAdapter {
  name = "prisma";
  private client: unknown;
  private config: PrismaAdapterConfig;
  private dmmf: PrismaDMMF | null = null;
  private enumMap: Map<string, string[]> = new Map();

  constructor(prismaClient: unknown, config: PrismaAdapterConfig = {}) {
    this.client = prismaClient;
    this.config = config;
  }

  /**
   * Introspect Prisma schema and return GQP nodes
   */
  async introspect(): Promise<GQPNode[]> {
    this.dmmf = this.getDMMF();
    if (!this.dmmf) {
      throw new Error(
        "Could not access Prisma DMMF. Make sure you are passing a valid Prisma client.",
      );
    }

    // Build enum map for reference
    for (const en of this.dmmf.datamodel.enums) {
      this.enumMap.set(
        en.name,
        en.values.map((v) => v.name),
      );
    }

    const nodes: GQPNode[] = [];

    for (const model of this.dmmf.datamodel.models) {
      // Check include/exclude filters
      if (this.config.include && !this.config.include.includes(model.name)) {
        continue;
      }
      if (this.config.exclude && this.config.exclude.includes(model.name)) {
        continue;
      }

      const node = this.modelToNode(model);
      nodes.push(node);
    }

    return nodes;
  }

  /**
   * Execute a query against Prisma
   */
  async execute(
    nodeName: string,
    filters: QueryFilters,
    options: QueryOptions,
  ): Promise<unknown[]> {
    const modelName = this.getModelName(nodeName);
    const model = this.getModel(modelName);

    if (!model) {
      throw new Error(`Model "${nodeName}" not found in Prisma client`);
    }

    const prismaQuery: Record<string, unknown> = {
      where: this.translateFilters(filters),
      take: Math.min(Math.max(1, options.limit || 10), 100),
      skip: Math.max(0, options.offset || 0),
    };

    if (options.orderBy && typeof options.orderBy.field === "string") {
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.orderBy.field)) {
        prismaQuery.orderBy = {
          [options.orderBy.field]:
            options.orderBy.direction === "desc" ? "desc" : "asc",
        };
      }
    }

    if (options.include && options.include.length > 0) {
      prismaQuery.include = this.buildSafeIncludes(options.include, 3);
    }

    return model.findMany(prismaQuery);
  }

  /**
   * Build safe includes with depth limiting
   */
  private buildSafeIncludes(
    includes: string[],
    maxDepth: number,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const inc of includes) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(inc)) {
        continue;
      }

      const parts = inc.split(".");
      if (parts.length > maxDepth) {
        continue;
      }

      let current = result;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          current[part] = true;
        } else {
          if (!current[part] || current[part] === true) {
            current[part] = { include: {} };
          }
          current = (current[part] as { include: Record<string, unknown> })
            .include;
        }
      }
    }

    return result;
  }

  /**
   * Get total count for a query
   */
  async count(nodeName: string, filters: QueryFilters): Promise<number> {
    const modelName = this.getModelName(nodeName);
    const model = this.getModel(modelName);

    if (!model) {
      throw new Error(`Model "${nodeName}" not found in Prisma client`);
    }

    return model.count({
      where: this.translateFilters(filters),
    });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get Prisma DMMF (Data Model Meta Format)
   */
  private getDMMF(): PrismaDMMF | null {
    const client = this.client as Record<string, unknown>;

    // Try different ways to access DMMF
    if (client._dmmf) {
      return client._dmmf as PrismaDMMF;
    }
    if (client._baseDmmf) {
      return client._baseDmmf as PrismaDMMF;
    }
    // Prisma v5+
    if (
      client._runtimeDataModel &&
      (client._runtimeDataModel as Record<string, unknown>).models
    ) {
      return {
        datamodel: client._runtimeDataModel as PrismaDMMF["datamodel"],
      };
    }

    return null;
  }

  /**
   * Get Prisma model accessor
   */
  private getModel(modelName: string): {
    findMany: (args: unknown) => Promise<unknown[]>;
    count: (args: unknown) => Promise<number>;
  } | null {
    const client = this.client as Record<string, unknown>;
    const lowerName = modelName.charAt(0).toLowerCase() + modelName.slice(1);

    const model = client[lowerName] as {
      findMany: (args: unknown) => Promise<unknown[]>;
      count: (args: unknown) => Promise<number>;
    };

    return model || null;
  }

  /**
   * Convert model name to Prisma accessor name
   */
  private getModelName(nodeName: string): string {
    // GQP uses PascalCase, Prisma uses camelCase for accessors
    return nodeName;
  }

  /**
   * Convert Prisma model to GQP node
   */
  private modelToNode(model: PrismaModel): GQPNode {
    const fields: GQPField[] = [];
    const edges: GQPEdge[] = [];
    const capabilities: GQPCapability[] = [];

    for (const field of model.fields) {
      if (field.kind === "object") {
        // This is a relation - create an edge
        edges.push(this.fieldToEdge(field));
      } else {
        // This is a regular field
        const gqpField = this.fieldToGQPField(field);
        fields.push(gqpField);

        // Infer capabilities from field type
        this.addCapabilitiesForField(gqpField, capabilities);
      }
    }

    return {
      name: model.name,
      description:
        this.config.descriptions?.[model.name] || model.documentation,
      fields,
      edges,
      capabilities: [...new Set(capabilities)],
      source: this.name,
    };
  }

  /**
   * Convert Prisma field to GQP field
   */
  private fieldToGQPField(field: PrismaField): GQPField {
    const directives: GQPDirective[] = [];

    // Auto-apply @search directive for text fields
    if (field.type === "String" && !field.isId) {
      directives.push({
        name: "@search",
        args: { type: "fuzzy" },
      });
    }

    // Auto-apply @reasoning directive for date fields
    if (field.type === "DateTime") {
      directives.push({
        name: "@reasoning",
        args: { type: "temporal" },
      });
    }

    return {
      name: field.name,
      type: this.mapPrismaType(field.type, field.kind),
      nullable: !field.isRequired,
      isList: field.isList,
      description: field.documentation,
      directives,
      enumValues:
        field.kind === "enum" ? this.enumMap.get(field.type) : undefined,
    };
  }

  /**
   * Convert Prisma relation to GQP edge
   */
  private fieldToEdge(field: PrismaField): GQPEdge {
    let relation: RelationType = "hasMany";

    if (field.isList) {
      relation = "hasMany";
    } else if (
      field.relationFromFields &&
      field.relationFromFields.length > 0
    ) {
      relation = "belongsTo";
    } else {
      relation = "hasOne";
    }

    return {
      name: field.name,
      to: field.type,
      relation,
      foreignKey: field.relationFromFields?.[0],
      description: field.documentation,
    };
  }

  /**
   * Map Prisma type to GQP FieldType
   */
  private mapPrismaType(
    prismaType: string,
    kind: PrismaField["kind"],
  ): FieldType {
    if (kind === "enum") {
      return "Enum";
    }

    const typeMap: Record<string, FieldType> = {
      String: "String",
      Int: "Int",
      Float: "Float",
      Boolean: "Boolean",
      DateTime: "DateTime",
      Json: "Json",
      BigInt: "Int",
      Decimal: "Float",
      Bytes: "String",
    };

    return typeMap[prismaType] || "String";
  }

  /**
   * Add capabilities based on field type
   */
  private addCapabilitiesForField(
    field: GQPField,
    capabilities: GQPCapability[],
  ): void {
    if (field.type === "String" && !field.name.endsWith("Id")) {
      capabilities.push("fuzzy_search");
      capabilities.push("full_text");
    }

    if (field.type === "DateTime") {
      capabilities.push("temporal_filter");
    }

    if (field.type === "Enum") {
      capabilities.push("enum_filter");
    }

    if (field.type === "Json") {
      capabilities.push("json_query");
    }
  }

  private static SAFE_OPERATORS = new Set([
    "equals",
    "not",
    "in",
    "notIn",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "startsWith",
    "endsWith",
    "mode",
    "search",
    "AND",
    "OR",
    "NOT",
  ]);

  /**
   * Translate GQP filters to Prisma where clause
   */
  private translateFilters(filters: QueryFilters): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (
        !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) &&
        !["AND", "OR", "NOT"].includes(key)
      ) {
        continue;
      }

      if (["AND", "OR"].includes(key) && Array.isArray(value)) {
        where[key] = value.map((v) =>
          typeof v === "object" && v !== null
            ? this.translateFilters(v as QueryFilters)
            : {},
        );
        continue;
      }

      if (key === "NOT" && typeof value === "object" && value !== null) {
        where[key] = this.translateFilters(value as QueryFilters);
        continue;
      }

      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const valueObj = value as Record<string, unknown>;
        const safeValue: Record<string, unknown> = {};

        for (const [op, opValue] of Object.entries(valueObj)) {
          if (!PrismaAdapter.SAFE_OPERATORS.has(op)) {
            continue;
          }

          if (op === "in" || op === "notIn") {
            if (Array.isArray(opValue) && opValue.length <= 100) {
              safeValue[op] = opValue;
            }
          } else if (
            op === "contains" ||
            op === "startsWith" ||
            op === "endsWith"
          ) {
            if (typeof opValue === "string") {
              safeValue[op] = opValue;
              safeValue["mode"] = "insensitive";
            }
          } else {
            safeValue[op] = opValue;
          }
        }

        if (Object.keys(safeValue).length > 0) {
          where[key] = safeValue;
        }
        continue;
      }

      where[key] = value;
    }

    return where;
  }
}

/**
 * Factory function to create Prisma adapter
 *
 * @example
 * ```typescript
 * import { GQP } from '@mzhub/gqp';
 * import { fromPrisma } from '@mzhub/gqp/prisma';
 * import { prisma } from './db';
 *
 * const graph = new GQP({
 *   sources: {
 *     database: fromPrisma(prisma, {
 *       include: ['User', 'Order', 'Product'],
 *       exclude: ['_migrations']
 *     })
 *   }
 * });
 * ```
 */
export function fromPrisma(
  prismaClient: unknown,
  config: PrismaAdapterConfig = {},
): GQPAdapter {
  return new PrismaAdapter(prismaClient, config);
}
