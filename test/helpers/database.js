import { PGlite } from '@electric-sql/pglite';
import { animeTableStatements } from '../../src/services/anime/schema.js';
import { AnimeStore } from '../../src/services/anime/store.js';

export async function testStore(t) {
  const db = new PGlite();
  t.after(() => db.close());
  for (const sql of animeTableStatements) await db.query(sql);
  let tail = Promise.resolve();
  const pool = {
    query: (sql, args) => db.query(sql, args),
    connect: async () => {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      return { query: (sql, args) => db.query(sql, args), release };
    },
  };
  return new AnimeStore(pool);
}
