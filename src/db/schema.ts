// Drizzle schema — intentionally empty.
//
// Tables land in Phase 4, after the data contract (Phase 2) and the ETL transforms
// (Phase 3) lock the real shape of the data. Defining tables before the transforms
// have run against the spike fixtures would be guessing at column types.
//
// drizzle.config.ts already points here, so `drizzle-kit generate` will work the
// moment the first table is added.

export {};
