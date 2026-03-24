import { defineConfig } from 'drizzle-kit';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Match the DB path used by the API at runtime (dashboard/data/the-forge.db)
const DB_PATH = process.env.VLDR_DB_PATH || resolve(__dirname, '..', '..', 'data', 'the-forge.db');

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: DB_PATH,
  },
});
