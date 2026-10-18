'use strict';
const OverviewMath = {
  sum(rows, field) { return rows.reduce((n, r) => n + r[field], 0); },
  group(rows, field, weight) {
    const counts = new Map();
    rows.forEach(r => counts.set(r[field], (counts.get(r[field]) || 0) + weight(r)));
    return [...counts].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  },
  weeklyPickups(row) { return row.weeklyFrequency === null ? 0 : row.quantity * row.weeklyFrequency; },
  weekdays(rows) {
    return ['MON','TUE','WED','THU','FRI','SAT','SUN'].map(day => [day, rows.reduce((n,r) =>
      n + (r.weeklyFrequency !== null && r.serviceDays.length === r.weeklyFrequency && r.serviceDays.includes(day) ? r.quantity : 0), 0)]);
  },
  weeklyHistory(rows) {
    if (!rows.length) return [];
    const monday = value => {
      const date = new Date(`${value}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
      return date.toISOString().slice(0,10);
    };
    const counts = new Map();
    rows.forEach(r => { const key = monday(r.collectionDate); counts.set(key, (counts.get(key) || 0) + 1); });
    const keys = [...counts.keys()].sort();
    const date = new Date(`${keys[0]}T00:00:00Z`), output = [];
    while (date.toISOString().slice(0,10) <= keys.at(-1)) {
      const key = date.toISOString().slice(0,10);
      output.push([key, counts.get(key) || 0]);
      date.setUTCDate(date.getUTCDate() + 7);
    }
    return output;
  }
};
if (typeof module !== 'undefined') module.exports = OverviewMath;
