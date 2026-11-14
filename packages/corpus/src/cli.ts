// `npm run corpus`: raw vbpl.vn HTML -> packages/corpus/data. Output is generated; never edit it
// by hand (AGENTS.md). C2 extends this to also write textHash, the Merkle tree and the root.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLaw, serializeKhoans } from './parse.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const rawPath = `${packageRoot}raw/blld-2019-goc.vbpl.html`;
const outDir = `${packageRoot}data`;

const khoans = parseLaw(readFileSync(rawPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/blld-2019.khoan.json`, serializeKhoans(khoans));

const dieuCount = new Set(khoans.map((k) => k.dieu)).size;
console.log(`corpus: ${dieuCount} Điều, ${khoans.length} Khoản -> data/blld-2019.khoan.json`);
