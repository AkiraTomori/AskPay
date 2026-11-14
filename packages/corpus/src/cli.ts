// `npm run corpus`: raw vbpl.vn HTML -> packages/corpus/data. Output is generated; never edit it
// by hand (AGENTS.md).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCorpus,
  buildFoundryVectors,
  serializeCorpusKhoans,
  serializeRoot,
  serializeTree,
  serializeVectors,
} from './build-tree.js';
import { parseLaw } from './parse.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const rawPath = `${packageRoot}raw/blld-2019-goc.vbpl.html`;
const outDir = `${packageRoot}data`;

const build = buildCorpus(parseLaw(readFileSync(rawPath, 'utf8')));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/blld-2019.khoan.json`, serializeCorpusKhoans(build.khoans));
writeFileSync(`${outDir}/blld-2019.tree.json`, serializeTree(build.tree));
writeFileSync(`${outDir}/blld-2019.root.txt`, serializeRoot(build.root));
writeFileSync(
  `${outDir}/blld-2019.foundry-vectors.json`,
  serializeVectors(buildFoundryVectors(build)),
);

const dieuCount = new Set(build.khoans.map((k) => k.dieu)).size;
console.log(`corpus: ${dieuCount} Điều, ${build.khoans.length} Khoản`);
console.log(`root: ${build.root}`);
