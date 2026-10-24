// marque server config — env + paths
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));

for (const p of ['.env', '../.env', fileURLToPath(new URL('../../.env', import.meta.url))]) {
  try {
    if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
  } catch { /* next candidate */ }
}
if (!process.env.TENSOR_API_KEY) { try { dotenv.config(); } catch { /* no env file */ } }

export const PORT = Number(process.env.PORT || 8787);
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || './data');
export const ASSETS_DIR = path.join(DATA_DIR, 'assets');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const WEB_DIST = path.resolve(ROOT, 'web/dist');

export const ENV = {
  tensorBase: (process.env.TENSOR_BASE_URL || '').replace(/\/$/, ''),
  tensorKey: process.env.TENSOR_API_KEY || '',
  tensorModel: process.env.TENSOR_MODEL || 'glm-4-7-flash',
  geminiKey: process.env.GEMINI_API_KEY || '',
  // pool of AI Studio keys — rotated on quota errors + spread across requests
  geminiKeys: [
    ...(process.env.GEMINI_API_KEYS || '').split(','),
    process.env.GEMINI_API_KEY || '',
  ].map((k) => k.trim()).filter((k, i, a) => k && a.indexOf(k) === i),
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
  geminiVideoModel: process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-lite-generate-preview',
  qlooKey: process.env.QLOO_API_KEY || '',
  qlooBase: (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, ''),
  // local diffusion service (scripts/localgen.py) — 'off' | 'local-first' | 'local-only' | 'fallback'
  localgenUrl: (process.env.LOCALGEN_URL || '').replace(/\/$/, ''),
  localgenProvider: process.env.LOCALGEN_PROVIDER || 'off',
};
