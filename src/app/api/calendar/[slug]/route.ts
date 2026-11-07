import { readDinner } from '@/lib/store';
import { calendarFile } from '@/lib/calendar';

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const dinner = await readDinner(slug);
  if (!dinner || dinner.stage !== 'confirmed') return new Response('Confirmed dinner not found.', { status: 404 });
  return new Response(calendarFile(dinner), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="agent-meet.ics"', 'Cache-Control': 'private, no-store' } });
}
