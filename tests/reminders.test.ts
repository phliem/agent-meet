import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import type { Dinner } from '../src/lib/model';
import { reminderDue, reminderCandidate, reminderEligible, reminderKey, reminderMessage, runReminders } from '../src/lib/reminders';
const now = Date.parse('2030-06-01T12:00:00Z');
function fixture(): Dinner {
  const id = randomUUID();
  return { id, title: 'Synthetic dinner', hostName: 'Host', hostHash: 'hash', createdAt: new Date(now-2*86400000).toISOString(), expiresAt: new Date(now+10*86400000).toISOString(), mode: 'fixed', dateStart: '2030-06-05', dateEnd: '2030-06-05', deadline: new Date(now+86400000).toISOString(), duration: 120, fixedStart: '2030-06-05T18:00:00Z', stage: 'collecting', guests: [{ id: 'guest', name: 'Guest', claimHash: 'claim', accountId: 'account-'+id, invitationEmail: id+'@example.test', remindersAllowed: true }], includedIds: null, areas: [], restaurants: [], votesClosed: false, version: 1, dataMode: 'fixture', experience: 'v2', identityMode: 'account', remindersEnabled: true };
}
function job(d: Dinner) { return { id: reminderKey(d,d.guests[0]), dinner_id:d.id, guest_id:'guest', account_id:d.guests[0].accountId!, claim_hash:'claim', deadline:d.deadline, attempts:0 }; }
function account(d: Dinner) { return { id:d.guests[0].accountId!, email:d.guests[0].invitationEmail!, disabled_at:null }; }
test('reminder schedule uses 24 hours or midpoint for a short reply window', () => {
  const d=fixture(); assert.equal(reminderDue(d).getTime(),now);
  d.createdAt=new Date(now).toISOString(); d.deadline=new Date(now+12*3600000).toISOString();
  assert.equal(reminderDue(d).getTime(),now+6*3600000);
});
test('reminders require separate organiser and guest consent and unchanged verified identity', () => {
  const d=fixture(), j=job(d), a=account(d);
  assert.equal(reminderEligible(d,j,a,now),true);
  for (const mutate of [(x:Dinner)=>{x.remindersEnabled=false;}, (x:Dinner)=>{x.guests[0].remindersAllowed=false;}, (x:Dinner)=>{delete x.identityMode;}, (x:Dinner)=>{x.includedIds=[];}, (x:Dinner)=>{x.guests[0].claimHash='rotated';}, (x:Dinner)=>{x.deadline=new Date(now+3*86400000).toISOString();}, (x:Dinner)=>{x.stage='confirmed';}, (x:Dinner)=>{x.expiresAt=new Date(now).toISOString();}, (x:Dinner)=>{x.guests[0].reply={attending:false,availability:[],diets:[],otherDiet:'',cuisines:{}};}]) {
    const changed=structuredClone(d); mutate(changed); assert.equal(reminderEligible(changed,j,a,now),false);
  }
  assert.equal(reminderEligible(d,j,{...a,email:'wrong@example.test'},now),false);
  assert.equal(reminderEligible(d,j,{...a,disabled_at:new Date()},now),false);
  assert.equal(reminderEligible(undefined,j,a,now),false);
  assert.equal(reminderEligible(d,j,undefined,now),false);
  assert.equal(reminderCandidate(d,d.guests[0],Date.parse(d.deadline)),false);
});
test('generation changes on deadline extension and claim rotation; messages expose no private bearer token', () => {
  const d=fixture(), first=reminderKey(d,d.guests[0]);
  d.deadline=new Date(now+2*86400000).toISOString(); assert.notEqual(reminderKey(d,d.guests[0]),first);
  const second=reminderKey(d,d.guests[0]); d.guests[0].claimHash='new'; assert.notEqual(reminderKey(d,d.guests[0]),second);
  const m=reminderMessage(d,account(d).email,'https://app.example.test');
  assert.ok(m.text.includes('/account?dinner='+d.id)); assert.ok(m.text.includes('/d/'+d.id));
  assert.ok(!m.text.includes(d.guests[0].claimHash!)); assert.ok(!m.text.includes(d.guests[0].accountId!));
});
test('durable reminders are idempotent, retry safely and suppress invalidated generations', { skip:!process.env.DATABASE_URL }, async () => {
  const sql=db(), ids:string[]=[], accountIds:string[]=[];
  async function insert() {
    const d=fixture(); ids.push(d.id); accountIds.push(d.guests[0].accountId!);
    await sql`INSERT INTO accounts(id,email) VALUES (${d.guests[0].accountId!},${d.guests[0].invitationEmail!})`;
    await sql`INSERT INTO dinners(id,document,expires_at) VALUES (${d.id},${sql.json(d)},${d.expiresAt})`;
    return d;
  }
  async function save(d:Dinner) { await sql`UPDATE dinners SET document=${sql.json(d)} WHERE id=${d.id}`; }
  const deliveries:string[]=[]; const send=async (_message:unknown,key:string)=>{deliveries.push(key);return 'sent' as const;};
  try {
    const d=await insert();
    await Promise.all([runReminders(send,'https://app.example.test',10,now),runReminders(send,'https://app.example.test',10,now)]);
    await runReminders(send,'https://app.example.test',10,now);
    assert.equal(deliveries.filter(k=>k.endsWith(reminderKey(d,d.guests[0]))).length,1);
    const retry=await insert();
    await runReminders(async()=>{throw new Error('Synthetic transport outage');},'https://app.example.test',10,now);
    const pending=await sql`SELECT status,attempts FROM reminder_jobs WHERE id=${reminderKey(retry,retry.guests[0])}`;
    assert.equal(pending[0].status,'pending'); assert.equal(pending[0].attempts,1);
    await runReminders(send,'https://app.example.test',10,now+120001);
    assert.equal(deliveries.filter(k=>k.endsWith(reminderKey(retry,retry.guests[0]))).length,1);
    const extended=await insert(); extended.deadline=new Date(now+2*86400000).toISOString(); await save(extended);
    await runReminders(send,'https://app.example.test',0,now);
    const oldKey=reminderKey(extended,extended.guests[0]); extended.deadline=new Date(now+3*86400000).toISOString(); await save(extended);
    await runReminders(send,'https://app.example.test',0,now);
    assert.equal((await sql`SELECT status FROM reminder_jobs WHERE id=${oldKey}`)[0].status,'suppressed');
    for (const mutation of ['optout','disabled','confirmed','reset','replied','excluded','email-mismatch'] as const) {
      const x=await insert(); x.deadline=new Date(now+2*86400000).toISOString(); await save(x);
      await runReminders(send,'https://app.example.test',0,now); const key=reminderKey(x,x.guests[0]);
      if(mutation==='optout') x.guests[0].remindersAllowed=false;
      if(mutation==='confirmed') x.stage='confirmed';
      if(mutation==='reset') x.guests[0].claimHash='rotated';
      if(mutation==='replied') x.guests[0].reply={attending:false,availability:[],diets:[],otherDiet:'',cuisines:{}};
      if(mutation==='excluded') x.includedIds=[];
      if(mutation==='disabled') await sql`UPDATE accounts SET disabled_at=now() WHERE id=${x.guests[0].accountId!}`;
      if(mutation==='email-mismatch') await sql`UPDATE accounts SET email='changed@example.test' WHERE id=${x.guests[0].accountId!}`;
      await save(x); await runReminders(send,'https://app.example.test',25,now+86400001);
      assert.equal((await sql`SELECT status FROM reminder_jobs WHERE id=${key}`)[0].status,'suppressed',mutation);
      assert.ok(!deliveries.some(k=>k.endsWith(key)),mutation);
    }
    const deleted=await insert(); await runReminders(send,'https://app.example.test',0,now);
    await sql`DELETE FROM dinners WHERE id=${deleted.id}`;
    assert.equal((await sql`SELECT id FROM reminder_jobs WHERE dinner_id=${deleted.id}`).length,0);
  } finally {
    await sql`DELETE FROM dinners WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM accounts WHERE id IN ${sql(accountIds)}`;
    await sql.end();
  }
});
