'use strict';
// Shared, read-only facts for the assistant. Keep private fields out of its context.
const AssistantData = (() => {
  const ops = typeof module !== 'undefined' ? require('./operations-metrics.js') : Operations;
  const select = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field]]));
  const reportFields = ['responseId','binId','buildingLocation','wasteStream','containerTypeSize',
    'collectionDate','collectionTime','fullnessLevel','serviceCompleted','contaminationObserved',
    'overflowOutsideBin','damagedMaintenanceIssue'];
  const binFields = ['binId','buildingLocation','wasteStream','containerTypeSize','weeklyFrequency','serviceDays'];
  function group(rows, field, weight = () => 1) {
    const values = new Map();
    rows.forEach(row => values.set(row[field], (values.get(row[field]) || 0) + weight(row)));
    return [...values].map(([name, count]) => ({name, count})).sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  function build(source, selection = {}, now = new Date()) {
    const {config, status = {}} = source;
    ops.validateConfig(config);
    const today = ops.campusDate(now, config.timeZone);
    const from = selection.from || ops.addDays(today, -29), to = selection.to || today;
    if (!ops.validDate(from) || !ops.validDate(to) || from > to) throw new Error('Choose a valid date range.');
    if (Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('Choose up to one year of reports.');
    const normalized = value => String(value || '').toLocaleLowerCase();
    const match = row => (!selection.location || (selection.exactLocation
      ? row.buildingLocation === selection.location : normalized(row.buildingLocation) === normalized(selection.location)))
      && (!selection.stream || normalized(row.wasteStream) === normalized(selection.stream))
      && (!selection.bin || row.binId === selection.bin);
    const bins = source.bins.filter(match).map(row => select(row, binFields));
    const allReports = source.records.filter(match).map(row => select(row, reportFields));
    const reports = allReports.filter(row => row.collectionDate >= from && row.collectionDate <= to && row.collectionDate <= today)
      .sort((a,b) => ops.chronological(b,a));
    const completed = reports.filter(row => row.serviceCompleted);
    const incidentCounts = Object.fromEntries(['contaminationObserved','overflowOutsideBin','damagedMaintenanceIssue']
      .map(field => [field, reports.filter(row => row[field]).length]));
    const knownWeekly = row => Number.isInteger(row.weeklyFrequency) && row.weeklyFrequency >= 0 ? row.weeklyFrequency : 0;
    const calendarConfig = {...config, reportingThrough: status.exportCheckedAt || null};
    const review = ops.attentionRows(bins, allReports, from, to, calendarConfig, now);
    const fullness = ops.fullness(reports, now, config.timeZone);
    return {today, from, to, selection: {...selection, from, to},
      sources: {publishedAt: status.publishedAt || null, exportCheckedAt: status.exportCheckedAt || null,
        recordsUpdatedAt: status.recordsUpdatedAt || null, monitoringStartDate: config.monitoringStartDate,
        graceHoursAfterServiceDay: config.graceHoursAfterServiceDay, timeZone: config.timeZone},
      bins, reports, allReports, completed,
      reportCount: reports.length, completedCount: completed.length, exceptionCount: reports.length - completed.length,
      incidentCounts, fullness, plannedWeekly: bins.reduce((sum, row) => sum + knownWeekly(row), 0),
      plannedByStream: group(bins, 'wasteStream', knownWeekly), plannedByLocation: group(bins, 'buildingLocation', knownWeekly),
      completedByStream: group(completed, 'wasteStream'), completedByLocation: group(completed, 'buildingLocation'),
      review};
  }
  return {build, group};
})();
if (typeof module !== 'undefined') module.exports = AssistantData;
