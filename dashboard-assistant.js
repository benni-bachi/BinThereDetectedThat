'use strict';
// A local question interpreter backed by calculated facts, without external AI services.
const DashboardAssistant = (() => {
  const ops = typeof module !== 'undefined' ? require('./operations-metrics.js') : Operations;
  const facts = typeof module !== 'undefined' ? require('./assistant-data.js') : AssistantData;
  const normalize = value => String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const n = value => Number(value).toLocaleString('en-US', {maximumFractionDigits: 1});
  const reportsLabel = value => `${n(value)} ${value === 1 ? 'report' : 'reports'}`;
  const date = value => new Intl.DateTimeFormat('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
    .format(new Date(`${value}T00:00:00Z`));
  const days = {SUN:'Sunday',MON:'Monday',TUE:'Tuesday',WED:'Wednesday',THU:'Thursday',FRI:'Friday',SAT:'Saturday'};
  const sources = {schedule:'Imported service schedules', reports:'Published collection reports', review:'Service schedules + published collection reports'};
  function intent(text) {
    if (/\b(how.*(work|refresh|sync)|where.*data|data.*(source|live)|refresh.*data|data.*refresh)\b/.test(text)) return 'help';
    if (/\b(need.? attention|priorit\w*|check first|service first|focus|recommend\w*|insights?|summary|summari\w*|overview|doing|stand out)\b/.test(text)) return 'summary';
    if (/\b(miss\w*|overdue|not (collected|serviced)|exceptions?|blocked|not completed|unreported|failed)\b/.test(text)) return 'missed';
    if (/\b(contamin\w*|overflow\w*|maintenance|damag\w*|broken|odor|odour|sanitation|incidents?|issues?)\b/.test(text)) return 'incidents';
    if (/\b(full\w*|capacity|underused|empty|emptiest|low usage|change since|nearly full)\b/.test(text)) return 'fullness';
    if (/\b(trends?|over time|week to week)\b/.test(text)) return 'trends';
    if (/\b(busiest|most|least|rank|top|compare|comparison)\b/.test(text)) return 'ranking';
    if (/\b(schedule\w*|when|due|planned|service days?|frequency|how often|tomorrow)\b/.test(text)) return 'schedule';
    if (/\b(container|size|bin details|metadata)\b/.test(text)) return 'bin';
    if (/\b(collections?|pickups?|reports?|records?|completed|activity|collected|serviced)\b/.test(text)) return 'collections';
    return null;
  }
  function readRange(text, today, selected, kind) {
    const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
    if (iso.length > 2 || iso.some(value => !ops.validDate(value))) throw new Error('Use a valid date or range, such as 2026-11-17 or 2026-11-01 to 2026-11-17.');
    if (iso.length) return {from:iso[0],to:iso[1] || (/\b(since|from)\b/.test(text) ? today : iso[0]),explicit:true};
    if (/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d|\b\d{1,4}\/\d{1,2}\/\d{1,4}\b/.test(text)) throw new Error('Please write dates as YYYY-MM-DD so I can use the exact service date.');
    if (/\btomorrow\b/.test(text)) return {from:ops.addDays(today,1),to:ops.addDays(today,1),explicit:true};
    if (/\byesterday\b/.test(text)) return {from:ops.addDays(today,-1),to:ops.addDays(today,-1),explicit:true};
    if (/\btoday\b/.test(text)) return {from:today,to:today,explicit:true};
    if (/\b(this|last|next) week\b/.test(text)) {
      const offset = /\blast week\b/.test(text) ? -7 : /\bnext week\b/.test(text) ? 7 : 0;
      const from = ops.addDays(ops.monday(today),offset);
      return {from,to:ops.addDays(from,6),explicit:true};
    }
    const previous = text.match(/\b(?:last|past) (\d{1,3}) days?\b/);
    if (previous) {
      const count = Number(previous[1]);
      if (count < 1 || count > 366) throw new Error('Choose between 1 and 366 days.');
      return {from:ops.addDays(today,1-count),to:today,explicit:true};
    }
    const weekday = text.match(/\b(?:next |on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (weekday && kind === 'schedule') {
      const wanted = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(weekday[1]);
      let offset = (wanted - new Date(`${today}T00:00Z`).getUTCDay() + 7) % 7;
      if (weekday[0].startsWith('next ') && offset === 0) offset = 7;
      const day = ops.addDays(today,offset);
      return {from:day,to:day,explicit:true};
    }
    if (kind === 'schedule') return {from:today,to:ops.addDays(today,6),explicit:false};
    return {from:selected.from,to:selected.to,explicit:false};
  }
  function parse(prompt, source, base = {}, previous = null, now = new Date()) {
    const text = String(prompt).trim().toLocaleLowerCase();
    const today = ops.campusDate(now,source.config.timeZone);
    const binMatches = [...text.matchAll(/\bbin[\s-]*0*(\d{1,5})\b/g)].map(m => `BIN-${m[1].padStart(3,'0')}`);
    const uniqueBins = [...new Set(binMatches)];
    if (uniqueBins.length > 1) throw new Error('Please ask about one BinID at a time, or use a location or waste stream to compare a group.');
    const locations = [...new Set([...source.bins,...source.records].map(row => row.buildingLocation))];
    const words = ` ${normalize(prompt)} `;
    const locationMatches = locations.filter(value => {
      const key = normalize(value);
      return key.length >= 3 && words.includes(` ${key} `);
    }).sort((a,b) => b.length-a.length);
    const location = locationMatches[0];
    if (locationMatches.some(value => normalize(value) !== normalize(location) && !normalize(location).includes(normalize(value)))) {
      throw new Error('Please ask about one location at a time. To compare locations, ask which locations have the most pickups.');
    }
    const streamMatches = [['Landfill', /\b(landfill|trash|garbage)\b/],['Recycling', /\b(recycling|recycle)\b/],['Organics', /\b(organics?|compost)\b/]]
      .filter(([,regex]) => regex.test(text)).map(([value]) => value);
    const namedAt = text.match(/\bat\s+(?!least\b)([a-z][a-z0-9 &.'/-]*?)(?=\?|$|\b(?:today|tomorrow|yesterday|this week|last week|next week|on|from|since)\b)/);
    if (namedAt && !location && !uniqueBins.length && !streamMatches.length && !/^(?:capacity|fullness|the data|this selection|my selection)\b/.test(namedAt[1])) throw new Error('I could not match that location. Use a building name from the dashboard location filter or a BinID.');
    let kind = intent(text);
    const subjectOnly = uniqueBins.length || location || streamMatches.length || /\b(what about|how about|and for|same|instead|which ones)\b/.test(text);
    if (!kind && subjectOnly) kind = previous?.kind || 'summary';
    if (!kind) return {kind:null};
    const followUp = previous && /\b(what about|how about|and for|same|instead|those|these|that bin|that location|them|which ones)\b|^and\b/.test(text);
    const selection = {...(followUp ? previous.selection : base)};
    if (uniqueBins.length) {selection.bin=uniqueBins[0];selection.location='';selection.stream='';selection.exactLocation=false;}
    if (location) {selection.location=location;selection.bin=uniqueBins[0] || '';selection.exactLocation=false;}
    if (streamMatches.length) {selection.stream=streamMatches.length === 1 ? streamMatches[0] : '';if (!uniqueBins.length) selection.bin='';}
    const range = readRange(text,today,selection,kind);
    if (followUp && !intent(text) && !uniqueBins.length && !location && !streamMatches.length && !range.explicit && !/\b(those|these|that bin|that location|them|which ones|same)\b/.test(text)) throw new Error('I could not match the subject of that follow-up. Use a location from the filter, a BinID, a waste stream, or a date.');
    if (followUp && kind === 'schedule' && !range.explicit) {range.from=previous.selection.from;range.to=previous.selection.to;}
    Object.assign(selection,{from:range.from,to:range.to});
    if (/\b(all time|all (?:reports|records|history)|entire history)\b/.test(text)) {
      selection.from=source.records.map(row=>row.collectionDate).filter(value=>value<=today).sort()[0] || today;
      selection.to=today;
    }
    if (selection.bin && ![...source.bins,...source.records].some(row => row.binId === selection.bin)) throw new Error(`I couldn't find ${selection.bin} in the published dashboard data. Check the BinID and try again.`);
    return {kind,selection,text,rangeExplicit:range.explicit};
  }
  const evidence = row => `${row.binId} · ${row.buildingLocation} · ${date(row.collectionDate)} · ${row.responseId}`;
  function response(title, paragraphs, items = [], source = sources.reports, link = '#explorer') {
    return {title,paragraphs,items,source,link};
  }
  function fullnessReply(data, text) {
    const result = data.fullness;
    if (!result.rows.length) return response('No fullness reports in this selection', ['I do not have reported measurements for this selection. Try a wider date range or another bin.'],[],sources.reports,'#fullness');
    const low = /\b(low|underused|empty|emptiest|least)\b/.test(text);
    const high = /\b(nearly|near|highest|fullest|over|above|capacity)\b/.test(text);
    const threshold = text.match(/\b(?:above|over|at least|below|under)\s+(\d{1,3})\s*%?/);
    if (threshold && Number(threshold[1]) > 100) return response('Fullness is measured from 0–100%', ['Choose a threshold between 0 and 100.'],[],sources.reports,'#fullness');
    let bins = [...result.bins];
    if (threshold) {
      const value = Number(threshold[1]);
      const minimum = /\b(?:above|over|at least)\b/.test(threshold[0]);
      bins = bins.filter(row => minimum ? (/at least/.test(threshold[0]) ? row.fullnessLevel >= value : row.fullnessLevel > value) : row.fullnessLevel < value);
    } else if (low) bins = bins.filter(row => row.fullnessLevel <= 25);
    else if (high && !/\b(fullest|highest)\b/.test(text)) bins = bins.filter(row => row.fullnessLevel >= 76);
    if (low) bins.sort((a,b) => a.fullnessLevel-b.fullnessLevel);
    const paragraphs = [`Average reported fullness is ${n(result.average)}% across ${reportsLabel(result.rows.length)} from ${n(result.bins.length)} ${result.bins.length === 1 ? 'bin' : 'bins'}.`,
      `${reportsLabel(result.low)} ${result.low === 1 ? 'was' : 'were'} at 25% or below; ${n(result.nearCapacity)} ${result.nearCapacity === 1 ? 'was' : 'were'} at 76% or above. Latest measurements describe the last report, not current capacity.`];
    if (!bins.length) paragraphs.push('No latest bin measurements meet that fullness condition.');
    const items = bins.slice(0,5).map(row => `${evidence(row)}: latest ${row.fullnessLevel}%; average ${n(row.average)}% across ${reportsLabel(row.reportCount)}${row.change === null ? '' : `; change ${row.change>0 ? '+' : ''}${row.change} percentage points`}.`);
    return response('Reported fullness',paragraphs,items,sources.reports,'#fullness');
  }
  function scheduleReply(data, source, now) {
    const events = ops.calendarEvents(data.bins,source.records,data.from,data.to,{...source.config,reportingThrough:source.status?.exportCheckedAt || null},now);
    const paragraphs = [`${n(events.length)} planned bin pickups from ${date(data.from)} to ${date(data.to)}, across ${n(new Set(events.map(row => row.binId)).size)} distinct bins.`];
    const items = [];
    if (data.selection.bin) {
      const bin = data.bins[0];
      if (bin && ops.hasSchedule(bin)) paragraphs.push(`${bin.binId} at ${bin.buildingLocation} is scheduled on ${bin.serviceDays.map(day=>days[day]).join(', ')}.`);
      else paragraphs.push('There is no confirmed recurring calendar schedule for this BinID in the published inventory.');
    }
    else if (!data.bins.some(ops.hasSchedule)) paragraphs.push('There is no confirmed recurring calendar schedule in this selection. Choose an exact service location from the calendar filter to check its listed bins.');
    const grouped = facts.group(events,'date');
    grouped.sort((a,b)=>a.name.localeCompare(b.name)).slice(0,7).forEach(row=>items.push(`${date(row.name)}: ${n(row.count)} planned bin pickups.`));
    if (events.length <= 10) events.slice(0,5).forEach(row => items.push(`${row.binId} · ${row.buildingLocation} · ${row.wasteStream} · ${date(row.date)}.`));
    paragraphs.push('These are recurring planned services. The calendar shows matching collection reports and any review status.');
    return response('Scheduled service',paragraphs,items,sources.schedule,'#calendar');
  }
  function missedReply(data) {
    const rows = data.review.rows;
    const possible = rows.filter(row=>row.status==='possible-missed'), exceptions = rows.filter(row=>row.status==='exception');
    const waiting = data.review.events.filter(row=>['today','grace','awaiting-update'].includes(row.status)).length;
    return response('Pickup review',[
      `${n(possible.length)} possible-miss items and ${n(exceptions.length)} reported service exceptions in the monitoring period within this date selection. ${n(waiting)} scheduled pickups are within grace or awaiting an update.`,
      `Monitoring starts ${date(data.sources.monitoringStartDate)}. A possible miss requires ${data.sources.graceHoursAfterServiceDay} hours after the service day ends, plus a validated export covering that deadline. Review the missing report before confirming a missed service.`],
      rows.slice(0,5).map(row=>`${row.binId} · ${row.buildingLocation} · ${date(row.date)}: ${row.status==='exception' ? `service reported not completed (${row.reports.map(report=>report.responseId).join(', ')})` : 'no matching report after the grace deadline'}.`),sources.review,'#missed');
  }
  function incidentsReply(data,text) {
    if (/\b(odor|odour|sanitation|blocked)\b/.test(text)) return response('Detailed causes are not available',[
      'The public dashboard does not contain the private incident descriptions needed to identify odor, sanitation, or blocked-access causes. I can count service exceptions and the published contamination, overflow, and maintenance flags.'],[],sources.reports,'#explorer');
    const fields = [['contaminationObserved','contamination'],['overflowOutsideBin','overflow'],['damagedMaintenanceIssue','maintenance / damage']];
    const requested = fields.filter(([,label])=>label==='contamination' ? /contamin/.test(text) : label==='overflow' ? /overflow/.test(text) : /maintenance|damag|broken/.test(text));
    const chosen = requested.length ? requested : fields;
    const rows = data.reports.filter(row=>chosen.some(([field])=>row[field]));
    const paragraphs = chosen.map(([field,label])=>`${n(data.incidentCounts[field])} ${label} events across ${n(data.reportCount)} reports${data.reportCount ? ` (${n(data.incidentCounts[field]/data.reportCount*100)}%)` : ''}.`);
    if (!rows.length) paragraphs.push('No matching incident flags were reported in this selection.');
    let items=rows.slice(0,5).map(row=>`${evidence(row)}: ${fields.filter(([field])=>row[field]).map(([,label])=>label).join(', ')}.`);
    if (/\b(most|top|rank|highest|compare)\b/.test(text)) {
      const field=/\bstreams?\b/.test(text) ? 'wasteStream' : 'buildingLocation';
      items=facts.group(rows,field).slice(0,5).map(group=>`${group.name}: ${reportsLabel(group.count)} with matching incident flags (${rows.filter(row=>row[field]===group.name).slice(0,5).map(row=>row.responseId).join(', ')}).`);
    }
    return response('Reported incidents',paragraphs,items);
  }
  function rankingsReply(data,text) {
    const planned = /\b(planned|schedule\w*|weekly|demand|busiest)\b/.test(text);
    const byStream = /\b(stream|recycling|organics|landfill)\b/.test(text) && !/\b(location|building)\b/.test(text);
    let rows = planned ? (byStream ? data.plannedByStream : data.plannedByLocation) : (byStream ? data.completedByStream : data.completedByLocation);
    rows = rows.filter(row=>row.count>0);
    if (/\bleast\b/.test(text)) rows = [...rows].sort((a,b)=>a.count-b.count);
    return response(planned ? 'Planned weekly pickup demand' : 'Completed pickup ranking',[
      planned ? `The selected inventory has ${n(data.plannedWeekly)} known planned bin pickups per week.` : `${n(data.completedCount)} completed collection reports are in this date selection.`,
      rows.length ? `Showing ${Math.min(rows.length,5)} ${byStream ? 'waste streams' : 'locations'}${planned ? ' by known weekly frequency' : ' by completed report count'}.` : 'There are no matching positive totals to rank.'],
      rows.slice(0,5).map(row=>`${row.name}: ${n(row.count)} ${planned ? 'planned pickups per week' : 'completed reports'}.`),planned ? sources.schedule : sources.reports,'#overview');
  }
  function summaryReply(data) {
    const paragraphs = [`${n(data.reportCount)} collection reports: ${n(data.completedCount)} completed and ${n(data.exceptionCount)} not serviced. ${n(data.bins.length)} inventory bins have ${n(data.plannedWeekly)} known planned pickups per week.`];
    if (data.fullness.average !== null) paragraphs.push(`Average reported fullness is ${n(data.fullness.average)}%.`);
    const items = [];
    if (data.review.rows.length) items.push(`Review ${n(data.review.rows.length)} possible-miss or reported-exception items in Missed pickups. These require confirmation by staff.`);
    const count = data.reports.filter(row=>row.contaminationObserved || row.overflowOutsideBin || row.damagedMaintenanceIssue).length;
    if (count) items.push(`Check ${n(count)} reports with incident flags: ${n(data.incidentCounts.contaminationObserved)} contamination, ${n(data.incidentCounts.overflowOutsideBin)} overflow, and ${n(data.incidentCounts.damagedMaintenanceIssue)} maintenance / damage events. One report may have multiple flags.`);
    const high = data.fullness.bins.filter(row=>row.fullnessLevel>=76);
    if (high.length) items.push(`Review the latest near-capacity measurements: ${high.slice(0,3).map(row=>`${row.binId} ${row.fullnessLevel}% (${date(row.collectionDate)}, ${row.responseId})`).join('; ')}. Check a newer report before making a route change.`);
    if (!data.reportCount) paragraphs.push('No reported collections match these dates and filters. Planned schedules can still be reviewed.');
    if (!items.length && data.reportCount) items.push('No incident or pickup-review items stand out in this selection. Keep collecting reports to establish operational patterns.');
    paragraphs.push('Service-frequency changes need repeated observations; these reports alone do not establish an optimal pickup schedule.');
    return response('Your selection at a glance',paragraphs,items,sources.review,'#explorer');
  }
  function answer(prompt, source, base = {}, previous = null, now = new Date()) {
    const raw = String(prompt || '').trim();
    if (!raw || raw.length>500) return response('Ask a short dashboard question',['Enter a question with 1–500 characters.']);
    if (!source) return response('Dashboard data is not ready',['Use Refresh data to load the published dashboard, then ask again.']);
    if (/\b(driver names?|emails?|photographs?|photos?|credentials?|access tokens?)\b/i.test(raw)) return response('Those details are not in the assistant data',[
      'I can use the published bin metadata, dates, fullness measurements, and incident flags. Private names, photos, and credentials are not available here.']);
    if (/\b(delete|erase|edit|submit|mark .*(?:complete|serviced)|change .*record)\b/i.test(raw)) return response('I can help you review the data',[
      'This assistant only reads the published dashboard. Submit collection reports through New Collection; it cannot change records or service schedules.']);
    try {
      const query = parse(raw,source,base,previous,now);
      if (!query.kind) return response('Ask about campus waste operations',[
        'I can calculate summaries, schedules, pickup-review items, fullness, incident counts, and location or stream rankings. Try “Which bins are nearly full?” or “What is scheduled tomorrow at ALPINE?”'],[],sources.review,'#overview');
      if (query.kind==='help') return response('How the dashboard gets its data',[
        'A bin QR opens Microsoft Forms. Power Automate writes the submitted report to the private Microsoft List. A separate export publishes sanitized reports through GitHub, usually every 15 minutes plus deployment time.',
        'The workbook import supplies recurring bin schedules. Refresh data loads the latest published files. It does not initiate a private List read.'],[], 'Dashboard data flow', '#overview');
      const data = facts.build(source,query.selection,now);
      const text = query.text;
      let result;
      if (query.kind==='summary') result=summaryReply(data);
      else if (query.kind==='schedule') result=scheduleReply(data,source,now);
      else if (query.kind==='missed') result=missedReply(data);
      else if (query.kind==='fullness') result=fullnessReply(data,text);
      else if (query.kind==='incidents') result=incidentsReply(data,text);
      else if (query.kind==='ranking') result=rankingsReply(data,text);
      else if (query.kind==='trends') {
        const grouped=facts.group(data.completed.map(row=>({...row,week:ops.monday(row.collectionDate)})),'week').sort((a,b)=>a.name.localeCompare(b.name));
        const counts=new Map(grouped.map(row=>[row.name,row.count]));
        const weeks=[];
        if (grouped.length) for (let week=grouped[0].name;week<=grouped.at(-1).name;week=ops.addDays(week,7)) weeks.push({name:week,count:counts.get(week)||0});
        result=response('Reported pickup trends',[
          `${n(data.completedCount)} completed collection reports across ${n(weeks.filter(row=>row.count>0).length)} reporting weeks in this selection.`,
          'Weeks start Monday. The first and last weeks may be partial. These are submitted reports; a week with no reports does not establish that service stopped.',
          weeks.length<3 || data.completedCount<10 ? 'There are too few reported collections to establish a reliable operational trend or forecast.' : 'Compare repeated reports over several complete weeks before changing service frequencies.'],
          weeks.slice(-8).map(row=>`Week of ${date(row.name)}: ${n(row.count)} completed ${row.count===1 ? 'report' : 'reports'}.`),sources.reports,'#overview');
      }
      else if (query.kind==='bin') result=response('Bin metadata',[
        `${n(data.bins.length)} inventory bins match this selection. Each BinID refers to a distinct container.`],
        data.bins.slice(0,5).map(bin=>`${bin.binId} · ${bin.buildingLocation} · ${bin.wasteStream} · ${bin.containerTypeSize || 'Size not listed'}${ops.hasSchedule(bin) ? ` · ${bin.serviceDays.map(day=>days[day]).join(', ')}` : ''}.`),sources.schedule,'#bins');
      else result=response('Reported collection activity',[
        `${n(data.reportCount)} reports are in this selection: ${n(data.completedCount)} completed and ${n(data.exceptionCount)} not serviced.`,
        data.reportCount ? 'Most recent matching reports are listed below.' : 'Try a wider date range or another bin to find collection reports.'],
        data.reports.slice(0,5).map(row=>`${evidence(row)}: ${row.serviceCompleted ? 'completed' : 'not serviced'}, ${row.fullnessLevel}% full.`));
      result.scope=[query.selection.bin,query.selection.location,query.selection.stream].filter(Boolean).join(' · ') || 'All campus';
      result.period=`${date(data.from)} – ${date(data.to)}`;
      result.publishedAt=data.sources.publishedAt;
      result.context={kind:query.kind,selection:query.selection};
      return result;
    } catch (error) { return response('Please refine the question',[error.message],[],sources.review,'#overview'); }
  }
  return {answer,parse};
})();
if (typeof module !== 'undefined') module.exports = DashboardAssistant;
