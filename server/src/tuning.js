// Central tuning — every heuristic/fallback constant lives in server/tuning.json,
// editable without code changes. Individual values can be overridden via env:
// TUNING_<NAME> as JSON (e.g. TUNING_CREATIVEANGLES='["offer"]'), or the whole
// file via TUNING_JSON=<path>.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const file = process.env.TUNING_JSON || path.resolve(SRC, '../tuning.json');

let T = {};
try {
  T = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`[marque] tuning file unreadable (${file}): ${e.message} — running on empty tuning`);
}

// env override: TUNING_<KEY-UPPERCASED> as JSON
for (const key of Object.keys(T)) {
  const envName = `TUNING_${key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`;
  if (process.env[envName]) {
    try { T[key] = JSON.parse(process.env[envName]); } catch { /* keep file value */ }
  }
}

export const tuning = (key, fallback) => (T[key] !== undefined ? T[key] : fallback);
export default T;
