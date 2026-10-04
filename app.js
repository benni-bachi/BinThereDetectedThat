'use strict';
const $ = id => document.getElementById(id);
const controls = ['date-from', 'date-to', 'building', 'stream', 'bin'];
let records = [];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isIncident = (row, field) => row[field] === true;
const groupCount = (rows, field) => rows.reduce((counts, row) => { counts[row[field]] = (counts[row[field]] || 0) + 1; return counts; }, {});
function filteredRecords() {
  return records.filter(row => (!$('date-from').value || row.collectionDate >= $('date-from').value)
    && (!$('date-to').value || row.collectionDate <= $('date-to').value)
    && (!$('building').value || row.buildingLocation === $('building').value)
    && (!$('stream').value || row.wasteStream === $('stream').value)
    && (!$('bin').value || row.binId === $('bin').value));
}
function renderBars(id, rows, field, categories) {
  const counts = groupCount(rows, field);
  const maximum = Math.max(1, ...Object.values(counts));
  $(id).innerHTML = categories.map(label => {
    const count = counts[label] || 0;
    const color = field === 'wasteStream' ? label.toLowerCase() : '';
    return `<div class="bar-row"><div class="bar-label"><span>${escapeHTML(label)}</span><strong>${count}</strong></div><div class="bar-track" aria-hidden="true"><div class="bar-fill ${color}" style="width:${count / maximum * 100}%"></div></div></div>`;
  }).join('');
}
function render() {
  const rows = filteredRecords();
  const total = rows.length;
  const count = field => rows.filter(row => isIncident(row, field)).length;
  const contamination = count('contaminationObserved');
  const exceptions = rows.filter(row => row.serviceCompleted === false).length;
  const average = total ? Math.round(rows.reduce((sum, row) => sum + row.fullnessLevel, 0) / total) : null;
  const metrics = [
    ['Total Collections', total, 'Collection records in this view'],
    ['Average Fullness', average === null ? '—' : `${average}%`, 'Reported before collection'],
    ['Contamination Rate', total ? `${Math.round(contamination / total * 100)}%` : '—', `${contamination} contamination ${contamination === 1 ? 'event' : 'events'}`],
    ['Service Exceptions', exceptions, 'Service not completed'],
    ['Overflow Incidents', count('overflowOutsideBin'), 'Waste reported outside bin'],
    ['Maintenance / Damage', count('damagedMaintenanceIssue'), 'Reported maintenance incidents']
  ];
  $('metrics').innerHTML = metrics.map(([label, value, note]) => `<article class="metric"><span class="metric-accent" aria-hidden="true"></span><h3 class="metric-label">${label}</h3><div class="metric-value">${value}</div><p class="metric-note">${note}</p></article>`).join('');
  $('result-count').textContent = `${total} of ${records.length} records · ${total ? 'Filtered overview' : 'No matching collections'}`;
  renderBars('stream-chart', rows, 'wasteStream', ['Landfill', 'Recycling', 'Organics']);
  renderBars('building-chart', rows, 'buildingLocation', [...new Set(records.map(row => row.buildingLocation))].sort());
  const bands = [[0,25,'Low'],[26,50,'Moderate'],[51,75,'High'],[76,100,'Near capacity']];
  $('fullness-chart').innerHTML = bands.map(([min,max,label]) => {
    const n = rows.filter(row => row.fullnessLevel >= min && row.fullnessLevel <= max).length;
    return `<div><div class="dist-value">${n}</div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${total ? n / total * 100 : 0}%"></div></div><div class="dist-label">${label}</div><div class="dist-range">${min}–${max}% full</div></div>`;
  }).join('');
  $('activity-count').textContent = `${total} RECORDS`;
  const sorted = [...rows].sort((a,b) => `${b.collectionDate}T${b.collectionTime}`.localeCompare(`${a.collectionDate}T${a.collectionTime}`));
  $('activity-body').innerHTML = sorted.length ? sorted.map(row => {
    const date = new Date(`${row.collectionDate}T${row.collectionTime}`);
    const tags = [`<span class="badge ${row.serviceCompleted ? '' : 'exception'}">${row.serviceCompleted ? 'Completed' : 'Not serviced'}</span>`];
    for (const [field,label] of [['contaminationObserved','Contamination'],['overflowOutsideBin','Overflow'],['damagedMaintenanceIssue','Maintenance']]) {
      if (isIncident(row,field)) tags.push(`<span class="badge issue">${label}</span>`);
    }
    const details = [['Response ID',row.responseId],['Driver',row.driverName],['Container',row.containerTypeSize],['Non-service reason',row.nonServiceReason || 'None'],['Maintenance / damage details',row.maintenanceDamageDetails || 'None'],['Additional comments',row.additionalComments || 'None']];
    return `<tr><td>${escapeHTML(date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}))}<span class="secondary">${escapeHTML(date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}))}</span></td><td><strong>${escapeHTML(row.binId)}</strong><span class="secondary">${escapeHTML(row.buildingLocation)}</span></td><td><span class="stream-tag ${row.wasteStream.toLowerCase()}">${escapeHTML(row.wasteStream)}</span></td><td class="fullness-cell">${row.fullnessLevel}%</td><td>${tags.join('')}</td><td><details><summary>View<span class="sr-only"> record ${escapeHTML(row.responseId)}</span></summary><dl>${details.map(([label,value]) => `<dt>${label}</dt><dd>${escapeHTML(value)}</dd>`).join('')}</dl></details></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No collections match these filters. Adjust your selections or reset filters.</td></tr>';
}
async function init() {
  try {
    const response = await fetch('data/records.json');
    if (!response.ok) throw new Error('Records could not be loaded.');
    records = await response.json();
    if (!Array.isArray(records) || records.some(row => !Number.isInteger(row.fullnessLevel) || row.fullnessLevel < 0 || row.fullnessLevel > 100 || !row.collectionDate || !row.collectionTime)) throw new Error('Invalid collection data.');
    for (const [id,field] of [['building','buildingLocation'],['stream','wasteStream'],['bin','binId']]) {
      [...new Set(records.map(row => row[field]))].sort().forEach(value => $(id).add(new Option(value,value)));
    }
    controls.forEach(id => $(id).addEventListener('change', render));
    $('reset').addEventListener('click', () => { controls.forEach(id => $(id).value = ''); render(); });
    render();
  } catch (error) {
    records = [];
    render();
    $('error').hidden = false;
    $('error').textContent = 'Collection data could not be loaded. Run this page through a local static preview and ensure data/records.json is available.';
    $('result-count').textContent = 'Data unavailable';
    console.error(error);
  }
}
init();
