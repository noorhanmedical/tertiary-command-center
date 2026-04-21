// Backward-compatible barrel — every table, schema, and type is now defined
// under shared/schema/<domain>.ts. New code should prefer the domain-keyed
// import path; this re-export keeps existing `@shared/schema` consumers
// compiling unchanged.
export * from "./schema/index";
