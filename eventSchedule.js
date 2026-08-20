// game-server/eventSchedule.js

const DAY_MS = 24 * 60 * 60 * 1000;

function toEpoch(value) {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function eventWindow(event, now = Date.now()) {
  const startsAt = toEpoch(event?.startsAt);
  const endsAt = toEpoch(event?.endsAt);

  if (startsAt === null && endsAt === null) {
    return { state: 'always', open: true, opensAt: null, closesAt: null };
  }

  if (startsAt === null) {
    return now < endsAt
      ? { state: 'open', open: true, opensAt: null, closesAt: endsAt }
      : { state: 'ended', open: false, opensAt: null, closesAt: endsAt };
  }

  if (endsAt === null || endsAt <= startsAt) {
    return now >= startsAt
      ? { state: 'open', open: true, opensAt: startsAt, closesAt: null }
      : { state: 'upcoming', open: false, opensAt: startsAt, closesAt: null };
  }

  const duration = endsAt - startsAt;
  const repeatDays = Number(event?.repeatDays) || 0;
  const period = repeatDays > 0 ? repeatDays * DAY_MS : 0;

  if (now < startsAt) {
    return { state: 'upcoming', open: false, opensAt: startsAt, closesAt: endsAt };
  }

  if (period <= 0) {
    return now < endsAt
      ? { state: 'open', open: true, opensAt: startsAt, closesAt: endsAt }
      : { state: 'ended', open: false, opensAt: startsAt, closesAt: endsAt };
  }

  const cycles = Math.floor((now - startsAt) / period);
  const occurrenceStart = startsAt + cycles * period;
  const occurrenceEnd = occurrenceStart + Math.min(duration, period);

  if (now < occurrenceEnd) {
    return { state: 'open', open: true, opensAt: occurrenceStart, closesAt: occurrenceEnd };
  }

  const nextStart = occurrenceStart + period;
  return { state: 'upcoming', open: false, opensAt: nextStart, closesAt: nextStart + Math.min(duration, period) };
}

module.exports = { DAY_MS, eventWindow };
