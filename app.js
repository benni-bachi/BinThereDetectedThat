'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = n => n.toLocaleString('en-US', {maximumFractionDigits: 1});
  const fields = 'responseId binId buildingLocation wasteStream containerTypeSize driverName collectionDate collectionTime fullnessLevel contaminationObserved serviceCompleted nonServiceReason overflowOutsideBin damagedMaintenanceIssue maintenanceDamageDetails additionalComments'.split(' ');
  const views = {
    overview: ['Campus operations', 'Pickup demand, service history, and collection conditions.'],
    calendar: ['Service calendar', 'Plan recurring service for each physical bin.'],
    missed: ['Missed pickups', 'Review possible misses and reported service exceptions.'],
    fullness: ['Fullness insights', 'Understand reported capacity by bin and over time.'],
    explorer: ['Data explorer', 'Search, filter, and inspect collection activity.'],
    bins: ['Bin QR directory', 'Find and download labels for registered bins.']
  };
  const labels = {scheduled: 'Scheduled', planned: 'Planned', today: 'Scheduled today', grace: 'Within grace',
    completed: 'Completed', exception: 'Reported exception', 'possible-missed': 'Possible missed', 'awaiting-update': 'Awaiting update'};
  const state = {view: 'overview', records: [], bins: [], service: null, config: null, status: null,
    loaded: false, loading: false, selectedDay: '', week: '', pages: {}, calendarRows: [], explorerRows: []};
  const pageSize = 25;
  function dateLabel(value, options = {}) {
    return new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC', ...options})
      .format(new Date(`${value}T00:00:00Z`));
  }
  function timestamp(value) {
    const instant = typeof value === 'number' ? value : Date.parse(value || '');
    if (!Number.isFinite(instant)) return 'Not available';
    return new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeStyle: 'short', timeZone: state.config.timeZone})
      .format(new Date(instant)) + ' Pacific';
  }
  const today = () => Operations.campusDate(new Date(), state.config?.timeZone || 'America/Los_Angeles');
  const calendarConfig = () => ({...state.config, reportingThrough: state.status?.exportCheckedAt || null});
  const badge = status => `<span class="badge ${status}">${safe(labels[status] || status)}</span>`;
  const stream = value => `<span class="stream-tag ${['Landfill','Recycling','Organics'].includes(value) ? value.toLowerCase() : ''}">${safe(value)}</span>`;
  const empty = (columns, message) => `<tr><td colspan="${columns}"><p class="empty">${safe(message)}</p></td></tr>`;
  function metrics(id, items) {
    $(id).innerHTML = items.map(([label, value, note]) => `<article class="metric"><h3 class="metric-label">${safe(label)}</h3><div class="metric-value">${safe(value)}</div><p class="metric-note">${safe(note)}</p></article>`).join('');
  }
  function bars(id, pairs, suffix = '', maxValue = null) {
    const max = maxValue ?? Math.max(1, ...pairs.map(p => p[1]));
    $(id).innerHTML = pairs.length ? pairs.map(([label, value]) => `<div class="bar-row"><div class="bar-label"><span>${safe(label)}</span><strong>${number(value)}${suffix}</strong></div><div class="bar-track" aria-hidden="true"><div class="bar-fill ${['Landfill','Recycling','Organics'].includes(label) ? label.toLowerCase() : ''}" style="width:${Math.min(100, value / max * 100)}%"></div></div></div>`).join('') : '<p class="empty">No matching records.</p>';
  }
  function chart(id, pairs, {percent = false, weekdays = false, description = ''} = {}) {
    if (!pairs.length) { $(id).innerHTML = '<p class="empty">No reports match this selection.</p>'; return; }
    const max = percent ? 100 : Math.max(1, ...pairs.map(p => p[1]));
    const width = Math.max(600, pairs.length * 76), left = 36, top = 25, plot = 145, height = 220;
    const step = (width - left - 18) / pairs.length;
    const ticks = [...new Set([0, Math.ceil(max / 2), max])];
    const grid = ticks.map(n => `<line x1="${left}" y1="${top + plot - n / max * plot}" x2="${width - 18}" y2="${top + plot - n / max * plot}" stroke="#dfe6df"/><text x="${left - 8}" y="${top + plot - n / max * plot + 4}" text-anchor="end">${number(n)}${percent ? '%' : ''}</text>`).join('');
    const marks = pairs.map(([key, value], i) => {
      const label = weekdays ? key : dateLabel(key, {year: undefined});
      const x = left + step * (i + .2), y = top + plot - value / max * plot;
      return `<g><title>${safe(label)}: ${number(value)}${percent ? '%' : ''}</title><rect x="${x}" y="${y}" width="${step * .6}" height="${value / max * plot}" rx="3" fill="#154734"/><text x="${x + step * .3}" y="${y - 6}" text-anchor="middle">${number(value)}${percent ? '%' : ''}</text><text x="${x + step * .3}" y="${top + plot + 22}" text-anchor="middle">${safe(label)}</text></g>`;
    }).join('');
    $(id).innerHTML = `<svg role="img" aria-label="${safe(description)}" viewBox="0 0 ${width} ${height}" style="min-width:${Math.min(width, 1000)}px">${grid}${marks}</svg><details><summary>View chart data</summary><table><thead><tr><th scope="col">${weekdays ? 'Day' : 'Date'}</th><th scope="col">${percent ? 'Average fullness' : 'Pickups'}</th></tr></thead><tbody>${pairs.map(([key, value]) => `<tr><td>${safe(weekdays ? key : dateLabel(key))}</td><td>${number(value)}${percent ? '%' : ''}</td></tr>`).join('')}</tbody></table></details>`;
  }
  function matches(row) {
    return (!$('filter-location').value || row.buildingLocation === $('filter-location').value)
      && (!$('filter-stream').value || row.wasteStream === $('filter-stream').value)
      && (!$('filter-bin').value || row.binId === $('filter-bin').value);
  }
  function dateRange() {
    const from = $('date-from').value, to = $('date-to').value;
    return {from, to, valid: !from || !to || from <= to};
  }
  function selectedReports() {
    const {from, to, valid} = dateRange();
    return valid ? state.records.filter(r => matches(r) && (!from || r.collectionDate >= from) && (!to || r.collectionDate <= to)) : [];
  }
  function setOptions(id, values, allLabel) {
    const select = $(id), previous = select.value;
    select.replaceChildren(new Option(allLabel, ''));
    values.forEach(value => select.add(new Option(value, value)));
    select.value = values.includes(previous) ? previous : '';
  }
  function populateFilters() {
    const all = [...state.bins, ...state.records];
    setOptions('filter-location', [...new Set(all.map(r => r.buildingLocation))].sort(), 'All locations');
    populateBins();
  }
  function populateBins() {
    const all = [...state.bins, ...state.records].filter(r => (!$('filter-location').value || r.buildingLocation === $('filter-location').value)
      && (!$('filter-stream').value || r.wasteStream === $('filter-stream').value));
    setOptions('filter-bin', [...new Set(all.map(r => r.binId))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})), 'All bins');
  }
  function resetPages() { state.pages = {}; }
  function pageRows(rows, key) {
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(pages, Math.max(1, state.pages[key] || 1));
    state.pages[key] = page;
    return rows.slice((page - 1) * pageSize, page * pageSize);
  }
  function pager(key, total) {
    const page = state.pages[key] || 1, count = Math.max(1, Math.ceil(total / pageSize));
    $(key + '-pager').innerHTML = `<span>${number(total)} ${total === 1 ? 'row' : 'rows'} · Page ${page} of ${count}</span><button type="button" data-page="${page - 1}" data-key="${key}" ${page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" data-page="${page + 1}" data-key="${key}" ${page >= count ? 'disabled' : ''}>Next</button>`;
  }
  function details(row) {
    const content = [['Response ID', row.responseId], ['Driver', row.driverName], ['Container', row.containerTypeSize],
      ['Non-service reason', row.nonServiceReason || 'None'], ['Maintenance / damage', row.maintenanceDamageDetails || 'None'],
      ['Additional comments', row.additionalComments || 'None']];
    return `<details class="row-details"><summary>View<span class="sr-only"> record ${safe(row.responseId)}</span></summary><dl>${content.map(([label, value]) => `<dt>${label}</dt><dd>${safe(value)}</dd>`).join('')}</dl></details>`;
  }
  function renderOverview() {
    const bins = state.bins.filter(matches);
    const selectedSources = new Set(bins.map(b => `${b.sourceRow}|${b.wasteStream}`));
    const schedules = state.service.services.filter(s => selectedSources.has(`${s.sourceRow}|${s.wasteStream}`));
    // A selected bin contributes one container, not the quantity of its whole service group.
    const weighted = schedules.map(s => ({...s, quantity: bins.filter(b => b.sourceRow === s.sourceRow && b.wasteStream === s.wasteStream).length}));
    const completed = selectedReports().filter(r => r.serviceCompleted && r.collectionDate <= today());
    const knownWeekly = weighted.reduce((n, r) => n + OverviewMath.weeklyPickups(r), 0);
    metrics('overview-metrics', [['Containers', number(bins.length), 'In the service inventory'],
      ['Service locations', number(new Set(bins.map(b => b.buildingLocation)).size), 'In this selection'],
      ['Known weekly pickups', number(knownWeekly), 'Containers × stated weekly frequency'],
      ['Completed reports', number(completed.length), 'In the selected report dates']]);
    $('overview-count').textContent = `${number(bins.length)} workbook containers`;
    const planned = $('analysis-source').value === 'planned', rows = planned ? weighted : completed;
    const weight = planned ? OverviewMath.weeklyPickups : () => 1;
    $('trend-title').textContent = planned ? 'Weekly service pattern' : 'Pickup trends over time';
    $('trend-subtitle').textContent = planned ? 'Planned container pickups by weekday.' : 'Completed reports by week starting Monday.';
    $('stream-unit').textContent = planned ? 'Known planned pickups per week' : 'Completed pickups in the date selection';
    $('location-unit').textContent = planned ? 'Top 15 by known planned weekly pickups' : 'Top 15 by completed reports';
    chart('overview-trend', planned ? OverviewMath.weekdays(rows) : OverviewMath.weeklyHistory(rows), {weekdays: planned,
      description: planned ? 'Planned weekly pickups by service day' : 'Completed pickup reports by week'});
    bars('stream-chart', OverviewMath.group(rows, 'wasteStream', weight));
    bars('location-chart', OverviewMath.group(rows, 'buildingLocation', weight).filter(p => p[1] > 0).slice(0, 15));
  }
  function renderCalendar() {
    const end = Operations.addDays(state.week, 6);
    const events = Operations.calendarEvents(state.bins.filter(matches), state.records, state.week, end, calendarConfig());
    $('week-label').textContent = `${dateLabel(state.week)} – ${dateLabel(end)}`;
    $('calendar-date').value = state.selectedDay;
    $('calendar-week').innerHTML = Array.from({length: 7}, (_, i) => {
      const date = Operations.addDays(state.week, i), rows = events.filter(r => r.date === date);
      const completed = rows.filter(r => r.status === 'completed').length;
      const attention = rows.filter(r => ['exception', 'possible-missed'].includes(r.status)).length;
      const dayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i];
      return `<button type="button" class="day-button" data-date="${date}" aria-pressed="${date === state.selectedDay}" aria-label="${safe(dateLabel(date))}, ${rows.length} scheduled bins${date === today() ? ', today' : ''}"><span class="day-label">${dayName}<span class="day-number">${Number(date.slice(-2))}</span></span><span class="day-total">${rows.length}</span><span class="day-caption">scheduled</span><span class="day-flags">${completed ? `${completed} completed` : date === today() ? 'Today' : ''}${attention ? `<br>${attention} to review` : ''}</span></button>`;
    }).join('');
    state.calendarRows = events.filter(r => r.date === state.selectedDay);
    $('calendar-day-title').textContent = dateLabel(state.selectedDay, {weekday: 'long'});
    $('calendar-day-count').textContent = `${number(state.calendarRows.length)} scheduled physical bins`;
    $('calendar-export').disabled = !state.calendarRows.length;
    $('calendar-body').innerHTML = pageRows(state.calendarRows, 'calendar').map(row => `<tr><td><strong>${safe(row.binId)}</strong><span class="secondary">Container ${row.containerNumber}</span></td><td>${safe(row.buildingLocation)}</td><td>${stream(row.wasteStream)}</td><td>${safe(row.serviceDays.join(' / '))}</td><td>${badge(row.status)}${row.reports.length ? `<span class="secondary">${row.reports.length} report${row.reports.length === 1 ? '' : 's'}</span>` : ''}</td></tr>`).join('') || empty(5, 'No scheduled bins match this day and these filters.');
    pager('calendar', state.calendarRows.length);
  }
  function renderMissed() {
    const range = dateRange(), start = range.from || state.config.monitoringStartDate, end = range.to || today();
    $('monitoring-policy').textContent = `Monitoring from ${dateLabel(state.config.monitoringStartDate)}. Possible-miss flags appear ${state.config.graceHoursAfterServiceDay} hours after the service day ends in Sacramento, once a validated export covers that deadline.`;
    let review = {events: [], rows: []};
    if (range.valid) {
      try { review = Operations.attentionRows(state.bins.filter(matches), state.records.filter(matches), start, end, calendarConfig()); }
      catch (error) { $('missed-body').innerHTML = empty(5, error.message); $('missed-metrics').replaceChildren(); $('missed-pager').replaceChildren(); return; }
    }
    const possible = review.rows.filter(r => r.status === 'possible-missed').length;
    const exceptions = review.rows.filter(r => r.status === 'exception').length;
    const pending = review.events.filter(r => ['grace','today','awaiting-update'].includes(r.status)).length;
    metrics('missed-metrics', [['Possible missed', number(possible), 'No report after the grace deadline'], ['Reported exceptions', number(exceptions), 'Service reported not completed'],
      ['Awaiting reports', number(pending), 'Within grace or awaiting an update'], ['Completed scheduled', number(review.events.filter(r => r.status === 'completed').length), 'Matched by bin and service date']]);
    const type = $('attention-filter').value;
    const rows = review.rows.filter(r => type === 'all' || r.status === type);
    $('missed-body').innerHTML = pageRows(rows, 'missed').map(row => `<tr><td>${safe(dateLabel(row.date))}</td><td><strong>${safe(row.binId)}</strong><span class="secondary">${safe(row.buildingLocation)}</span></td><td>${stream(row.wasteStream)}</td><td>${badge(row.status)}</td><td>${row.status === 'exception' ? details(row.reports.at(-1)) : `<span class="secondary">No collection report by ${safe(timestamp(row.deadline))}.</span>`}</td></tr>`).join('') || empty(5, range.valid ? `No ${type === 'exception' ? 'reported exceptions' : 'pickup review items'} match this selection.${pending ? ` ${pending} scheduled pickups are still awaiting reports or an update.` : ''}` : 'Choose a valid date range.');
    pager('missed', rows.length);
  }
  function renderFullness() {
    const result = Operations.fullness(selectedReports(), new Date(), state.config.timeZone);
    metrics('fullness-metrics', [['Average fullness', result.average === null ? '—' : `${number(result.average)}%`, 'Reported before collection'],
      ['Near-capacity reports', number(result.nearCapacity), '76–100% full'], ['Low-fullness reports', number(result.low), '0–25% full'],
      ['Reporting bins', number(result.bins.length), 'With measurements in this selection']]);
    chart('fullness-trend', result.daily, {percent: true, description: 'Average reported fullness by date'});
    bars('fullness-distribution', ['Low (0–25%)','Moderate (26–50%)','High (51–75%)','Near capacity (76–100%)'].map((label, i) => [label, result.distribution[i]]));
    const percent = count => result.rows.length ? Math.round(count / result.rows.length * 100) : 0;
    $('fullness-takeaways').innerHTML = result.rows.length ? `<p><strong>${percent(result.low)}%</strong>of reports show a bin at 25% fullness or below.</p><p><strong>${percent(result.nearCapacity)}%</strong>of reports show a bin at 76% fullness or above.</p><p>${number(result.rows.length)} reported measurements across ${result.daily.length} reporting dates. Latest measurements describe the last report, not current live capacity.</p>` : '<p class="empty">Add or select collection reports to see fullness patterns.</p>';
    $('fullness-body').innerHTML = pageRows(result.bins, 'fullness').map(row => `<tr><td><strong>${safe(row.binId)}</strong><span class="secondary">${safe(row.buildingLocation)}</span></td><td>${safe(dateLabel(row.collectionDate))}</td><td><strong class="${row.fullnessLevel >= 76 ? 'fullness-high' : ''}">${row.fullnessLevel}%</strong><div class="fullness-meter" aria-hidden="true"><span style="width:${row.fullnessLevel}%"></span></div></td><td>${number(row.average)}%</td><td>${row.change === null ? '—' : `${row.change > 0 ? '+' : ''}${row.change} pp`}</td><td>${row.reportCount}</td></tr>`).join('') || empty(6, 'No fullness measurements match this selection.');
    pager('fullness', result.bins.length);
  }
  function explorerRows() {
    const term = $('record-search').value.trim().toLocaleLowerCase();
    const service = $('service-filter').value, incident = $('incident-filter').value;
    const rows = selectedReports().filter(r => (!term || [r.responseId, r.binId, r.buildingLocation, r.wasteStream, r.containerTypeSize].some(v => String(v).toLocaleLowerCase().includes(term)))
      && (service === 'all' || (service === 'completed' ? r.serviceCompleted : !r.serviceCompleted))
      && (incident === 'all' || r[incident] === true));
    const byDate = (a, b) => Operations.chronological(a, b);
    const sorts = {newest: (a, b) => byDate(b, a), oldest: byDate,
      'fullness-high': (a, b) => b.fullnessLevel - a.fullnessLevel || byDate(b, a),
      'fullness-low': (a, b) => a.fullnessLevel - b.fullnessLevel || byDate(b, a),
      bin: (a, b) => a.binId.localeCompare(b.binId, undefined, {numeric: true}) || byDate(b, a)};
    return rows.sort(sorts[$('record-sort').value]);
  }
  function renderExplorer() {
    const rows = explorerRows(); state.explorerRows = rows;
    const count = field => rows.filter(r => r[field] === true).length;
    metrics('explorer-metrics', [['Collection reports', number(rows.length), 'Includes completed and not serviced'],
      ['Average fullness', rows.length ? `${number(rows.reduce((n, r) => n + r.fullnessLevel, 0) / rows.length)}%` : '—', 'In these filtered reports'],
      ['Contamination events', number(count('contaminationObserved')), rows.length ? `${Math.round(count('contaminationObserved') / rows.length * 100)}% of reports` : 'No reports selected'],
      ['Service exceptions', number(rows.filter(r => !r.serviceCompleted).length), 'Reports marked not serviced']]);
    $('explorer-count').textContent = `${number(rows.length)} of ${number(state.records.length)} reports · ${number(count('overflowOutsideBin'))} overflow · ${number(count('damagedMaintenanceIssue'))} maintenance / damage`;
    $('export-records').disabled = !rows.length;
    $('explorer-body').innerHTML = pageRows(rows, 'explorer').map(row => {
      const conditions = [['contaminationObserved','Contamination'], ['overflowOutsideBin','Overflow'], ['damagedMaintenanceIssue','Maintenance']]
        .filter(([field]) => row[field]).map(([,label]) => `<span class="badge issue">${label}</span>`).join('');
      return `<tr><td>${safe(dateLabel(row.collectionDate))}<span class="secondary">${safe(row.collectionTime)}</span></td><td><strong>${safe(row.binId)}</strong><span class="secondary">${safe(row.buildingLocation)}</span></td><td>${stream(row.wasteStream)}</td><td><strong>${row.fullnessLevel}%</strong></td><td>${badge(row.serviceCompleted ? 'completed' : 'exception')}${conditions}</td><td>${details(row)}</td></tr>`;
    }).join('') || empty(6, 'No collection reports match these filters. Adjust the search or reset filters.');
    pager('explorer', rows.length);
  }
  function renderBins() {
    const rows = state.bins.filter(b => b.qrStatus === 'ready' && matches(b));
    $('bin-count').textContent = `${number(rows.length)} workbook labels in this selection`;
    $('bins-body').innerHTML = pageRows(rows, 'bins').map(b => `<tr><td><strong>${safe(b.binId)}</strong><span class="secondary">Container ${b.containerNumber}</span></td><td>${safe(b.buildingLocation)}</td><td>${stream(b.wasteStream)}</td><td>${safe(b.containerTypeSize)}</td><td>${Operations.hasSchedule(b) ? safe(b.serviceDays.join(' / ')) : '—'}</td><td><a class="text-link" href="generated/qr/${safe(b.binId)}.png" download>Download PNG</a></td></tr>`).join('') || empty(6, 'No QR labels match these filters.');
    pager('bins', rows.length);
  }
  const renderers = {overview: renderOverview, calendar: renderCalendar, missed: renderMissed, fullness: renderFullness, explorer: renderExplorer, bins: renderBins};
  function render() {
    if (!state.loaded) return;
    const range = dateRange();
    $('range-error').hidden = range.valid || ['calendar','bins'].includes(state.view) || (state.view === 'overview' && $('analysis-source').value === 'planned');
    renderers[state.view]();
  }
  function switchView(focus = false) {
    const key = location.hash.slice(1), view = Object.hasOwn(views, key) ? key : 'overview';
    state.view = view;
    for (const name of Object.keys(views)) $('view-' + name).hidden = name !== view;
    document.querySelectorAll('[data-view]').forEach(link => {
      if (link.dataset.view === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    $('view-title').textContent = views[view][0]; $('view-description').textContent = views[view][1];
    document.title = `${views[view][0]} | Bin There, Detected That`;
    const reportDates = ['missed','fullness','explorer'].includes(view) || (view === 'overview' && $('analysis-source').value === 'recorded');
    document.querySelectorAll('.report-date').forEach(div => div.hidden = !reportDates);
    render();
    if (focus) { $('view-title').tabIndex = -1; $('view-title').focus({preventScroll: true}); }
  }
  function download(filename, rows, columns) {
    const blob = new Blob([Operations.csv(rows, columns)], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function validateRecords(records) {
    if (!Array.isArray(records)) throw new Error('Invalid collection data.');
    const ids = new Set();
    for (const r of records) {
      if (!r || !fields.every(f => Object.hasOwn(r, f)) || typeof r.responseId !== 'string' || ids.has(r.responseId)
          || !Operations.validDate(r.collectionDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.collectionTime)
          || !Number.isInteger(r.fullnessLevel) || r.fullnessLevel < 0 || r.fullnessLevel > 100
          || !['serviceCompleted','contaminationObserved','overflowOutsideBin','damagedMaintenanceIssue'].every(f => typeof r[f] === 'boolean')
          || !['binId','buildingLocation','wasteStream','containerTypeSize'].every(f => typeof r[f] === 'string')) throw new Error('Invalid collection data.');
      ids.add(r.responseId);
    }
  }
  async function refresh() {
    if (state.loading) return;
    state.loading = true; $('refresh-data').disabled = true; $('refresh-data').textContent = 'Refreshing…';
    $('refresh-status').textContent = 'Checking the latest published data…'; $('load-error').hidden = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const stamp = Date.now();
      const read = async path => {
        const response = await fetch(`${path}?refresh=${stamp}`, {cache: 'no-store', signal: controller.signal});
        if (!response.ok) throw new Error(`Unable to load ${path}`);
        return response.text();
      };
      const raw = await Promise.all(['data/records.json','data/service-overview.json','data/operations-config.json','data/dashboard-status.json'].map(read));
      const [records, service, config, status] = raw.map(JSON.parse);
      validateRecords(records); Operations.validateConfig(config);
      if (!Array.isArray(service.services) || !Array.isArray(service.bins)) throw new Error('Invalid service data.');
      const bins = Operations.hydrateBins(service);
      if (new Set(bins.map(b => b.binId)).size !== bins.length || status.recordCount !== records.length) throw new Error('Snapshot files are still updating.');
      if (crypto.subtle && status.recordsSha256) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw[0])))].map(b => b.toString(16).padStart(2, '0')).join('');
        if (hash !== status.recordsSha256) throw new Error('Snapshot files are still updating.');
      }
      state.records = records; state.service = service; state.bins = bins; state.config = config; state.status = status;
      if (!state.loaded) {
        $('date-from').value = Operations.addDays(today(), -29); $('date-to').value = today();
        state.selectedDay = today(); state.week = Operations.monday(today());
      }
      state.loaded = true;
      populateFilters(); resetPages(); switchView();
      const checked = new Date().toISOString();
      $('published-at').textContent = timestamp(status.publishedAt);
      $('records-updated-at').textContent = timestamp(status.recordsUpdatedAt);
      $('export-checked-at').textContent = timestamp(status.exportCheckedAt);
      $('checked-at').textContent = timestamp(checked);
      $('refresh-status').textContent = `Checked ${new Intl.DateTimeFormat('en-US', {timeStyle: 'short', timeZone: config.timeZone}).format(new Date())} Pacific · ${number(records.length)} collection reports`;
    } catch (error) {
      $('load-error').hidden = false;
      $('load-error').textContent = state.loaded ? 'The refresh could not finish. Your last loaded data is still displayed. Please try again.' : 'Dashboard data could not be loaded. Please try Refresh data again.';
      $('refresh-status').textContent = state.loaded ? 'Refresh unsuccessful · showing the last loaded snapshot' : 'Data unavailable';
      console.error(error);
    } finally {
      clearTimeout(timer); state.loading = false; $('refresh-data').disabled = false; $('refresh-data').textContent = 'Refresh data';
    }
  }
  $('refresh-data').addEventListener('click', refresh);
  window.addEventListener('hashchange', () => switchView(true));
  for (const id of ['filter-location','filter-stream','filter-bin','date-from','date-to']) $(id).addEventListener('change', () => {
    if (id === 'filter-location' || id === 'filter-stream') populateBins(); resetPages(); render();
  });
  $('analysis-source').addEventListener('change', () => { resetPages(); switchView(); });
  for (const id of ['attention-filter','service-filter','incident-filter','record-sort']) $(id).addEventListener('change', () => { resetPages(); render(); });
  $('record-search').addEventListener('input', () => { state.pages.explorer = 1; render(); });
  $('reset-filters').addEventListener('click', () => {
    ['filter-location','filter-stream','filter-bin','record-search'].forEach(id => $(id).value = '');
    ['service-filter','incident-filter','attention-filter'].forEach(id => $(id).value = 'all'); $('record-sort').value = 'newest';
    if (state.loaded) { $('date-from').value = Operations.addDays(today(), -29); $('date-to').value = today(); populateFilters(); }
    resetPages(); render();
  });
  function moveWeek(days) { if (!state.loaded) return; state.week = Operations.addDays(state.week, days); state.selectedDay = state.week; state.pages.calendar = 1; renderCalendar(); }
  $('previous-week').addEventListener('click', () => moveWeek(-7)); $('next-week').addEventListener('click', () => moveWeek(7));
  $('calendar-today').addEventListener('click', () => { if (!state.loaded) return; state.selectedDay = today(); state.week = Operations.monday(today()); state.pages.calendar = 1; renderCalendar(); });
  $('calendar-date').addEventListener('change', () => { if (!state.loaded || !Operations.validDate($('calendar-date').value)) return; state.selectedDay = $('calendar-date').value; state.week = Operations.monday(state.selectedDay); state.pages.calendar = 1; renderCalendar(); });
  $('calendar-week').addEventListener('click', event => { const button = event.target.closest('[data-date]'); if (!button) return; state.selectedDay = button.dataset.date; state.pages.calendar = 1; renderCalendar(); $('calendar-week').querySelector(`[data-date="${state.selectedDay}"]`)?.focus({preventScroll: true}); });
  document.querySelectorAll('.pagination').forEach(container => container.addEventListener('click', event => {
    const button = event.target.closest('[data-page]'); if (!button || button.disabled) return;
    const label = button.textContent; state.pages[button.dataset.key] = Number(button.dataset.page); render();
    [...container.querySelectorAll('button')].find(b => b.textContent === label && !b.disabled)?.focus({preventScroll: true});
  }));
  $('export-records').addEventListener('click', () => download(`collection-records-${today()}.csv`, state.explorerRows, fields));
  $('calendar-export').addEventListener('click', () => download(`scheduled-bins-${state.selectedDay}.csv`, state.calendarRows.map(r => ({BinID: r.binId, BuildingLocation: r.buildingLocation, WasteStream: r.wasteStream,
    ServiceDate: r.date, ServiceDays: r.serviceDays.join(' / '), Status: labels[r.status]})), ['BinID','BuildingLocation','WasteStream','ServiceDate','ServiceDays','Status']));
  $('explorer-count').setAttribute('role', 'status');
  switchView(); refresh();
})();
