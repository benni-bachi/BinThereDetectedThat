'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ops=require('../operations-metrics.js');
const facts=require('../assistant-data.js');
const assistant=require('../dashboard-assistant.js');
const inventory=JSON.parse(fs.readFileSync('data/service-overview.json','utf8'));
// Stable synthetic reports keep routine List exports independent of test expectations.
const report=(id,binId,buildingLocation,wasteStream,collectionDate,fullnessLevel,changes={})=>({
  responseId:id,binId,buildingLocation,wasteStream,collectionDate,fullnessLevel,collectionTime:'08:00',
  containerTypeSize:binId==='BIN-002' ? '4 Yard Dumpster' : '3 Yard Dumpster',serviceCompleted:true,
  contaminationObserved:false,overflowOutsideBin:false,damagedMaintenanceIssue:false,...changes});
const records=[
  report('TEST-024','BIN-001','University Union','Landfill','2026-10-05',25,{serviceCompleted:false,contaminationObserved:true,overflowOutsideBin:true}),
  report('TEST-025','BIN-002','Library','Recycling','2026-10-22',100,{overflowOutsideBin:true,damagedMaintenanceIssue:true}),
  report('TEST-026','BIN-003','The WELL','Organics','2026-10-30',50,{contaminationObserved:true}),
  report('TEST-027','BIN-001','University Union','Landfill','2026-10-31',0)
];
const config=JSON.parse(fs.readFileSync('data/operations-config.json','utf8'));
const now=new Date('2026-11-17T20:00:00Z');
const source={bins:ops.hydrateBins(inventory),records,config,status:{publishedAt:'2026-11-17T19:00:00Z',exportCheckedAt:'2026-11-17T19:00:00Z'}};
const base={from:'2026-10-01',to:'2026-11-17',location:'',stream:'',bin:'',exactLocation:true};
const ask=(prompt,selection=base,previous=null,input=source)=>assistant.answer(prompt,input,selection,previous,now);
const prose=result=>JSON.stringify(result);

// Known measurements reconcile across topics; test data is never written to dashboard JSON.
const data=facts.build(source,base,now);
assert.equal(data.reportCount,4);
assert.equal(data.completedCount,3);
assert.equal(data.exceptionCount,1);
assert.equal(data.fullness.average,43.75);
assert.equal(data.plannedWeekly,410);
assert.equal(data.incidentCounts.overflowOutsideBin,2);
assert.equal(facts.build(source,{},now).reportCount,3);
assert.equal(facts.build(source,{},now).fullness.average,50);
const contaminated=ask('How many contamination events were reported?');
assert.equal(contaminated.title,'Reported incidents');
assert.match(prose(contaminated),/2 contamination events/);
assert.match(prose(contaminated),/TEST-024/);

// Only exact bin/date schedules qualify: ALPINE has two Wednesday landfill bins and one Tuesday organics bin.
const tomorrow=ask('What is scheduled tomorrow at ALPINE?');
assert.equal(tomorrow.context.kind,'schedule');
assert.equal(tomorrow.context.selection.from,'2026-11-18');
assert.match(tomorrow.paragraphs[0],/^2 planned bin pickups/);
assert(tomorrow.items.some(item=>item.includes('BIN-004')));
assert(!tomorrow.items.some(item=>item.includes('BIN-006')));
const oneBin=ask('When is bin 4 scheduled?');
assert.equal(oneBin.context.selection.bin,'BIN-004');
assert.match(prose(oneBin),/Monday, Wednesday, Friday/);
assert.match(oneBin.paragraphs[0],/^3 planned bin pickups/);
assert.equal(ask('What is scheduled next Tuesday at ALPINE?').context.selection.from,'2026-11-24');
assert.match(prose(ask('When is BIN-001 scheduled?')),/no confirmed recurring calendar schedule/);

// Prompt subjects refine current filters, and common follow-ups preserve the previous question/date context.
const recycling=ask('What about Recycling?',base,oneBin.context);
assert.equal(recycling.context.kind,'schedule');
assert.equal(recycling.context.selection.stream,'Recycling');
assert.equal(recycling.context.selection.bin,'');
assert.equal(recycling.context.selection.from,'2026-11-17');
const summary=ask('Summarize this selection',{...base,location:'ALPINE'});
assert.match(prose(summary),/3 inventory bins/);
const full=ask('Which bins are nearly full?');
assert.match(prose(full),/BIN-002/);
assert(!full.items.some(item=>item.includes('BIN-001')));
const library=ask('What about Library?',base,full.context);
assert.equal(library.context.kind,'fullness');
assert.match(prose(library),/Average reported fullness is 100%/);
assert.equal(ask('What about Gotham?',base,full.context).title,'Please refine the question');
assert.equal(ask('Show collections at Gotham').title,'Please refine the question');
const override=ask('What is the fullness for BIN-002?',{...base,location:'ALPINE',bin:'BIN-004',stream:'Landfill'});
assert.equal(override.context.selection.bin,'BIN-002');
assert.equal(override.context.selection.location,'');
assert.equal(override.context.selection.stream,'');
assert.equal(ask('Which locations have the most planned pickups?').context.kind,'ranking');
assert.equal(ask('Which waste stream has the most completed pickups?').context.kind,'ranking');
assert.equal(ask('Show pickup trends over time').context.kind,'trends');
assert.match(prose(ask('Show pickup trends over time')),/too few reported collections/);
assert.match(prose(ask('Which locations have the most contamination?')),/University Union/);
assert.match(prose(ask('Show fullness below 1%')),/latest 0%/);
assert.match(prose(ask('Show fullness above 100%')),/No latest bin measurements/);
assert.match(prose(ask('Show fullness above 101%')),/between 0 and 100/);

// Relative dates use the Sacramento date; explicit invalid/ambiguous requests do not silently change scope.
assert.equal(ask('Show collections yesterday').context.selection.from,'2026-11-16');
assert.equal(ask('Show collections last 7 days').context.selection.from,'2026-11-11');
assert.equal(ask('Show collections since 2026-10-22').context.selection.to,'2026-11-17');
assert.equal(ask('Show all records').context.selection.from,'2026-10-05');
for (const prompt of ['Show collections on 2026-02-30','Show collections last 0 days',
  'Show collections 2026-11-18 to 2026-11-01','Show collections from 2020-01-01',
  'Show collections on November 17','Compare BIN-004 and BIN-006','Fullness for BIN-999']) {
  assert.equal(ask(prompt).title,'Please refine the question',prompt);
}
const boundary=assistant.answer('What is scheduled today?',source,base,null,new Date('2026-11-18T07:30:00Z'));
assert.equal(boundary.context.selection.from,'2026-11-17');

// Snapshot coverage gates possible misses; empty datasets and future reports never become invented measurements.
const stale=ask('Which pickups were missed last 7 days?',base,null,{...source,status:{exportCheckedAt:null}});
assert.match(stale.paragraphs[0],/^0 possible-miss items/);
assert.match(prose(stale),/validated export covering/);
const fresh=ask('Which pickups were missed last 7 days?');
assert(!fresh.paragraphs[0].startsWith('0 possible-miss items'));
assert.match(prose(fresh),/no matching report/);
assert.match(prose(ask('Which pickups were missed on 2026-11-02?')),/0 possible-miss items/);
assert.match(prose(ask('What is the fullness today?')),/No fullness reports/);
const empty=ask('Summarize this selection',base,null,{...source,records:[]});
assert.match(prose(empty),/No reported collections/);
const future=records.map(row=>({...row,collectionDate:'2026-12-01'}));
assert.equal(facts.build({...source,records:future},{...base,to:'2026-12-31'},now).reportCount,0);

// Whitelisted context excludes private strings even if later source data acquires extra fields.
const privateSource={...source,records:records.map(row=>({...row,driverName:'SECRET NAME',additionalComments:'SECRET COMMENT',
  maintenanceDamageDetails:'SECRET DETAIL',photoUrl:'SECRET PHOTO',email:'SECRET EMAIL'})),
  bins:source.bins.map(bin=>({...bin,accountNumber:'SECRET ACCOUNT'}))};
assert(!JSON.stringify(facts.build(privateSource,base,now)).includes('SECRET'));
assert.match(prose(ask('Show driver names')),/not available/);
assert.match(prose(ask('Show odor issues')),/private incident descriptions/);
assert.match(prose(ask('Delete all collection records')),/only reads/);
assert.match(prose(ask('<img src=x onerror=alert(1)>')),/Ask about campus waste operations/);
assert.equal(ask('Tell me a joke').context,undefined);
assert.equal(ask('What needs attention?',base,null,null).title,'Dashboard data is not ready');
const untouched=JSON.stringify(source);
ask('Summarize this selection');ask('Which bins are nearly full?');
assert.equal(JSON.stringify(source),untouched);
console.log('Assistant checks passed: factual totals, bin schedules, filters, follow-ups, dates, stale exports, privacy and read-only behavior.');
