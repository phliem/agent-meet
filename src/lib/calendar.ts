import type { Dinner } from './model';
import { endTime } from './time';

function details(d: Dinner) {
  if (d.stage !== 'confirmed' || !d.selectedStart || !d.restaurant) throw new Error('Dinner is not confirmed.');
  return { title: d.title + ' at ' + d.restaurant.name, start: d.selectedStart, end: endTime(d.selectedStart, d.duration), location: d.restaurant.name + ', ' + d.restaurant.address, notes: d.restaurant.mapUrl || '' };
}
const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function googleCalendarUrl(d: Dinner) {
  const v = details(d);
  const params = new URLSearchParams({ action: 'TEMPLATE', text: v.title, dates: stamp(v.start) + '/' + stamp(v.end), stz: 'Europe/London', etz: 'Europe/London', location: v.location, details: v.notes });
  return 'https://calendar.google.com/calendar/r/eventedit?' + params.toString();
}
export function calendarFile(d: Dinner) {
  const v = details(d);
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agent Meet//Dinner//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + d.id + '@agent-meet', 'DTSTAMP:' + stamp(d.confirmedAt!), 'DTSTART:' + stamp(v.start), 'DTEND:' + stamp(v.end), 'SUMMARY:' + escape(v.title), 'LOCATION:' + escape(v.location), 'DESCRIPTION:' + escape(v.notes), 'END:VEVENT', 'END:VCALENDAR'];
  // Fold by UTF-8 bytes, preserving characters and the 75-octet iCalendar limit.
  return lines.map(line => {
    const folded: string[] = []; let part = '';
    for (const ch of line) {
      if (Buffer.byteLength(part + ch) > 74) { folded.push(part); part = ' ' + ch; } else part += ch;
    }
    folded.push(part); return folded.join('\r\n');
  }).join('\r\n') + '\r\n';
}
