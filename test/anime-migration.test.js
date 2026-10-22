import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { tableStatements, indexStatements, UPDATE_TIMESTAMP_FUNCTION, triggerDefinitions } from '../src/utils/database/schema.js';

test('shared migrations run twice and preserve existing guild data', async t => {
  const db = new PGlite(); t.after(() => db.close());
  async function migrate() {
    for (const statement of [...tableStatements, ...indexStatements]) await db.query(statement);
    await db.exec(UPDATE_TIMESTAMP_FUNCTION);
    for (const { name, table } of triggerDefinitions) {
      await db.exec(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
      await db.exec(`CREATE TRIGGER ${name} BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`);
    }
  }
  await migrate();
  await db.query('INSERT INTO guilds(id,config) VALUES($1,$2)', ['123', JSON.stringify({ prefix: '?', economy: { enabled: true } })]);
  await migrate();
  assert.equal((await db.query('SELECT config FROM guilds WHERE id=$1', ['123'])).rows[0].config.prefix, '?');
  await db.query("INSERT INTO anime_documents(scope,id,data) VALUES('profile','u',$1)", [JSON.stringify({ notes: ['persisted'] })]);
  assert.deepEqual((await db.query("SELECT data FROM anime_documents WHERE scope='profile'")).rows[0].data.notes, ['persisted']);
});
