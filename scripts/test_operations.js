'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ops = require('../operations-metrics.js');
const data = JSON.parse(fs.readFileSync('data/service-overview.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('data/operations-config.json', 'utf8'));
const bins = ops.hydrateBins(data);
const now = new Date('2026-11-03T20:00:00Z');
const report = changes => ({responseId: 'LIST-101', binId: 'BIN-006', buildingLocation: 'ALPINE', wasteStream: 'Organics',
  collectionDate: '2026-11-03', collectionTime: '08:00', fullnessLevel: 90, serviceCompleted: true, ...changes});

// Bins at one location keep their different service dates. Existing IDs stay stable.
assert.equal(bins.length, 300);
assert.equal(new Set(bins.map(b => b.binId)).size, 300);
assert.deepEqual(bins.find(b => b.binId === 'BIN-004').serviceDays, ['MON', 'WED', 'FRI']);
assert.deepEqual(bins.find(b => b.binId === 'BIN-006').serviceDays, ['TUE']);
const tuesday = ops.calendarEvents(bins, [], '2026-11-03', '2026-11-03', config, now);
assert(tuesday.some(e => e.binId === 'BIN-006'));
assert(!tuesday.some(e => e.binId === 'BIN-004'));
assert.equal(ops.calendarEvents(bins, [], '2026-11-02', '2026-11-08', config, now).length, 404);
assert(!ops.hasSchedule({weeklyFrequency: null, serviceDays: ['TUE']}));
assert(!ops.hasSchedule({weeklyFrequency: 4, serviceDays: ['TUE']}));
assert(!ops.hasSchedule({weeklyFrequency: 2, serviceDays: ['TUE', 'TUE']}));
// Explicit per-bin overrides take precedence over a source-group schedule.
const override = {...data, bins: [{...data.bins[0], weeklyFrequency: 1, serviceDays: ['SUN']}]};
assert.deepEqual(ops.hydrateBins(override)[0].serviceDays, ['SUN']);

// A Tuesday service day ends Wednesday at midnight. An extra 24 hours means Thursday midnight.
assert.equal(new Date(ops.deadline('2026-11-03', config)).toISOString(), '2026-11-05T08:00:00.000Z');
assert.equal(ops.eventStatus('2026-11-03', [], config, new Date('2026-11-05T07:59:59Z')), 'grace');
assert.equal(ops.eventStatus('2026-11-03', [], config, new Date('2026-11-05T08:00:00Z')), 'possible-missed');
assert.equal(ops.eventStatus('2026-11-03', [], {...config, reportingThrough: null}, new Date('2026-11-05T09:00:00Z')), 'awaiting-update');
assert.equal(ops.eventStatus('2026-11-03', [], {...config, reportingThrough: '2026-11-05T07:00:00Z'}, new Date('2026-11-05T09:00:00Z')), 'awaiting-update');
assert.equal(ops.eventStatus('2026-11-03', [], {...config, reportingThrough: '2026-11-05T08:30:00Z'}, new Date('2026-11-05T09:00:00Z')), 'possible-missed');
assert.equal(ops.eventStatus('2026-11-02', [], config, new Date('2026-11-10T20:00Z')), 'planned');
assert.equal(ops.eventStatus('2026-11-04', [report()], config, now), 'scheduled');
assert.equal(ops.campusDate(new Date('2026-11-04T07:30Z'), config.timeZone), '2026-11-03');
// Midnight conversion and elapsed grace also behave across daylight-saving changes.
assert.equal(new Date(ops.midnight('2026-03-08', config.timeZone)).toISOString(), '2026-03-08T08:00:00.000Z');
assert.equal(new Date(ops.midnight('2026-03-09', config.timeZone)).toISOString(), '2026-03-09T07:00:00.000Z');
assert.equal(new Date(ops.midnight('2026-11-01', config.timeZone)).toISOString(), '2026-11-01T07:00:00.000Z');
assert.equal(new Date(ops.midnight('2026-11-02', config.timeZone)).toISOString(), '2026-11-02T08:00:00.000Z');
assert.equal(ops.addDays('2028-02-28', 1), '2028-02-29');
assert.equal(ops.addDays('2026-12-31', 1), '2027-01-01');

// Matching uses bin ID and service date; a different bin at the same location cannot satisfy service.
const due = new Date('2026-11-05T10:00Z');
const alpine = bins.filter(b => ['BIN-004', 'BIN-006'].includes(b.binId));
assert.equal(ops.calendarEvents(alpine, [report({binId: 'BIN-004'})], '2026-11-03', '2026-11-03', config, due)[0].status, 'possible-missed');
assert.equal(ops.calendarEvents(alpine, [report()], '2026-11-03', '2026-11-03', config, due)[0].status, 'completed');
const failed = report({serviceCompleted: false});
assert.equal(ops.eventStatus('2026-11-03', [failed], config, due), 'exception');
assert.equal(ops.eventStatus('2026-11-03', [failed, report({responseId: 'LIST-102', collectionTime: '09:00'})], config, due), 'completed');
assert.equal(ops.attentionRows(alpine, [report()], '2026-11-03', '2026-11-03', config, due).rows.length, 0);
assert.equal(ops.attentionRows(alpine, [], '2026-10-01', '2026-11-02', config, due).rows.length, 0);
assert(ops.attentionRows([], [report({binId: 'BIN-001', serviceCompleted: false})], '2026-11-03', '2026-11-03', config, due).rows.some(r => r.status === 'exception'));

// Fullness reflects reported measurements, including zero, and excludes future-dated reports.
const insights = ops.fullness([report({fullnessLevel: 0, collectionTime: '07:00'}),
  report({responseId: 'LIST-102', fullnessLevel: 100}), report({collectionDate: '2026-11-04'})], now, config.timeZone);
assert.equal(insights.average, 50);
assert.equal(insights.nearCapacity, 1);
assert.equal(insights.low, 1);
assert.deepEqual(insights.distribution, [1, 0, 0, 1]);
assert.equal(insights.bins[0].change, 100);
assert.equal(ops.fullness([], now).average, null);
const exported = ops.csv([{binId: '=SUM(1,2)', additionalComments: 'Line one\n"Line two"'}], ['binId', 'additionalComments']);
assert(exported.includes('"\'=SUM(1,2)"'));
assert(exported.includes('"Line one\n""Line two"""'));
assert.throws(() => ops.calendarEvents(bins, [], '2026-02-30', '2026-03-01', config, now));
assert.throws(() => ops.calendarEvents(bins, [], '2024-01-01', '2026-01-01', config, now));
console.log('Operations checks passed: per-bin schedules, grace deadlines, DST, report matching, monitoring coverage, fullness and CSV.');
