import { readFileSync } from 'node:fs';
const p = JSON.parse(readFileSync('prompts/lobster-zarplata.json', 'utf8'));
for (const k of Object.keys(p)) {
  console.log(k, JSON.stringify(p[k]).length);
}
console.log('TOTAL', JSON.stringify(p).length);
