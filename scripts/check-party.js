// game-server/scripts/check-party.js
const party = require('../party');

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

function reset() {
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y']) party.forgetPlayer(id);
  party.pruneInvites(Date.now() + party.INVITE_TTL_MS * 2);
}

section('forming a party');
reset();
check('invite to yourself is refused', party.invite('A', 'A').error === 'self');
check('invite lands', party.invite('A', 'B').ok === true);
check('same invite twice is refused', party.invite('A', 'B').error === 'already_invited');
check('no party exists before the invite is answered', party.partyOf('A') === null);
check('accepting creates the party', party.accept('B', 'A').ok === true);
check('inviter leads', party.partyOf('A').leaderId === 'A');
check('roster holds both', party.membersOf('A').length === 2);

section('answering invites');
reset();
party.invite('A', 'B');
party.invite('C', 'B');
check('first accept works', party.accept('B', 'A').ok === true);
check('second invite is gone after joining', party.accept('B', 'C').error === 'no_invite');
check('inviting someone already grouped is refused', party.invite('C', 'B').error === 'target_in_party');
check('declining removes the invite', party.decline('B', 'C').ok === false);

section('size limit');
reset();
party.invite('A', 'B'); party.accept('B', 'A');
party.invite('A', 'C'); party.accept('C', 'A');

party.invite('A', 'D');
party.invite('A', 'E');
check('two invites go out while there is room', party.accept('D', 'A').ok === true);
check(`party holds ${party.MAX_PARTY_SIZE}`, party.membersOf('A').length === party.MAX_PARTY_SIZE);
check('the last invite cannot squeeze in a fifth', party.accept('E', 'A').error === 'full');
check('a full party cannot invite', party.invite('A', 'F').error === 'full');

section('allies');
check('members are allies', party.areAllies('B', 'D') === true);
check('outsiders are not', party.areAllies('B', 'E') === false);
check('nobody is their own ally', party.areAllies('B', 'B') === false);

section('leaving and kicking');
check('a member cannot kick', party.kick('B', 'C').error === 'not_leader');
check('the leader cannot kick themselves', party.kick('A', 'A').error === 'self');
check('the leader kicks', party.kick('A', 'D').ok === true);
check('the kicked player is free', party.areAllies('A', 'D') === false);
check('leaving passes leadership', party.leave('A').party.leaderId === 'B');
check('the last two shrink to nothing', party.leave('B').disbanded === true);
check('the survivor has no party', party.partyOf('C') === null);

section('disconnects and stale invites');
reset();
party.invite('A', 'B');
party.forgetPlayer('A');
check('an invite dies with the inviter', party.accept('B', 'A').error === 'no_invite');
party.invite('X', 'Y', Date.now() - party.INVITE_TTL_MS - 1000);
const expired = party.pruneInvites();
check('expired invites are pruned', expired.length === 1 && expired[0].targetId === 'Y');
check('a pruned invite cannot be accepted', party.accept('Y', 'X').error === 'no_invite');

if (failures > 0) {
  console.log(`\n${failures} party check(s) failed`);
  process.exit(1);
}

console.log('\nall party checks passed');
