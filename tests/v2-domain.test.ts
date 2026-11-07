import test from 'node:test';
import assert from 'node:assert/strict';
import { newDinner, parseReply, applyReply, applyCommand, installAreas } from '../src/lib/domain';
import { effectiveBudgetBand } from '../src/lib/v2-restaurants';

const at = new Date('2026-11-07T12:00:00Z');
const input = { title: 'Synthetic dinner', hostName: 'Host', names: ['Alex', 'Kim'], mode: 'fixed', fixedStart: '2026-11-25T19:00:00Z', deadline: '2026-11-24T12:00:00Z', duration: 120 };
function setup() {
  return newDinner({ ...input, experience: 'v2', identityMode: 'account', inviteEmails: ['alex@example.test', 'kim@example.test'] }, 'synthetic-host', at);
}
test('V2 creation validates invitation contacts without changing V1 records', () => {
  assert.throws(() => newDinner({ ...input, experience: 'v2' }, 'h', at), /verified accounts/);
  assert.throws(() => newDinner({ ...input, experience: 'v2', identityMode: 'account', inviteEmails: ['a@example.test'] }, 'h', at), /one invitation email/);
  const v1 = newDinner(input, 'h', at);
  assert.equal(v1.experience, undefined); assert.equal(v1.guests[0].invitationEmail, undefined);
  const d = setup(); assert.equal(d.guests[0].invitationEmail, 'alex@example.test');
});
test('V2 defaults private replies to medium and organiser explicitly resolves a budget conflict', () => {
  const d = setup();
  for (let i = 0; i < d.guests.length; i++) {
    const parsed = parseReply({ attending: true, origin: 'Waterloo', budgets: i ? ['high'] : ['low'] }, d, at.getTime());
    applyReply(d, { organiser: false, guestId: d.guests[i].id }, parsed, { label: 'Fixture', lat: 51.5, lon: -0.1, source: 'fixture' });
  }
  assert.equal(effectiveBudgetBand(d), undefined);
  assert.throws(() => applyCommand(d, { organiser: false }, { type: 'budget', band: 'low' }, at.getTime()), /organiser/);
  assert.throws(() => installAreas(d, [{ id: 'a', name: 'Fixture', lat: 51.5, lon: -0.1, journeys: [], longest: 20, explanation: 'Fixture' }]), /choose a budget/);
  applyCommand(d, { organiser: true }, { type: 'budget', band: 'medium' }, at.getTime());
  assert.equal(effectiveBudgetBand(d), 'medium'); assert.match(d.notice!, /conflicting/);
  d.stage = 'area-voting'; assert.throws(() => applyCommand(d, { organiser: true }, { type: 'budget', band: 'low' }, at.getTime()), /before area voting/);
});
test('V1 ignores injected budget answers and a V2 reset removes account access', () => {
  const v1 = newDinner(input, 'h', at);
  assert.equal(parseReply({ attending: true, origin: 'Waterloo', budgets: ['high'] }, v1, at.getTime()).budgets, undefined);
  const d = setup(), guest = d.guests[0]; guest.accountId = 'synthetic-account'; guest.claimHash = 'synthetic-claim'; guest.remindersAllowed = true;
  applyCommand(d, { organiser: true }, { type: 'reset', guestId: guest.id }, at.getTime());
  assert.equal(guest.accountId, undefined); assert.equal(guest.claimHash, undefined); assert.equal(guest.remindersAllowed, false);
});
