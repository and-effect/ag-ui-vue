/**
 * Minimal Standard Schema v1 type definitions, inlined from @standard-schema/spec.
 *
 * Standard Schema is a shared interface for TypeScript schema libraries (Zod, Valibot,
 * ArkType, etc.) that standardises validation and type inference across ecosystems.
 * See https://standardschema.dev/
 *
 * We inline these rather than depending on @standard-schema/spec directly because
 * that package only arrives as a transitive dep of vitest — not of our runtime deps.
 *
 * Only the four names used by this package are defined here.
 */

/** Standard Schema v1 — runtime validation + optional JSON Schema conversion. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
    readonly validate: (
      value: unknown,
      options?: { readonly libraryOptions?: Record<string, unknown> | undefined },
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>
    readonly jsonSchema?: {
      readonly input: (options: { readonly target: string }) => Record<string, unknown>
      readonly output: (options: { readonly target: string }) => Record<string, unknown>
    }
  }
}
export declare namespace StandardSchemaV1 {
  type Result<Output> = SuccessResult<Output> | FailureResult
  interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }
  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }
  interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the output type from a Standard Schema.
 * Falls back to `any` for plain JSON Schema objects (backward compatible).
 */
export type SchemaOutput<T> = T extends { '~standard': { types?: infer Types } }
  ? Types extends { output: infer O }
    ? O
    : unknown
  : any

/** Returns true if `v` is a Standard Schema (has `~standard.validate`). */
export function isStandardSchema(v: unknown): v is StandardSchemaV1 {
  return (
    // ArkType schemas are callable functions, not plain objects — accept both.
    (typeof v === 'object' || typeof v === 'function') &&
    v !== null &&
    '~standard' in v &&
    typeof (v as any)['~standard']?.validate === 'function'
  )
}

/**
 * Extract a JSON Schema object from a Standard Schema for use on the wire.
 * Uses the input shape (what the model must produce) rather than the output
 * shape (which may differ after transforms/coercions/defaults).
 *
 * Returns an empty object if the schema doesn't support JSON Schema conversion.
 */
export function extractJSONSchema(schema: StandardSchemaV1): Record<string, unknown> {
  const jsonSchema = (schema as any)['~standard']?.jsonSchema
  if (jsonSchema && typeof jsonSchema.input === 'function') {
    try {
      return jsonSchema.input({ target: 'draft-07' })
    } catch {
      // Schema supports the interface but threw for this target — fall through.
    }
  }
  console.warn(
    '[ag-ui-vue] useFrontendTool: the provided schema does not implement the Standard Schema ' +
      'JSON Schema conversion extension (~standard.jsonSchema.input). ' +
      'The tool will be advertised to the LLM with no parameter shape ({}), ' +
      'which will likely cause invalid arg generation. ' +
      'Use a schema library with JSON Schema support (Zod 4+, ArkType 2+).',
  )
  return {}
}
