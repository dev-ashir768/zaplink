// Generates the committed OpenAPI snapshot by bootstrapping the Nest app WITHOUT listening,
// then calling SwaggerModule.createDocument(). It connects to the PostgreSQL database the DATABASE_*
// settings name (the boot migrations run against it), and pins queue, Redis and session autostart off,
// so no Redis connection is opened, no engines start and no sessions run. The version is sourced from package.json via swagger.config.ts, so the
// snapshot tracks releases automatically.
//
// Usage: npx ts-node scripts/export-openapi.ts <output-path>
import '../src/config/load-env';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import {
  createSwaggerConfig,
  documentErrorResponses,
  dropUnexpressibleOperations,
  exemptPublicOperations,
} from '../src/config/swagger.config';

// Pin the env BEFORE AppModule is imported. AppModule reads QUEUE_ENABLED at
// module top-level (its conditional module mounts) and TypeORM reads the DB settings during
// NestFactory.create() below — so these pins must win over whatever the loader applied above. That
// is why AppModule is imported dynamically inside main(), after these assignments. (NestFactory.create
// never calls init(), so onModuleInit / onApplicationBootstrap hooks — session autostart, the
// PROCESSING-batch and message-type backfills — do not fire regardless; the pins are belt-and-braces.)
process.env.QUEUE_ENABLED = 'false';
process.env.AUTO_START_SESSIONS = 'false';
// Keep the throttler storage in-memory: with REDIS_ENABLED=true in the caller's env the export
// would open a Redis connection for no benefit (the document doesn't change either way).
process.env.REDIS_ENABLED = 'false';
// The search module mounts conditionally on SEARCH_ENABLED (app.module.ts top-level), so an
// export run with SEARCH_ENABLED=false in the caller's env would silently drop /api/search from
// the snapshot. Pin it on — the committed snapshot documents the full default surface.
process.env.SEARCH_ENABLED = 'true';

async function main() {
  // Operator-supplied CLI path — this is a local dev/CI tool, not a network service, so there is
  // no trust boundary to enforce (the caller already has full filesystem access). No path
  // validation is applied by design; restricting writes to cwd would break legitimate out-of-tree
  // snapshot writes, which the documented usage explicitly allows.
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: npx ts-node scripts/export-openapi.ts <output-path>');
    process.exit(1);
  }
  let app: INestApplication | undefined;
  try {
    // Imported after the env pins above so AppModule's top-level reads the hermetic values. Uses
    // require() (not a dynamic import()) so ts-node's CommonJS hook resolves the .ts directly — a
    // native import() would fail with ERR_MODULE_NOT_FOUND under ts-node CJS. Inside the try: its
    // top-level validation throws on a bad environment.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../src/app.module');
    // Bootstrap the full DI graph so every controller/DTO is discovered, but never listen.
    // Errors/warns only — bootstrap is chatty and we only need the document. abortOnError: false
    // makes a failed bootstrap throw; the default aborts the process and skips the cleanup below.
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], abortOnError: false });
    // Mirror main.ts: the global /api prefix is part of the real route paths the docs publish.
    app.setGlobalPrefix('api');
    const doc = SwaggerModule.createDocument(app, createSwaggerConfig());
    // Before the exemption pass, so it never spends work on an operation about to be removed.
    dropUnexpressibleOperations(doc);
    exemptPublicOperations(doc);
    documentErrorResponses(doc);
    writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
    console.log(
      `✓ OpenAPI snapshot written to ${out} (version ${doc.info.version}, ${Object.keys(doc.paths).length} paths)`,
    );
  } finally {
    await app?.close();
  }
}

void main().catch(e => {
  console.error(e);
  process.exit(1);
});
