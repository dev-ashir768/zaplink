import {
  Injectable,
  NotImplementedException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { createLogger } from '../../../common/services/logger.service';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import type { MessageType } from '../../../engine/interfaces/whatsapp-engine.interface';
import { MessageDirection } from '../../message/entities/message.entity';
import type { SearchProvider, SearchQuery, SearchResults, SearchHit } from '../search.types';
import {
  SEARCH_CONTAINS_MIN_TERM_LENGTH,
  SEARCH_CONTAINS_TERMS_MAX_LENGTH,
  SEARCH_CONTAINS_WINDOW,
  SEARCH_LIMIT_MAX,
} from '../search.constants';
import { ContainsTermsRefusedError, containsTerms, foldSearchText } from '../search-terms';
import { containsSnippet } from '../search-snippet';
import { containsScore } from '../search-score';

const MAX_SNIPPET_WORDS = 24;

/**
 * The session-level advisory lock one replica holds while it builds the Postgres trigram index, in the
 * two-int4 form: 0x7472676d ("trgm") first, a first key no other ZapLink lock uses (the boot migration
 * lock's is 0x4f5741, "OWA"), then the oid of the `messages` table the index is built on, so deployments
 * that share a database in different schemas (POSTGRES_SCHEMA) each build their own.
 */
export const TRIGRAM_BUILD_LOCK_KEY = 0x7472676d;
export const TRIGRAM_BUILD_LOCK = `$1, to_regclass('messages')::oid::int`;

/** How long a build kept from running (see retryContainsBuild) waits before trying again. */
const TRIGRAM_BUILD_RETRY_MS = 30_000;

/** Why match=contains answers 501, one message per cause, each naming what to change. */
const CONTAINS_UNAVAILABLE = {
  disabled: 'Contains search is disabled: set SEARCH_CONTAINS_ENABLED=true and restart to build its index.',
  building:
    'Contains search is not ready: its index is still being built (SEARCH_CONTAINS_ENABLED=true). Retry shortly.',
  failed:
    'Contains search is unavailable: building its index failed (SEARCH_CONTAINS_ENABLED=true); see the server log.',
  postgresExtensions:
    'Contains search is unavailable: install the pg_trgm and unaccent extensions (CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;) and restart.',
} as const;

/**
 * Three letters or digits in a row, the only characters pg_trgm takes trigrams from: letters of every
 * kind, decimal digits and letter numbers (`Ⅻ`), never other numbers (`²`, `①`). The nine modifier
 * letters left out are the ones zaplink_unaccent turns into punctuation before pg_trgm reads them (`ʼ`
 * into an apostrophe, `ˆ` into `^`).
 */
const POSTGRES_TRIGRAM_SOURCE = new RegExp(
  `(?:(?![\\u02b9-\\u02bd\\u02c6\\u02c8\\u02cb\\u02d0])[\\p{L}\\p{Nl}\\p{Nd}]){${SEARCH_CONTAINS_MIN_TERM_LENGTH}}`,
  'u',
);

/**
 * POSTGRES_TRIGRAM_SOURCE on a database whose ctype is C or POSIX: pg_trgm classifies characters with the
 * C library there, which knows no letter or digit outside ASCII, so it takes no trigram from any other.
 */
const POSTGRES_ASCII_TRIGRAM_SOURCE = new RegExp(`[A-Za-z0-9]{${SEARCH_CONTAINS_MIN_TERM_LENGTH}}`);

/**
 * The contains candidate SELECT list. It carries no snippet or score column: searchContains computes
 * both in the application (see containsSnippet and containsScore).
 */
const CONTAINS_COLUMNS = `m."id", m."waMessageId" AS wa_message_id, m."sessionId" AS session_id, m."chatId" AS chat_id, m."from" AS "from", m."body", m."timestamp", m."type", m."direction"`;

/**
 * What the Postgres catalog holds for contains search: the schema of each extension it needs (null when
 * not installed), whether the `zaplink_unaccent` wrapper exists, and the trigram index: null when absent,
 * false while a CONCURRENTLY build runs or after one died, true once usable.
 */
interface TrigramStateRow {
  trgm: string | null;
  unaccent: string | null;
  fn: boolean;
  idx: boolean | null;
}

/** Descending string order for the `id` tiebreak, as `ORDER BY "id" DESC` sorts a UUID column. */
function compareDescending(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * `unaccent()` is STABLE (its result depends on a dictionary that could change), and Postgres only
 * indexes IMMUTABLE expressions, so the trigram index is built on this wrapper. Naming the dictionary
 * explicitly and schema-qualifying both references pins what the wrapper calls regardless of the
 * caller's search_path, which is what makes declaring it IMMUTABLE safe. The schema is whatever the
 * unaccent extension was installed into, read from the catalog.
 */
export function postgresUnaccentFunctionDdl(unaccentSchema: string): string {
  const schema = quoteIdent(unaccentSchema);
  return `CREATE OR REPLACE FUNCTION zaplink_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT ${schema}.unaccent('${schema.replace(/'/g, "''")}.unaccent'::regdictionary, $1) $$`;
}

/**
 * likePattern in Postgres SQL, around the folded term: unaccent maps fullwidth `％` and `＿` to `%` and
 * `_`, so escaping before it would let them through as wildcards. The backslashes are written as E''
 * literals, which read them the same whatever standard_conforming_strings says; with it off, a plain
 * `'\'` escapes its closing quote.
 */
function postgresLikePattern(placeholder: string): string {
  return String.raw`'%' || replace(replace(replace(zaplink_unaccent(${placeholder}), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'`;
}

/**
 * Whether pg_trgm can look `term` up. It takes trigrams from runs of letters and digits only, so `:-)` or
 * `😂😂😂` give it nothing and the search would scan the table.
 * `asciiOnly` is a database with a C or POSIX ctype (POSTGRES_ASCII_TRIGRAM_SOURCE).
 */
function postgresCanIndex(term: string, asciiOnly: boolean): boolean {
  return (asciiOnly ? POSTGRES_ASCII_TRIGRAM_SOURCE : POSTGRES_TRIGRAM_SOURCE).test(foldSearchText(term));
}

/** Shape returned by the SELECT in buildPostgres. */
interface FtsResultRow {
  id: string;
  wa_message_id: string | null;
  session_id: string;
  chat_id: string;
  from: string;
  body: string | null;
  timestamp: string | number | null;
  type: string;
  direction: string;
  snippet: string | null;
  score: number | string | null;
}

interface CountRow {
  n: number | string;
}

/** Returns the next `$n` placeholder token. */
type PlaceholderFn = () => string;

/**
 * Built-in, DB-native full-text provider. The database keeps each index in step with every write (generated
 * tsvector, see migration 1782400000000-AddMessagesFts). This class queries them, and at boot it
 * repairs the ones it queries (ensureFtsSchema) and builds the opt-in trigram index (buildContainsIndex).
 *
 * Two match modes, each on its own index: `word` (the default) matches whole words through the word
 * index above and ranks them in SQL; `contains` matches any substring of three or more characters,
 * case- and accent-insensitively, through a pg_trgm GIN index that only SEARCH_CONTAINS_ENABLED=true builds (see buildContainsIndex), and
 * ranks a bounded window of candidates in the application (see searchContains).
 */
@Injectable()
export class BuiltInFtsProvider implements SearchProvider, OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  readonly id = 'builtin-fts';
  readonly label = 'Built-in database full-text search';
  private readonly logger = createLogger('BuiltInFtsProvider');

  /** SEARCH_CONTAINS_ENABLED: the trigram index is opt-in, since it costs about three times the message text. */
  private readonly containsEnabled: boolean;

  /** Why match=contains answers 501 right now (a CONTAINS_UNAVAILABLE message), or null once its index is ready. */
  private containsUnavailable: string | null;

  /** The next attempt at a build another replica held the lock for (see retryContainsBuild). */
  private containsBuildRetry?: NodeJS.Timeout;
  private readonly containsBuildRetryMs = TRIGRAM_BUILD_RETRY_MS;
  private destroyed = false;

  /** Whether the Postgres database has a C or POSIX ctype, read by each build (see postgresCanIndex). */
  private postgresAsciiTrigrams = false;

  // ZapLink has two TypeORM connections (main: auth/audit, data: messages). Bind explicitly to
  // 'data' so the provider queries the connection that owns the `messages` table + the FTS migration,
  // never the default/`main` one. The bare `DataSource` type alone is ambiguous with two connections.
  constructor(
    @InjectDataSource('data') private readonly dataSource: DataSource,
    // Optional so the provider still builds in a unit test without them; contains search is then off.
    @Optional() config?: ConfigService,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {
    this.containsEnabled = config?.get<boolean>('search.containsEnabled') === true;
    this.containsUnavailable = this.containsEnabled ? CONTAINS_UNAVAILABLE.building : CONTAINS_UNAVAILABLE.disabled;
  }

  /**
   * Self-heals the FTS schema at bootstrap so search works under an opted-in DATABASE_SYNCHRONIZE=true
   * (the default is migrations), where TypeORM creates the `messages` table from the entity but NEVER
   * runs migrations — so the migration that establishes `body_ts` is skipped and search would 501. This
   * re-applies the same idempotent DDL as the migration (1782400000000-AddMessagesFts); no DDL is issued
   * at all when the catalog already holds the column and index, so migrations-based deployments take no table lock. Probes the
   * result into `ftsAvailable` so the first search() / health() call doesn't re-probe.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.ftsAvailable = await this.ensureFtsSchema();
      if (this.ftsAvailable) {
        this.logger.log('FTS index ready');
      } else {
        this.logger.warn('FTS index unavailable; /api/search will return 501');
      }
    } catch (e) {
      // Never fail boot over index creation: the route 501s cleanly via probeFts()/ensureFts() instead.
      this.logger.error(`Failed to ensure FTS schema: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Starts the contains index build once the HTTP listener is up, and does not wait for it: on a large
   * table it runs long enough that a boot held for it would miss its health probe, and the Helm startup
   * probe would restart the pod in a loop (docs/14).
   */
  onApplicationBootstrap(): void {
    if (!this.containsEnabled || !this.adapterHost) return;
    if (this.adapterHost.listening) void this.buildContainsIndex();
    else this.adapterHost.listen$.subscribe(() => void this.buildContainsIndex());
  }

  /**
   * Whether the DB-native FTS schema this provider queries is present. Cached per instance after the
   * first probe. The migration (1782400000000-AddMessagesFts) is what creates it; while the
   * schema is absent the provider must 501 cleanly (see ensureFts) instead of crashing on a missing table / column.
   */
  private ftsAvailable: boolean | null = null;

  /**
   * Probes the FTS schema once per instance and caches the result: looks for the generated `body_ts` column on the SAME
   * `messages` table the search queries resolve — see the to_regclass note below. Safe to call
   * repeatedly; only the first successful probe hits the DB and caches.
   */
  private async probeFts(): Promise<boolean> {
    if (this.ftsAvailable !== null) return this.ftsAvailable;
    // to_regclass('messages') resolves the name through the session search_path — the identical
    // resolution the runtime queries (`FROM messages m`) use, and the data connection pins
    // search_path to `<schema>,public` when POSTGRES_SCHEMA is non-public (app.module.ts). So the
    // probe inspects the table search will actually hit, in the active schema. An unqualified
    // information_schema scan would instead peek across EVERY visible schema and can lie both ways
    // on a custom-schema deployment: a namesake public.messages.body_ts reports FTS present when
    // the active schema lacks it, and a >1-row match (both schemas carry the column) reports it
    // absent. to_regclass returns NULL when `messages` is unresolvable on the path → zero rows →
    // unavailable, so an undeterminable schema fails closed by construction.
    // Fail-closed on probe error (degraded state, e.g. boot ensure left the pool mid-recovery):
    // report unavailable WITHOUT caching, so search() 501s via ensureFts — the same clean posture
    // as a genuinely absent index, never a raw 500 — and a later call re-probes after recovery.
    let rows: unknown[];
    try {
      rows = await this.dataSource.query(
        `SELECT a.attname FROM pg_attribute a WHERE a.attrelid = to_regclass('messages') AND a.attname = 'body_ts' AND NOT a.attisdropped`,
      );
    } catch (e) {
      this.logger.warn(
        `FTS probe failed; treating the index as unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
    this.ftsAvailable = Array.isArray(rows) && rows.length >= 1;
    return this.ftsAvailable;
  }

  /**
   * Guards search(): if the FTS schema is absent (or the probe failed), throw
   * NotImplementedException so the route surfaces 501 — never let a raw missing-table error escape.
   */
  private async ensureFts(): Promise<void> {
    const ok = await this.probeFts();
    if (!ok) {
      throw new NotImplementedException('Search is unavailable: the database has no full-text index.');
    }
  }

  /**
   * Creates the FTS schema if missing. Mirrors migration 1782400000000-AddMessagesFts verbatim and is
   * idempotent (every statement is `IF NOT EXISTS` / `IF NOT`), so:
   *   - migrations-based deployments: the migration has already run; this reads the catalog and
   *     issues no DDL, because `ALTER TABLE ... IF NOT EXISTS`
   *     still queues for ACCESS EXCLUSIVE on `messages` before it finds the column, stalling every
   *     message read and write behind any open transaction.
   *   - otherwise (e.g. DATABASE_SYNCHRONIZE=true, or FTS migration objects gone missing) it creates
   *     whichever of the column and index is absent.
   * Returns true once the index is in place.
   */
  private async ensureFtsSchema(): Promise<boolean> {
    // Uncached on purpose (probeFts caches and swallows errors). Both objects are looked up on the
    // table to_regclass resolves, the same one the runtime queries hit; only a missing one is created.
    const rows: Array<{ col: boolean; idx: boolean }> = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('messages') AND a.attname = 'body_ts' AND NOT a.attisdropped) AS col,
              EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = to_regclass('messages') AND c.relname = 'idx_messages_body_ts') AS idx`,
    );
    if (!rows[0]?.col) {
      await this.dataSource.query(
        `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "body_ts" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED`,
      );
    }
    if (!rows[0]?.idx) {
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS "idx_messages_body_ts" ON "messages" USING GIN ("body_ts")`,
      );
    }
    return true;
  }

  /**
   * Builds the match=contains index when SEARCH_CONTAINS_ENABLED is on, and is a no-op otherwise. Never
   * throws: a failure leaves contains search answering 501 with the reason, and match=word untouched.
   * Public so a spec can await the build onApplicationBootstrap leaves running.
   */
  async buildContainsIndex(): Promise<void> {
    if (!this.containsEnabled) return;
    const start = Date.now();
    try {
      this.containsUnavailable = await this.buildPostgresTrigramIndex();
    } catch (e) {
      this.containsUnavailable = CONTAINS_UNAVAILABLE.failed;
      this.logger.error(`Failed to build the trigram index: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (this.containsUnavailable === CONTAINS_UNAVAILABLE.building) this.retryContainsBuild();
    else if (this.containsUnavailable) this.logger.warn(this.containsUnavailable);
    else this.logger.log(`Trigram index ready in ${Date.now() - start} ms`);
  }

  /**
   * Another replica holds the Postgres build lock. If it dies or its build fails, the lock is released
   * with no valid index, and only a build attempt of this replica's own finds that, so it tries the lock
   * again until the index is ready or the attempt fails for a cause of its own. A search in the meantime
   * still finds an index the other replica finished (probePostgresTrigram).
   */
  private retryContainsBuild(): void {
    if (this.destroyed) return;
    this.containsBuildRetry = setTimeout(() => {
      if (this.containsUnavailable === CONTAINS_UNAVAILABLE.building) void this.buildContainsIndex();
    }, this.containsBuildRetryMs);
    this.containsBuildRetry.unref();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.containsBuildRetry);
  }

  /**
   * Runs createPostgresTrigramSchema on a connection of its own: CREATE INDEX CONCURRENTLY cannot run
   * inside a transaction, which rules out a migration, and outlasts the runtime pool's statement_timeout,
   * which is lifted here. The advisory lock lets one replica build while the others answer 501 until the
   * index is valid (see retryContainsBuild). Returns why the index cannot be used yet, or null once it is
   * valid.
   */
  private async buildPostgresTrigramIndex(): Promise<string | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ ctype }] = await runner.manager.query<Array<{ ctype: string }>>(
        `SELECT datctype AS ctype FROM pg_database WHERE datname = current_database()`,
      );
      this.postgresAsciiTrigrams = ctype === 'C' || ctype === 'POSIX';
      const [{ locked }] = await runner.manager.query<Array<{ locked: boolean }>>(
        `SELECT pg_try_advisory_lock(${TRIGRAM_BUILD_LOCK}) AS locked`,
        [TRIGRAM_BUILD_LOCK_KEY],
      );
      if (!locked) return CONTAINS_UNAVAILABLE.building;
      let bound: string | undefined;
      try {
        const [shown] = await runner.manager.query<Array<{ statement_timeout?: string }>>('SHOW statement_timeout');
        bound = shown?.statement_timeout;
        await runner.query('SET statement_timeout = 0');
        return await this.createPostgresTrigramSchema(runner);
      } finally {
        // The connection returns to the pool: the next borrower must find its timeout and no lock. Put back
        // by value: the pool sets the timeout on connect, and RESET would drop it to the server default.
        if (bound !== undefined) await runner.query(`SELECT set_config('statement_timeout', $1, false)`, [bound]);
        await runner.query(`SELECT pg_advisory_unlock(${TRIGRAM_BUILD_LOCK})`, [TRIGRAM_BUILD_LOCK_KEY]);
      }
    } finally {
      await runner.release();
    }
  }

  /**
   * Creates what is missing of the extensions, the wrapper function and the GIN trigram index, the index
   * with CREATE INDEX CONCURRENTLY so writes go on during the build. Holding the build lock proves an
   * INVALID index is what a killed build left behind rather than one in progress, so it is rebuilt.
   */
  private async createPostgresTrigramSchema(runner: QueryRunner): Promise<string | null> {
    try {
      // IF NOT EXISTS returns before any privilege check, so a role that may not create the extensions
      // still gets past once an operator has.
      await runner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await runner.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    } catch (e) {
      this.logger.warn(
        `Cannot create the pg_trgm and unaccent extensions: ${e instanceof Error ? e.message : String(e)}`,
      );
      return CONTAINS_UNAVAILABLE.postgresExtensions;
    }
    const [{ trgm, unaccent, fn, idx }] = await this.postgresTrigramState(runner);
    if (!trgm || !unaccent) return CONTAINS_UNAVAILABLE.postgresExtensions;
    if (!fn) await runner.query(postgresUnaccentFunctionDdl(unaccent));
    if (idx === false) await runner.query(`DROP INDEX CONCURRENTLY IF EXISTS "idx_messages_body_trgm"`);
    if (idx !== true) {
      await runner.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_messages_body_trgm" ON "messages" USING GIN (zaplink_unaccent("body") ${quoteIdent(trgm)}.gin_trgm_ops)`,
      );
    }
    return null;
  }

  /**
   * One catalog read of everything contains search needs on Postgres. The function and the index are
   * looked up through the session search_path, the same resolution the runtime queries use (see the
   * to_regclass note in probeFts).
   */
  private postgresTrigramState(runner?: QueryRunner): Promise<TrigramStateRow[]> {
    return (runner ?? this.dataSource).manager.query<TrigramStateRow[]>(
      `SELECT (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm') AS trgm,
              (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent') AS unaccent,
              to_regprocedure('zaplink_unaccent(text)') IS NOT NULL AS fn,
              (SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = to_regclass('messages') AND c.relname = 'idx_messages_body_trgm') AS idx`,
    );
  }

  /**
   * Marks contains search ready once the catalog holds a valid index, which another replica may have
   * built while this one waited on the lock. Fails closed like probeFts: an error leaves it unavailable.
   */
  private async probePostgresTrigram(): Promise<void> {
    try {
      const [{ trgm, unaccent, fn, idx }] = await this.postgresTrigramState();
      if (trgm && unaccent && fn && idx) this.containsUnavailable = null;
    } catch (e) {
      this.logger.warn(
        `Trigram probe failed; treating contains search as unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Guards a match=contains search: disabled, still building or unbuildable is a 501 that says which. */
  private async ensureContains(): Promise<void> {
    if (this.containsUnavailable && this.containsEnabled) {
      await this.probePostgresTrigram();
    }
    if (this.containsUnavailable) throw new NotImplementedException(this.containsUnavailable);
  }

  async search(query: SearchQuery): Promise<SearchResults> {
    if (query.match === 'contains') return this.searchContains(query);
    await this.ensureFts();
    const start = Date.now();
    const limit = Math.max(1, Math.min(query.limit ?? 50, SEARCH_LIMIT_MAX));
    const offset = Math.max(0, query.offset ?? 0);

    const { sql, params } = this.buildPostgres(query, limit, offset);

    const rows = await this.dataSource.query<FtsResultRow[]>(sql, params);
    const hits: SearchHit[] = rows.map(r => this.mapRow(r));
    const total = rows.length < limit && offset === 0 ? rows.length : await this.count(query);

    return { hits, total, tookMs: Date.now() - start, provider: this.id };
  }

  /**
   * match=contains, in two phases (docs/26, "Match modes"):
   *
   *  1. The database returns at most SEARCH_CONTAINS_WINDOW candidates: the most recently stored
   *     messages that contain every term, found through the trigram index, newest first. The
   *     database answers that order from an index and stop once the window is full, so a common match
   *     costs no more than a rare one (on PostgreSQL 13 or newer, see buildPostgresCandidates). A
   *     message the index yields that a narrowing term then rules out does not fill it, so the messages
   *     holding the looked-up terms bound the work, multiplied by the length of the terms
   *     (SEARCH_CONTAINS_TERMS_MAX_LENGTH).
   *  2. The application ranks the candidates with containsScore (whole word, then word start, then
   *     inside a word), newest first within a score and `id` last for a total order, and pages them in
   *     memory.
   *
   * Ranking every match in SQL instead (bm25 / word_similarity) costs time in proportion to the
   * matches: about 1.6 s on Postgres for a term found in 200k of 1M messages. With the window the same
   * search takes 10 to 20 ms. The price is that relevance only orders
   * the window: `total` is the window's size at most, and older matches are reached by narrowing the
   * query (more terms, chatId, dateTo), since the filters apply before the window. Scoring one row at
   * a time also means a score never reflects messages outside the caller's scope, so unlike bm25 it
   * is never withheld.
   */
  private async searchContains(query: SearchQuery): Promise<SearchResults> {
    await this.ensureContains();
    const terms = BuiltInFtsProvider.containsTermsOf(query.q, this.postgresAsciiTrigrams);
    const start = Date.now();
    const limit = Math.max(1, Math.min(query.limit ?? 50, SEARCH_LIMIT_MAX));
    const offset = Math.max(0, query.offset ?? 0);

    const { sql, params } = this.buildPostgresCandidates(query, terms);
    const rows = await this.dataSource.query<FtsResultRow[]>(sql, params);

    const ranked = rows
      .map(row => ({ row, score: containsScore(row.body ?? '', terms) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.row.timestamp ?? 0) - Number(a.row.timestamp ?? 0) ||
          compareDescending(a.row.id, b.row.id),
      );
    const hits: SearchHit[] = ranked.slice(offset, offset + limit).map(({ row, score }) => ({
      ...this.mapRow(row),
      snippet: containsSnippet(row.body ?? '', terms, MAX_SNIPPET_WORDS),
      score,
    }));

    return { hits, total: ranked.length, tookMs: Date.now() - start, provider: this.id };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    // Reflects FTS availability (not just raw connectivity): an absent index reports unhealthy here
    // for callers of health(). DB errors still map to { ok: false }.
    try {
      const ok = await this.probeFts();
      return { ok, detail: ok ? undefined : 'full-text index absent' };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  private mapRow(r: FtsResultRow): SearchHit {
    return {
      messageId: r.id,
      waMessageId: r.wa_message_id ?? '',
      sessionId: r.session_id,
      chatId: r.chat_id,
      body: r.body ?? '',
      snippet: r.snippet ?? '',
      timestamp: Number(r.timestamp ?? 0),
      type: r.type as MessageType,
      direction: r.direction as MessageDirection,
      from: r.from,
      score: r.score == null ? undefined : Number(r.score),
    };
  }

  private pgPlaceholder(): PlaceholderFn {
    let n = 0;
    return () => `$${++n}`;
  }

  /**
   * The whitespace-separated terms of a contains query, repeats folded away (`Invoice invoice` is one
   * term). Every term must appear in the body, as with match=word. A trigram index cannot answer a term
   * it takes no trigram from (pg_trgm scans every row), so such terms only
   * narrow the rows another term already found, and a query made of them alone is a 400 rather than a
   * full-table scan. pg_trgm takes trigrams only from three letters or
   * digits in a row, ASCII ones on a C or POSIX ctype (see postgresCanIndex). The terms together are bounded
   * by SEARCH_CONTAINS_TERMS_MAX_LENGTH, since each of their characters costs a check on every candidate.
   */
  private static containsTermsOf(q: string, asciiOnly: boolean): string[] {
    const terms = containsTerms(q);
    if (!terms.some(term => postgresCanIndex(term, asciiOnly))) {
      const unit = `${asciiOnly ? 'ASCII ' : ''}letters or digits in a row`;
      throw new ContainsTermsRefusedError(
        `A contains search needs at least one term of ${SEARCH_CONTAINS_MIN_TERM_LENGTH} or more ${unit}.`,
      );
    }
    const length = terms.reduce((sum, term) => sum + [...foldSearchText(term)].length, 0);
    if (length > SEARCH_CONTAINS_TERMS_MAX_LENGTH) {
      throw new ContainsTermsRefusedError(
        `The terms of a contains search may hold at most ${SEARCH_CONTAINS_TERMS_MAX_LENGTH} characters together, spaces not counted.`,
      );
    }
    return terms;
  }

  // --- Postgres tsvector -----------------------------------------------------
  // SQL appearance order: FTS term (in FROM clause) -> filters (in WHERE) -> LIMIT -> OFFSET.
  // The FTS term lives in `FROM messages m, websearch_to_tsquery('simple', $1) AS q(query)`,
  // which renders BEFORE the WHERE filters — so it must be `$1`, filters `$2..`, LIMIT/OFFSET last.
  // Params are pushed in the same order so the Nth param maps to `$N`.
  private buildPostgres(q: SearchQuery, limit: number, offset: number) {
    const ph = this.pgPlaceholder();
    const params: unknown[] = [];
    const ftsTerm = `websearch_to_tsquery('simple', ${ph()}) AS q(query)`;
    params.push(q.q);
    const where: string[] = [`m.body_ts @@ q.query`];
    this.applyFilters(where, params, q, 'm.', ph);
    // StartSel/StopSel are pinned to <mark>/</mark>, the SearchHit.snippet contract (PG's ts_headline
    // defaults to <b>/</b>).
    const cols = `m."id", m."waMessageId" AS wa_message_id, m."sessionId" AS session_id, m."chatId" AS chat_id, m."from", m."body", m."timestamp", m."type", m."direction", ts_headline('simple', m."body", q.query, 'MaxFragments=1, MaxWords=${MAX_SNIPPET_WORDS}, StartSel=<mark>, StopSel=</mark>') AS snippet, ts_rank(m.body_ts, q.query) AS score`;
    const sql = `SELECT ${cols} FROM messages m, ${ftsTerm} WHERE ${where.join(' AND ')} ORDER BY score DESC, m."timestamp" DESC, m."id" DESC LIMIT ${ph()} OFFSET ${ph()}`;
    params.push(limit, offset);
    return { sql, params };
  }

  // --- Postgres pg_trgm candidates (match=contains) --------------------------
  // SQL appearance order: one ILIKE per term -> filters -> LIMIT. Each ILIKE compares
  // zaplink_unaccent(body), the exact expression the GIN trigram index holds; ILIKE folds case and
  // zaplink_unaccent folds accents, and each term has its `%`, `_` and `\` escaped after that fold so it
  // matches literally (postgresLikePattern). unaccent also transliterates letters remove_diacritics
  // leaves alone (Ł, ß, Ø, œ). The most
  // recently stored first: IDX_messages_createdAt lets the planner walk them backward and
  // stop at the window when a term is common, while for a rare one it reads the few matches from the
  // GIN index and sorts them. The early stop needs PostgreSQL 13's incremental sort for the `id` tiebreak;
  // PostgreSQL 12 sorts every match.
  private buildPostgresCandidates(q: SearchQuery, terms: string[]) {
    const ph = this.pgPlaceholder();
    const params: unknown[] = [];
    const where = terms.map(term => {
      const placeholder = ph();
      params.push(term);
      return `zaplink_unaccent(m."body") ILIKE ${postgresLikePattern(placeholder)}`;
    });
    this.applyFilters(where, params, q, 'm.', ph);
    const sql = `SELECT ${CONTAINS_COLUMNS} FROM messages m WHERE ${where.join(' AND ')} ORDER BY m."createdAt" DESC, m."id" DESC LIMIT ${ph()}`;
    params.push(SEARCH_CONTAINS_WINDOW);
    return { sql, params };
  }

  /** Emits `$N` placeholders; MUST be called in SQL-appearance order. */
  private applyFilters(where: string[], params: unknown[], q: SearchQuery, prefix: string, ph: PlaceholderFn): void {
    if (q.sessionIds && q.sessionIds.length) {
      const placeholders = q.sessionIds.map(() => ph()).join(',');
      where.push(`${prefix}"sessionId" IN (${placeholders})`);
      params.push(...q.sessionIds);
    }
    if (q.sessionId) {
      where.push(`${prefix}"sessionId" = ${ph()}`);
      params.push(q.sessionId);
    }
    if (q.chatId) {
      // Every stored form of the chat when the host expanded it (a chat first stored under a lid and later
      // under the phone is one chat, as in the message list), the literal id otherwise.
      if (q.chatIdAliases?.length) {
        const placeholders = q.chatIdAliases.map(() => ph()).join(',');
        where.push(`${prefix}"chatId" IN (${placeholders})`);
        params.push(...q.chatIdAliases);
      } else {
        where.push(`${prefix}"chatId" = ${ph()}`);
        params.push(q.chatId);
      }
    }
    if (q.chatIds?.length === 0) where.push('1 = 0');
    else if (q.chatIds) {
      const placeholders = q.chatIds.map(() => ph()).join(',');
      where.push(`${prefix}"chatId" IN (${placeholders})`);
      params.push(...q.chatIds);
    }
    if (q.from) {
      if (q.fromAliases?.length) {
        // A group message keeps the group id in `from` and the person in `author`, so both are matched.
        const asSender = q.fromAliases.map(() => ph()).join(',');
        const asAuthor = q.fromAliases.map(() => ph()).join(',');
        where.push(`(${prefix}"from" IN (${asSender}) OR ${prefix}"author" IN (${asAuthor}))`);
        params.push(...q.fromAliases, ...q.fromAliases);
      } else {
        where.push(`${prefix}"from" = ${ph()}`);
        params.push(q.from);
      }
    }
    if (q.direction) {
      where.push(`${prefix}"direction" = ${ph()}`);
      params.push(q.direction);
    }
    if (q.type) {
      const types = Array.isArray(q.type) ? q.type : [q.type];
      const placeholders = types.map(() => ph()).join(',');
      where.push(`${prefix}"type" IN (${placeholders})`);
      params.push(...types);
    }
    // The public contract (DTO + docs) is epoch-ms, but messages.timestamp stores epoch-seconds
    // (WhatsApp messageTimestamp — see the inbound mappers in the engine adapters). Bind ms→seconds
    // at the boundary, otherwise `seconds >= ms` is false for every modern row and dateFrom/dateTo
    // silently exclude all results.
    if (q.dateFrom != null) {
      where.push(`${prefix}"timestamp" >= ${ph()}`);
      params.push(Math.ceil(q.dateFrom / 1000));
    }
    if (q.dateTo != null) {
      where.push(`${prefix}"timestamp" <= ${ph()}`);
      params.push(Math.floor(q.dateTo / 1000));
    }
  }

  private async count(q: SearchQuery): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];
    {
      const ph = this.pgPlaceholder();
      const ftsTerm = `websearch_to_tsquery('simple', ${ph()}) AS q(query)`;
      params.push(q.q);
      where.push(`m.body_ts @@ q.query`);
      this.applyFilters(where, params, q, 'm.', ph);
      const sql = `SELECT count(*)::int AS n FROM messages m, ${ftsTerm} WHERE ${where.join(' AND ')}`;
      const rows = await this.dataSource.query<CountRow[]>(sql, params);
      return Number(rows[0]?.n ?? 0);
    }
  }
}
