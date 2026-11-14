// Runs the Foundry half of `npm run verify`. Until the contracts slice (K1) lands there is no
// contracts/ directory, so this skips loudly instead of passing silently.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('contracts/foundry.toml')) {
  console.log('verify:contracts SKIPPED: contracts/foundry.toml not found (slice K1 not merged).');
  process.exit(0);
}

for (const args of [['fmt', '--check'], ['test']]) {
  const result = spawnSync('forge', args, { cwd: 'contracts', stdio: 'inherit' });
  if (result.error) {
    console.error('forge not found. Install Foundry (foundryup).');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
