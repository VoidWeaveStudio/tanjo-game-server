// game-server/factionTasks.js
const FACTION_TASKS = [
  { key: 'first_blood_25', label: 'g.ft.first_blood_25.label', description: 'g.ft.first_blood_25.description', metric: 'kills', target: 25, rewardAsh: 250 },
  { key: 'war_party_100', label: 'g.ft.war_party_100.label', description: 'g.ft.war_party_100.description', metric: 'kills', target: 100, rewardAsh: 900 },
  { key: 'trigger_happy_2k', label: 'g.ft.trigger_happy_2k.label', description: 'g.ft.trigger_happy_2k.description', metric: 'shots', target: 2000, rewardAsh: 400 },
  { key: 'live_fire_8k', label: 'g.ft.live_fire_8k.label', description: 'g.ft.live_fire_8k.description', metric: 'shots', target: 8000, rewardAsh: 1400 },
  { key: 'treasury_3k', label: 'g.ft.treasury_3k.label', description: 'g.ft.treasury_3k.description', metric: 'ash', target: 3000, rewardAsh: 500 },
  { key: 'market_makers_12k', label: 'g.ft.market_makers_12k.label', description: 'g.ft.market_makers_12k.description', metric: 'ash', target: 12000, rewardAsh: 1800 },
];

const FACTION_TASKS_BY_KEY = new Map(FACTION_TASKS.map((t) => [t.key, t]));

module.exports = { FACTION_TASKS, FACTION_TASKS_BY_KEY };
