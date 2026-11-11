/**
 * Jest setup file: makes `synchronize` in tests build the id columns the migrations build in production.
 *
 * The entities declare `@PrimaryGeneratedColumn('uuid')`, which TypeORM synchronizes as a native `uuid`
 * column. The migration chain creates every one of them as `varchar DEFAULT gen_random_uuid()::varchar`
 * (see migration 1770200000000-NormalizeSynchronizeUuidColumns), so production stores any string id an
 * import carries. Tests synchronize instead of migrating, so without this they would run against a
 * stricter schema than production and reject ids such as "s1" that production accepts.
 *
 * A uuid generation is therefore not registered; its column becomes `varchar` with that same database
 * default, which TypeORM reads back on insert like any defaulted column. Foreign keys take their type
 * from the column they reference, so they follow.
 */
import { getMetadataArgsStorage } from 'typeorm';

const storage = getMetadataArgsStorage();
const asVarcharDefault = (target: unknown, propertyName: string): void => {
  for (const column of storage.columns) {
    if (column.target === target && column.propertyName === propertyName) {
      column.options.type = 'varchar';
      column.options.default = () => 'gen_random_uuid()::varchar';
    }
  }
};

for (let i = storage.generations.length - 1; i >= 0; i--) {
  const generation = storage.generations[i];
  if (generation.strategy === 'uuid') {
    asVarcharDefault(generation.target, generation.propertyName);
    storage.generations.splice(i, 1);
  }
}
const pushGeneration = storage.generations.push.bind(storage.generations);
storage.generations.push = (...generations) => {
  const kept = generations.filter(generation => {
    if (generation.strategy !== 'uuid') return true;
    asVarcharDefault(generation.target, generation.propertyName);
    return false;
  });
  return kept.length ? pushGeneration(...kept) : storage.generations.length;
};
