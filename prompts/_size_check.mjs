import fs from 'fs';
const j = JSON.parse(fs.readFileSync(new URL('./svinya-dolgovaya-yama.json', import.meta.url), 'utf8'));
const s = JSON.stringify(j);
console.log('total', s.length);
for (const k of Object.keys(j)) {
  console.log(k, JSON.stringify(j[k]).length);
}
console.log('timeline items:');
j.timeline.forEach(t => console.log(t.t, JSON.stringify(t).length));
