import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarFile } from '../src/lib/calendar';
import { newDinner } from '../src/lib/domain';

test('calendar text normalises all newline forms without creating additional properties or events', () => {
  const dinner = newDinner({ title: 'Dinner', hostName: 'Sam', names: ['Sam'], mode: 'fixed', fixedStart: '2030-11-20T19:00:00Z', deadline: '2030-11-19T12:00:00Z', duration: 120 }, 'synthetic', new Date('2030-11-01T12:00:00Z'));
  dinner.stage = 'confirmed';
  dinner.selectedStart = dinner.fixedStart;
  dinner.confirmedAt = '2030-11-19T12:00:00Z';
  dinner.title = 'Dinner\rBEGIN:VEVENT\nNew line\r\nWindows line';
  dinner.restaurant = { id: 'example', name: 'Café, Friends; Table', address: '1 Example Lane\rATTENDEE:someone@example.invalid', mapUrl: '', sourceUrl: '', cuisines: [], price: 'medium', dietaryEvidence: [], hours: '' };
  const file = calendarFile(dinner);
  const lines = file.split('\r\n');
  assert.equal(lines.filter(line => line === 'BEGIN:VEVENT').length, 1);
  assert.equal(lines.filter(line => line === 'END:VEVENT').length, 1);
  assert.ok(lines.every(line => !/[\r\n]/.test(line)));
  assert.ok(!lines.some(line => line.startsWith('ATTENDEE:')));
  assert.match(file.replace(/\r\n /g, ''), /Dinner\\nBEGIN:VEVENT\\nNew line\\nWindows line/);
  assert.match(file.replace(/\r\n /g, ''), /Café\\, Friends\\; Table/);
});
