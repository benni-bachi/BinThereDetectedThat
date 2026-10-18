// Independent controls for schedule totals, weighted pickups, and date grouping.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const math = require('../overview-metrics.js');
const data = JSON.parse(fs.readFileSync('data/service-overview.json','utf8'));
const bins = data.bins;
assert.equal(bins.length,300);
assert.equal(new Set(bins.map(b=>b.binId)).size,300);
assert.deepEqual(['Landfill','Recycling','Organics'].map(stream=>bins.filter(b=>b.wasteStream===stream).length),[102,86,112]);
assert.equal(bins.filter(b=>b.qrStatus==='ready').length,269);
assert.equal(math.weeklyPickups({quantity:21,weeklyFrequency:null}),0);
assert.equal(math.weeklyPickups({quantity:5,weeklyFrequency:5}),25);
assert.equal(math.weekdays([{quantity:1,weeklyFrequency:4,serviceDays:['TUE']}]).reduce((s,p)=>s+p[1],0),0);
assert.deepEqual(math.weeklyHistory([{collectionDate:'2026-10-05'},{collectionDate:'2026-10-25'}]),[['2026-10-05',1],['2026-10-12',0],['2026-10-19',1]]);
assert.deepEqual(math.weeklyHistory([]),[]);
console.log('Overview controls passed: quantities, unique IDs, held labels, frequency gaps, and zero-filled weeks.');
