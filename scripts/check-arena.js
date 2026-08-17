// game-server/scripts/check-arena.js
const arena = require('../arena');

const CFG = arena.ARENA_CONFIG;
let failures = 0;

function section(name) {
  console.log(`\n${name}`);
}

function check(name, condition) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  console.log(`  FAIL ${name}`);
  failures += 1;
}

section('wave composition');
check('wave 1 is not a boss wave', arena.isBossWave(1) === false);
check(`every ${CFG.bossEveryWaves}th wave is a boss wave`, arena.isBossWave(5) && arena.isBossWave(10) && arena.isBossWave(15));
check('boss waves carry exactly one boss', arena.waveComposition(5).bosses === 1);
check('normal waves carry none', arena.waveComposition(4).bosses === 0);

let ceilingHeld = true;
let growsWithWave = true;
let previous = 0;
for (let wave = 1; wave <= 200; wave++) {
  const plan = arena.waveComposition(wave);
  const live = plan.mobs + plan.bosses;
  if (live > CFG.maxLiveEnemies) ceilingHeld = false;
  if (wave <= 15 && !arena.isBossWave(wave) && plan.mobs < previous) growsWithWave = false;
  if (!arena.isBossWave(wave)) previous = plan.mobs;
}
check(`live enemies never exceed ${CFG.maxLiveEnemies}`, ceilingHeld);
check('mob count does not shrink as waves climb', growsWithWave);

check('biome starts at the first one', arena.biomeIndexForWave(1) === 0);
check('biome advances every five waves', arena.biomeIndexForWave(6) === 1 && arena.biomeIndexForWave(11) === 2);
check('biome index stays inside the table', arena.biomeIndexForWave(999) === CFG.biomeCount - 1);

let difficultyClimbs = true;
for (let wave = 2; wave <= 100; wave++) {
  const before = arena.waveComposition(wave - 1);
  const now = arena.waveComposition(wave);
  if (now.healthMult <= before.healthMult || now.damageMult <= before.damageMult) difficultyClimbs = false;
}
check('health and damage multipliers climb every wave', difficultyClimbs);

section('rewards');
check('a run cleared at zero waves pays nothing', arena.rewardsFor(0).ash === 0 && arena.rewardsFor(0).xp === 0);
check('ash is linear in waves', arena.rewardsFor(4).ash === CFG.ashPerWave * 4);
check('xp is linear in waves', arena.rewardsFor(4).xp === CFG.xpPerWave * 4);
check(`ash caps at ${CFG.ashCap}`, arena.rewardsFor(10000).ash === CFG.ashCap);
check(`xp caps at ${CFG.xpCap}`, arena.rewardsFor(10000).xp === CFG.xpCap);
check('both caps land on the same wave', CFG.ashCap / CFG.ashPerWave === CFG.xpCap / CFG.xpPerWave);

const dailyCeiling = (CFG.xpCap * 24 * 60 * 60 * 1000) / CFG.cooldownMs;
check('a perfect day of arena stays under 100k xp', dailyCeiling < 100000);

section('run lifecycle');
const first = arena.createRun(7, ['A', 'B'], 1000);
check('run is created', first.ok === true);
check('run starts in prep', first.run.phase === 'prep');
check('prep ends after the configured delay', first.run.phaseUntil === 1000 + CFG.prepMs);
check('a second run cannot share the instance', arena.createRun(7, ['C'], 1000).error === 'instance_busy');
check('members resolve back to the run', arena.runForPlayer('B').id === first.run.id);
check('an empty run is refused', arena.createRun(8, [], 1000).error === 'no_members');

arena.markDown(first.run, 'B');
check('a downed member is not standing', arena.standingMembers(first.run).length === 1);
check('a downed member is still active', arena.activeMembers(first.run).length === 2);
check('the run is not over while one stands', arena.isOver(first.run) === false);

arena.markUp(first.run, 'B');
check('reviving puts them back on their feet', arena.standingMembers(first.run).length === 2);

arena.markDown(first.run, 'A');
arena.markDown(first.run, 'B');
check('the run ends when everyone is down', arena.isOver(first.run) === true);

arena.markUp(first.run, 'A');
first.run.candleHealth = 0;
check('the run ends when the candle falls', arena.isOver(first.run) === true);

arena.endRun(first.run);
check('ending frees the instance', arena.runForInstance(7) === null);
check('ending frees the members', arena.runForPlayer('A') === null);

section('leaving');
const second = arena.createRun(9, ['A', 'B'], 2000);
arena.dropMember(second.run, 'B');
check('a leaver is no longer active', arena.activeMembers(second.run).length === 1);
check('a leaver has no run', arena.runForPlayer('B') === null);
arena.dropMember(second.run, 'A');
check('the run is over once everyone left', arena.isOver(second.run) === true);
arena.endRun(second.run);

if (failures > 0) {
  console.log(`\n${failures} arena check(s) failed`);
  process.exit(1);
}

console.log('\nall arena checks passed');
