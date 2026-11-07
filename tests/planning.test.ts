import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/lib/db';
import { newDinner } from '../src/lib/domain';
import { insertDinner, changeDinner, readDinner } from '../src/lib/store';
import { planDinner } from '../src/lib/planning';
import type { Area } from '../src/lib/model';

test('provider leases deduplicate work and release after stale or failed results', { skip: !process.env.DATABASE_URL }, async () => {
  const sql = db();
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  const dinner = newDinner({ title: 'Synthetic planner', hostName: 'Host', names: ['Guest'], mode: 'fixed', fixedStart: future(7), duration: 120, deadline: future(2) }, 'synthetic-hash');
  dinner.stage = 'recommending'; dinner.selectedStart = dinner.fixedStart;
  const area: Area = { id: 'synthetic-area', name: 'Synthetic area', lat: 51.5, lon: -0.1, longest: 25, journeys: [], explanation: 'Fixture' };
  await insertDinner(dinner);
  let calls = 0;
  const planner = { areas: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 25)); return [area]; }, restaurants: async () => [] };
  try {
    const results = await Promise.all([planDinner(dinner.id, 'areas', planner), planDinner(dinner.id, 'areas', planner)]);
    assert.equal(calls, 1); assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await readDinner(dinner.id))!.stage, 'area-voting');
    assert.equal((await sql`SELECT dinner_id FROM planning_leases WHERE dinner_id=${dinner.id}`).length, 0);
    await changeDinner(dinner.id, current => { current.stage = 'recommending'; current.areas = []; });
    await assert.rejects(planDinner(dinner.id, 'areas', { ...planner, areas: async () => { throw new Error('Synthetic outage'); } }), /Synthetic outage/);
    let signalStart!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { signalStart = resolve; });
    const deferred = new Promise<void>(resolve => { release = resolve; });
    const stale = planDinner(dinner.id, 'areas', { ...planner, areas: async () => { signalStart(); await deferred; return [area]; } });
    await started;
    await changeDinner(dinner.id, current => { current.title = 'Updated while loading'; });
    release();
    await assert.rejects(stale, /updated/);
    assert.equal((await readDinner(dinner.id))!.stage, 'recommending');
    assert.equal(await planDinner(dinner.id, 'areas', planner), true);
  } finally {
    await sql`DELETE FROM dinners WHERE id=${dinner.id}`;
    await sql.end();
  }
});
