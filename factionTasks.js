// game-server/factionTasks.js
const FACTION_TASKS = [
  { key: 'first_blood_25', label: 'First Blood', description: 'Score 25 faction kills', metric: 'kills', target: 25, rewardAsh: 250 },
  { key: 'war_party_100', label: 'War Party', description: 'Score 100 faction kills', metric: 'kills', target: 100, rewardAsh: 900 },
  { key: 'trigger_happy_2k', label: 'Trigger Happy', description: 'Fire 2,000 shots as a faction', metric: 'shots', target: 2000, rewardAsh: 400 },
  { key: 'live_fire_8k', label: 'Live Fire Drill', description: 'Fire 8,000 shots as a faction', metric: 'shots', target: 8000, rewardAsh: 1400 },
  { key: 'treasury_3k', label: 'Treasury Run', description: 'Earn 3,000 Ash as a faction', metric: 'ash', target: 3000, rewardAsh: 500 },
  { key: 'market_makers_12k', label: 'Market Makers', description: 'Earn 12,000 Ash as a faction', metric: 'ash', target: 12000, rewardAsh: 1800 },
];

const FACTION_TASKS_BY_KEY = new Map(FACTION_TASKS.map((t) => [t.key, t]));

module.exports = { FACTION_TASKS, FACTION_TASKS_BY_KEY };
