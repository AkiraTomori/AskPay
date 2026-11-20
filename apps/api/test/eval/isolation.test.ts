// AP-09-AC02: the eval pays nobody and never loads a secret. These read the source, so a later edit
// that imports the chain or the real keys fails here instead of at the next live run.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const evalDir = join(import.meta.dirname, '../../src/eval');
const read = (path: string) => readFileSync(path, 'utf8');
// Comments may name what the code avoids ("never reads CHECKER_PRIVATE_KEY"); only code counts.
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const files = readdirSync(evalDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, code: code(read(join(evalDir, name))) }));

// What the eval can reach at runtime, through every relative import. The compiled output is walked,
// not the source: with verbatimModuleSyntax a type-only import still shows up in the source, and
// only the emitted JS says what is really loaded (`pretest` builds it).
const distDir = resolve(evalDir, '../../dist');
function reachable(entryDir: string): Set<string> {
  if (!existsSync(entryDir)) throw new Error(`${entryDir} is missing: run \`npm run build\` first`);
  const seen = new Set<string>();
  const queue = readdirSync(entryDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(entryDir, name));
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      queue.push(resolve(dirname(file), match[1] ?? ''));
    }
  }
  return seen;
}

describe('AP-09-AC02 the eval touches no money and no real key', () => {
  it('has the files the design lists', () => {
    expect(files.map((f) => f.name).sort()).toEqual([
      'checkpoint.ts',
      'cli.ts',
      'dataset.ts',
      'report.ts',
      'runner.ts',
      'score.ts',
    ]);
  });

  it.each(files)('$name imports no payment, chain, store, pipeline or config module', (file) => {
    const specifiers = [...file.code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
    for (const specifier of specifiers) {
      expect(specifier).not.toMatch(/payment|chain|store|ask\.|indexer|shared\/config|compose/);
    }
  });

  it.each(files)(
    '$name never names the checker key, the full config loader or an env file',
    (file) => {
      expect(file.code).not.toMatch(/CHECKER_PRIVATE_KEY|PROVIDER_PRIVATE_KEY|loadConfig/);
      // String literals only: `process.env` is fine, a path to an env file is not.
      const literals = file.code.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
      expect(literals.filter((literal) => literal.includes('.env'))).toEqual([]);
      expect(file.code).not.toMatch(
        /process\.env\.(?!LLM_|GROQ_API_KEY|OPENROUTER_API_KEY|EVAL_PACE_MS|LOG_LEVEL)/,
      );
    },
  );

  it('reaches no payment, chain, store, indexer, history or server code, even indirectly', () => {
    const modules = [...reachable(join(distDir, 'eval'))].map((file) => relative(distDir, file));
    // The services it is meant to run are there; the money path is not.
    expect(modules).toContain(join('modules', 'answer', 'answer.service.js'));
    expect(modules).toContain(join('modules', 'checker', 'checker.service.js'));
    expect(
      modules.filter((module) =>
        /modules\/(payment|ask|indexer|history)\/|shared\/(store|tx-queue)|^(compose|app|server)\.js$/.test(
          module,
        ),
      ),
    ).toEqual([]);
  });

  it('runs the real answer and checker services, and never the demo path', () => {
    const runner = files.find((f) => f.name === 'runner.ts')?.code ?? '';
    expect(runner).toContain('createAnswerService');
    expect(runner).toContain('createCheckerService');
    expect(runner).not.toMatch(/demoFakeCitation|demoStall|DEMO_/);
  });

  it('is not part of the server: app.ts and compose.ts do not import it', () => {
    for (const name of ['app.ts', 'compose.ts', 'server.ts']) {
      expect(read(join(evalDir, '..', name))).not.toMatch(/['"]\.\/eval\//);
    }
  });
});
