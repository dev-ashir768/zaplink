import mainDataSource from './data-source-main';

// Keep the checkout's own .env and data/.env.generated out: the CLI data sources load them on import.
jest.mock('./load-cli-env', () => ({ loadCliEnv: jest.fn() }));

// The main (auth/audit) connection has its own migration chain and ledger in the same Postgres database;
// this standalone DataSource lets the CLI run them.
describe('main CLI DataSource', () => {
  it('targets Postgres with its own ledger', () => {
    expect(mainDataSource.options.type).toBe('postgres');
    expect(mainDataSource.options.migrationsTableName).toBe('main_migrations');
  });

  it('uses the main-owned migrations dir, not the data migrations dir', () => {
    const migrations = (mainDataSource.options.migrations as string[]).join(' ');
    expect(migrations).toContain('migrations-main');
  });

  it('covers the auth and audit entities (the main connection owns them)', () => {
    const entities = (mainDataSource.options.entities as string[]).join(' ');
    expect(entities).toContain('auth');
    expect(entities).toContain('audit');
  });
});
