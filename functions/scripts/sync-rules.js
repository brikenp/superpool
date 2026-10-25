// Gjeneron funksionet can_*() në firestore.rules nga ROLE_CAPS (functions/src/shared/roles.js).
// Përdorimi:  npm run sync-rules        (shkruan skedarin)
//             npm run sync-rules -- --check  (vetëm kontrollon, për CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CAPS, ROLE_CAPS } from '../src/shared/roles.js';

const RULES = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

export function capsBlock() {
  const lines = Object.values(CAPS).map((cap) => {
    const roles = Object.keys(ROLE_CAPS).filter((r) => ROLE_CAPS[r].includes(cap));
    return `    function can_${cap}() { return isRole([${roles.map((r) => `'${r}'`).join(', ')}]); }`;
  });
  return `    // BEGIN CAPS\n${lines.join('\n')}\n    // END CAPS`;
}

export function syncedRules(text) {
  return text.replace(/ {4}\/\/ BEGIN CAPS[\s\S]*?\/\/ END CAPS/, capsBlock());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = readFileSync(RULES, 'utf8');
  const next = syncedRules(text);
  if (process.argv.includes('--check')) {
    if (next !== text) { console.error('firestore.rules nuk është në sinkron me roles.js — ekzekutoni npm run sync-rules'); process.exit(1); }
    console.log('firestore.rules është në sinkron.');
  } else {
    writeFileSync(RULES, next);
    console.log('firestore.rules u përditësua.');
  }
}
