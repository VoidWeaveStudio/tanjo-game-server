// game-server/scripts/check-boosts.js
const fs = require('fs');
const path = require('path');
const { FACTION_BOOST_EFFECTS } = require('../factionBoosts');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'advenjohub5.5', 'src', 'core', 'lib', 'factionBoosts.ts'),
  'utf8'
);

const pattern = /\{\s*id:\s*"([a-z]+)",\s*effect:\s*"([a-zA-Z]+)",\s*magnitude:\s*([0-9.]+)/g;
const catalog = new Map();
let match;
while ((match = pattern.exec(source)) !== null) {
  catalog.set(match[1], { effect: match[2], magnitude: Number(match[3]) });
}

if (catalog.size === 0) {
  console.error('boost catalog: parsed nothing from factionBoosts.ts');
  process.exit(1);
}

let failed = 0;
for (const [id, want] of catalog) {
  const got = FACTION_BOOST_EFFECTS[id];
  if (!got) {
    console.error(`boost ${id}: missing from factionBoosts.js`);
    failed++;
    continue;
  }
  if (got.effect !== want.effect || Math.abs(got.magnitude - want.magnitude) > 1e-9) {
    console.error(`boost ${id}: ${got.effect}/${got.magnitude} != ${want.effect}/${want.magnitude}`);
    failed++;
  }
}

for (const id of Object.keys(FACTION_BOOST_EFFECTS)) {
  if (!catalog.has(id)) {
    console.error(`boost ${id}: present on server but not in the catalog`);
    failed++;
  }
}

if (failed) process.exit(1);
console.log(`boost mirror matches (${catalog.size} boosts)`);
