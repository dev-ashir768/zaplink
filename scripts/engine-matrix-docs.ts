/**
 * Rewrites the engine feature table in README.md from the capability matrix.
 * Usage: npm run docs:engine-matrix
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { README_MATRIX_END, README_MATRIX_START, renderEngineMatrixMarkdown } from '../src/engine/engine-capabilities';

const readme = join(__dirname, '..', 'README.md');
const text = readFileSync(readme, 'utf8');
const start = text.indexOf(README_MATRIX_START);
const end = text.indexOf(README_MATRIX_END);
if (start === -1 || end === -1) throw new Error('README.md has no engine-matrix markers');
const next =
  text.slice(0, start + README_MATRIX_START.length) + '\n\n' + renderEngineMatrixMarkdown() + '\n\n' + text.slice(end);
writeFileSync(readme, next);
console.log('README.md engine table updated');
