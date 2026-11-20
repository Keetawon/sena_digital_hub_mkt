import assert from "node:assert/strict";
import { test } from "node:test";
import { retryBusyUpload } from "../apps/admin/lib/upload-retry.ts";

function clock(t) {
  let elapsed = 0;
  const waits = [];
  t.mock.method(performance, "now", () => elapsed);
  t.mock.method(Date, "now", () => Date.UTC(2026, 10, 18) + elapsed);
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    waits.push(delay); elapsed += delay; callback(); return 0;
  });
  return { waits, elapsed: () => elapsed, advance: ms => { elapsed += ms; } };
}
function busy(value) {
  return new Response(JSON.stringify({error:{message:"busy"}}), { status:429, headers:value === undefined ? {} : {"Retry-After":value} });
}

test("waits Retry-After seconds, announces waiting and returns the accepted upload", async t => {
  const c=clock(t), states=[], times=[];
  const accepted=new Response("accepted", {status:201});
  const result=await retryBusyUpload(async () => { times.push(c.elapsed()); return times.length===1 ? busy("3") : accepted; }, v=>states.push(v));
  assert.equal(result,accepted); assert.deepEqual(times,[0,3000]); assert.deepEqual(c.waits,[3000]); assert.deepEqual(states,[true,false]);
});
test("honors an HTTP-date Retry-After", async t => {
  const c=clock(t); let calls=0;
  await retryBusyUpload(async()=>++calls===1 ? busy(new Date(Date.UTC(2026,10,18,0,0,7)).toUTCString()) : new Response("",{status:201}));
  assert.deepEqual(c.waits,[7000]);
});
test("keeps the last busy error and does not start a retry at or after 60 seconds", async t => {
  const c=clock(t), states=[]; let calls=0;
  const result=await retryBusyUpload(async()=>{calls++;return busy("17");},v=>states.push(v));
  assert.equal(result.status,429); assert.equal(await result.text(),'{"error":{"message":"busy"}}');
  assert.equal(c.elapsed(),60000); assert.equal(calls,4); assert.deepEqual(c.waits,[17000,17000,17000,9000]); assert.equal(states.at(-1),false);
});
test("a Retry-After beyond the budget is never retried early", async t => {
  const c=clock(t); let calls=0;
  assert.equal((await retryBusyUpload(async()=>{calls++;return busy("90");})).status,429);
  assert.equal(calls,1); assert.deepEqual(c.waits,[60000]);
});
test("missing or malformed headers have a one-second bounded fallback", async t => {
  const c=clock(t); let calls=0;
  await retryBusyUpload(async()=>[busy(),busy("bad"),busy("-1"),busy("0"),new Response("",{status:201})][calls++]);
  assert.deepEqual(c.waits,[1000,1000,1000,1000]);
});
test("does not retry auth, validation, server errors or successful responses", async t => {
  clock(t);
  for(const status of [201,401,403,409,422,500]) {
    let calls=0; const states=[];
    const response=new Response("",{status});
    assert.equal(await retryBusyUpload(async()=>{calls++;return response;},v=>states.push(v)),response);
    assert.equal(calls,1); assert.deepEqual(states,[]);
  }
});
test("network errors stop retrying and clear waiting", async t => {
  clock(t); let calls=0;const states=[];
  await assert.rejects(retryBusyUpload(async()=>{if(++calls===1)return busy("1");throw new Error("offline");},v=>states.push(v)),/offline/);
  assert.equal(calls,2);assert.deepEqual(states,[true,false]);
});

test("an extremely long numeric Retry-After remains outside the retry budget", async t => {
  const c=clock(t); let calls=0;
  assert.equal((await retryBusyUpload(async()=>{calls++;return busy("9".repeat(400));})).status,429);
  assert.equal(calls,1); assert.deepEqual(c.waits,[60000]);
});
