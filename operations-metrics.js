'use strict';
// Calendar dates are campus dates. UTC arithmetic keeps date-only values stable.
const Operations = (() => {
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const HOUR = 60 * 60 * 1000;
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  }
  function addDays(value, days) {
    if (!validDate(value)) throw new Error('Invalid calendar date.');
    const result = new Date(`${value}T00:00:00Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
  }
  function monday(value) {
    return addDays(value, -(new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7);
  }
  function campusDate(now = new Date(), timeZone = 'America/Los_Angeles') {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'})
      .formatToParts(now);
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function midnight(value, timeZone) {
    const [year, month, day] = value.split('-').map(Number);
    const desired = Date.UTC(year, month - 1, day);
    let result = desired;
    const formatter = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(formatter.formatToParts(new Date(result)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
      const displayed = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      result += desired - displayed;
    }
    return result;
  }
  function validateConfig(config) {
    if (!config || !validDate(config.monitoringStartDate) || !Number.isInteger(config.graceHoursAfterServiceDay)
        || config.graceHoursAfterServiceDay < 0 || config.graceHoursAfterServiceDay > 168) throw new Error('Invalid monitoring settings.');
    new Intl.DateTimeFormat('en-US', {timeZone: config.timeZone}).format(new Date());
    return config;
  }
  function deadline(date, config) {
    return midnight(addDays(date, 1), config.timeZone) + config.graceHoursAfterServiceDay * HOUR;
  }
  function hydrateBins(data) {
    // The source row and stream identify a service group, not the location alone.
    const services = new Map();
    for (const row of data.services) {
      const key = `${row.sourceRow}|${row.wasteStream}`;
      if (services.has(key)) throw new Error('Duplicate service group.');
      services.set(key, row);
    }
    return data.bins.map(bin => {
      const source = services.get(`${bin.sourceRow}|${bin.wasteStream}`);
      if (!source || source.buildingLocation !== bin.buildingLocation) throw new Error('Bin schedule does not match its source group.');
      return {...bin,
        weeklyFrequency: Object.hasOwn(bin, 'weeklyFrequency') ? bin.weeklyFrequency : source.weeklyFrequency,
        serviceDays: [...(Array.isArray(bin.serviceDays) ? bin.serviceDays : source.serviceDays)]};
    });
  }
  function hasSchedule(bin) {
    return Number.isInteger(bin.weeklyFrequency) && bin.weeklyFrequency > 0 && bin.weeklyFrequency <= 7
      && Array.isArray(bin.serviceDays) && bin.serviceDays.length === bin.weeklyFrequency
      && new Set(bin.serviceDays).size === bin.serviceDays.length
      && bin.serviceDays.every(day => DAYS.includes(day));
  }
  function chronological(a, b) {
    return `${a.collectionDate}T${a.collectionTime}`.localeCompare(`${b.collectionDate}T${b.collectionTime}`)
      || a.responseId.localeCompare(b.responseId, undefined, {numeric: true});
  }
  function reportIndex(records) {
    const index = new Map();
    for (const row of records) {
      const key = `${row.binId}|${row.collectionDate}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row);
    }
    for (const rows of index.values()) rows.sort(chronological);
    return index;
  }
  function eventStatus(date, reports, config, now) {
    const today = campusDate(now, config.timeZone);
    if (date > today) return 'scheduled';
    if (reports.some(row => row.serviceCompleted === true)) return 'completed';
    if (reports.some(row => row.serviceCompleted === false)) return 'exception';
    if (date < config.monitoringStartDate) return 'planned';
    if (now.getTime() >= deadline(date, config)) {
      const covered = Object.hasOwn(config, 'reportingThrough') ? Date.parse(config.reportingThrough || '') : now.getTime();
      return Number.isFinite(covered) && covered >= deadline(date, config) ? 'possible-missed' : 'awaiting-update';
    }
    return date === today ? 'today' : 'grace';
  }
  function calendarEvents(bins, records, from, to, config, now = new Date()) {
    validateConfig(config);
    if (!validDate(from) || !validDate(to) || from > to) throw new Error('Choose a valid date range.');
    if (Date.parse(`${to}T00:00Z`) - Date.parse(`${from}T00:00Z`) > 366 * 24 * HOUR) throw new Error('Review up to one year at a time.');
    const index = reportIndex(records), output = [], scheduled = bins.filter(hasSchedule);
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const day = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
      for (const bin of scheduled) {
        if (!bin.serviceDays.includes(day)) continue;
        const reports = index.get(`${bin.binId}|${date}`) || [];
        output.push({...bin, date, reports, status: eventStatus(date, reports, config, now), deadline: deadline(date, config)});
      }
    }
    return output.sort((a, b) => a.date.localeCompare(b.date) || a.buildingLocation.localeCompare(b.buildingLocation)
      || a.binId.localeCompare(b.binId, undefined, {numeric: true}));
  }
  function attentionRows(bins, records, from, to, config, now = new Date()) {
    const today = campusDate(now, config.timeZone);
    const start = from > config.monitoringStartDate ? from : config.monitoringStartDate;
    const end = to < today ? to : today;
    if (start > end) return {events: [], rows: []};
    const events = calendarEvents(bins, records, start, end, config, now);
    const rows = events.filter(e => ['possible-missed', 'exception'].includes(e.status));
    const scheduledKeys = new Set(events.map(e => `${e.binId}|${e.date}`));
    // Reported exceptions also matter when a pilot bin has no workbook schedule.
    for (const [key, reports] of reportIndex(records)) {
      const last = reports.at(-1), date = last.collectionDate;
      if (date < start || date > end || scheduledKeys.has(key) || reports.some(r => r.serviceCompleted)) continue;
      if (reports.some(r => r.serviceCompleted === false)) rows.push({...last, date, reports, serviceDays: [], status: 'exception', deadline: null});
    }
    return {events, rows: rows.sort((a, b) => b.date.localeCompare(a.date) || a.binId.localeCompare(b.binId))};
  }
  function fullness(rows, now = new Date(), timeZone = 'America/Los_Angeles') {
    const today = campusDate(now, timeZone);
    const usable = rows.filter(r => r.collectionDate <= today && Number.isInteger(r.fullnessLevel) && r.fullnessLevel >= 0 && r.fullnessLevel <= 100);
    const groups = new Map(), dates = new Map();
    for (const row of usable) {
      if (!groups.has(row.binId)) groups.set(row.binId, []);
      groups.get(row.binId).push(row);
      if (!dates.has(row.collectionDate)) dates.set(row.collectionDate, []);
      dates.get(row.collectionDate).push(row.fullnessLevel);
    }
    const bins = [...groups.values()].map(reports => {
      reports.sort(chronological);
      const last = reports.at(-1), previous = reports.at(-2);
      return {...last, reportCount: reports.length, average: reports.reduce((n, r) => n + r.fullnessLevel, 0) / reports.length,
        change: previous ? last.fullnessLevel - previous.fullnessLevel : null};
    }).sort((a, b) => b.fullnessLevel - a.fullnessLevel || a.binId.localeCompare(b.binId));
    return {rows: usable, bins, average: usable.length ? usable.reduce((n, r) => n + r.fullnessLevel, 0) / usable.length : null,
      nearCapacity: usable.filter(r => r.fullnessLevel >= 76).length, low: usable.filter(r => r.fullnessLevel <= 25).length,
      distribution: [[0, 25], [26, 50], [51, 75], [76, 100]].map(([min, max]) => usable.filter(r => r.fullnessLevel >= min && r.fullnessLevel <= max).length),
      daily: [...dates].sort((a, b) => a[0].localeCompare(b[0])).map(([date, values]) => [date, values.reduce((a, b) => a + b, 0) / values.length])};
  }
  function csv(rows, fields) {
    const quote = value => {
      let text = String(value ?? '');
      // Keep spreadsheet applications from treating exported text as formulas.
      if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    return '\uFEFF' + [fields, ...rows.map(row => fields.map(field => row[field]))].map(row => row.map(quote).join(',')).join('\r\n');
  }
  return {DAYS, validDate, addDays, monday, campusDate, midnight, deadline, validateConfig, hydrateBins, hasSchedule,
    chronological, reportIndex, eventStatus, calendarEvents, attentionRows, fullness, csv};
})();
if (typeof module !== 'undefined') module.exports = Operations;
