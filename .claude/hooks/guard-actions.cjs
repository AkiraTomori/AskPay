'use strict';

// Best-effort guard for direct shell calls, not a shell parser or security boundary.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.stderr.write('SDLC guard: invalid hook input; blocking call.\n');
    process.exitCode = 2;
    return;
  }
  if (event.tool_name !== 'Bash') return;
  const command = event.tool_input && event.tool_input.command;
  if (typeof command !== 'string') {
    process.stderr.write('SDLC guard: missing Bash command; blocking call.\n');
    process.exitCode = 2;
    return;
  }
  const rules = [
    {pattern: /\bgit(?:\s+-C\s+\S+)?\s+push\b[^;&|\n]*(?:--force(?:-with-lease)?\b|-f\b|\s+\+\S+)/i, decision:'deny', reason:'Force-push is disabled; use a reviewed non-force update.'},
    // A raw key on the command line ends up in shell history and logs.
    {pattern: /--private-key\s+(?:0x)?[0-9a-f]{64}\b/i, decision:'deny', reason:'Never pass a raw private key; use `--account <keystore>` or an env var loaded from .env.'},
    // Avalanche C-Chain mainnet: chain id 43114 or the public mainnet RPC.
    {pattern: /\b43114\b|api\.avax\.network\/ext\/bc\/C\/rpc|--rpc-url\s+(?:\$\{?)?\w*MAINNET/i, decision:'ask', reason:'Mainnet costs real AVAX/USDC; confirm the target with the owner first.'},
    {pattern: /\bforge\s+(?:script\b[^;&|\n]*--broadcast|create\b)|\bcast\s+(?:send|publish)\b/i, decision:'ask', reason:'This broadcasts an on-chain transaction; confirm network, signer and contract first.'},
    {pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:deploy|release)\b/i, decision:'ask', reason:'Deployment needs explicit target-specific approval.'},
    {pattern: /\bgh\s+pr\s+merge\b/i, decision:'ask', reason:'Opening a PR does not authorize merging it.'},
    {pattern: /\b(?:vercel|wrangler|netlify|railway|render)\s+(?:deploy|up|--prod|--production)\b/i, decision:'ask', reason:'Deployment needs explicit target-specific approval.'}
  ];
  for (const rule of rules) {
    if (!rule.pattern.test(command)) continue;
    process.stdout.write(JSON.stringify({hookSpecificOutput:{
      hookEventName:'PreToolUse',
      permissionDecision:rule.decision,
      permissionDecisionReason:rule.reason
    }}) + '\n');
    return;
  }
});
