/**
 * Column type helpers shared by the entities.
 *
 * JSON stays `simple-json` (JSON.stringify/parse over a `text` column): the baseline migration created
 * these columns as `text`, and the pg driver only auto-parses real json/jsonb columns, so a `jsonb`
 * entity reading the actual `text` column would hand back a raw string. No query filters JSON in SQL.
 */
export const jsonColumnType = (): 'simple-json' => 'simple-json';

/** Timestamps are native Postgres `timestamp` columns. */
export const dateColumnType = (): 'timestamp' => 'timestamp';
