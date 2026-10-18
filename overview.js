'use strict';
(() => {
  const el = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => value.toLocaleString('en-US');
  const dateLabel = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  let serviceData, records;
  function bars(id, pairs) {
    const max = Math.max(1,...pairs.map(p => p[1]));
    el(id).innerHTML = pairs.length ? pairs.map(([label,count]) => `<div class="bar-row"><div class="bar-label"><span>${safe(label)}</span><strong>${number(count)}</strong></div><div class="bar-track" aria-hidden="true"><div class="bar-fill ${['Landfill','Recycling','Organics'].includes(label) ? label.toLowerCase() : ''}" style="width:${count/max*100}%"></div></div></div>`).join('') : '<p class="empty">No matching pickups.</p>';
  }
  function trend(pairs, planned) {
    if (!pairs.length) { el('pickup-trend').innerHTML = '<p class="empty">No completed collection records match these filters.</p>'; return; }
    const max = Math.max(1,...pairs.map(p=>p[1]));
    const width = Math.max(640,pairs.length*75), height = 225, left = 40, top = 20, plotHeight = 155;
    const step = (width-left-20)/pairs.length;
    const ticks = [0,Math.ceil(max/2),max].filter((x,i,a)=>a.indexOf(x)===i);
    const grid = ticks.map(n=>`<line x1="${left}" y1="${top+plotHeight-n/max*plotHeight}" x2="${width-20}" y2="${top+plotHeight-n/max*plotHeight}" stroke="#dee5df"/><text x="${left-8}" y="${top+plotHeight-n/max*plotHeight+4}" text-anchor="end">${n}</text>`).join('');
    const marks = pairs.map(([key,n],i)=>{ const label = planned ? key : dateLabel(key); const x=left+step*i+step*.2, bar=step*.6, y=top+plotHeight-n/max*plotHeight;
      return `<g><title>${safe(label)}: ${n} pickups</title><rect x="${x}" y="${y}" width="${bar}" height="${n/max*plotHeight}" rx="3" fill="#154734"/><text x="${x+bar/2}" y="${y-6}" text-anchor="middle">${n}</text><text x="${x+bar/2}" y="${top+plotHeight+24}" text-anchor="middle">${safe(planned ? label : label.replace(/, \d{4}$/,''))}</text></g>`; }).join('');
    el('pickup-trend').innerHTML = `<svg role="img" aria-label="${planned ? 'Planned pickups by weekday' : 'Completed pickups by week starting Monday'}" viewBox="0 0 ${width} ${height}" style="min-width:${Math.min(width,900)}px">${grid}${marks}</svg><details><summary>View chart data</summary><table><thead><tr><th>${planned ? 'Day' : 'Week of'}</th><th>Pickups</th></tr></thead><tbody>${pairs.map(([k,n])=>`<tr><td>${safe(planned?k:dateLabel(k))}</td><td>${n}</td></tr>`).join('')}</tbody></table></details>`;
  }
  function render() {
    const planned = el('view-source').value === 'planned';
    const loc=el('overview-location').value, stream=el('overview-stream').value;
    const matches = row => (!loc || row.buildingLocation===loc) && (!stream || row.wasteStream===stream);
    const schedules=serviceData.services.filter(matches);
    const attempts=records.filter(matches).filter(r=>(!el('overview-from').value || r.collectionDate>=el('overview-from').value) && (!el('overview-to').value || r.collectionDate<=el('overview-to').value));
    const completed=attempts.filter(r=>r.serviceCompleted===true);
    const rows=planned?schedules:completed;
    const weight=planned?OverviewMath.weeklyPickups:()=>1;
    const total=rows.reduce((n,r)=>n+weight(r),0);
    const metrics=planned ? [
      ['Known weekly pickups',number(total),'Containers × stated weekly frequency'],
      ['Containers',number(OverviewMath.sum(schedules,'quantity')),'In the workbook selection'],
      ['Service locations',new Set(rows.map(r=>r.buildingLocation)).size,'With listed containers']
    ] : [
      ['Completed pickups',number(total),'Reports marked service completed'],
      ['Collection reports',number(attempts.length),'Includes service exceptions'],
      ['Locations reported',new Set(rows.map(r=>r.buildingLocation)).size,'With completed pickups'],
      ['Service exceptions',attempts.length-completed.length,'Reports marked not completed']
    ];
    el('overview-metrics').innerHTML=metrics.map(([title,value,note])=>`<article class="metric"><h3 class="metric-label">${title}</h3><div class="metric-value">${value}</div><p class="metric-note">${note}</p></article>`).join('');
    el('overview-heading').textContent=planned?'Planned service snapshot':'Recorded pickup snapshot';
    el('overview-count').textContent=planned?`${schedules.length} service entries`:`${attempts.length} collection reports`;
    el('source-context').textContent=planned?'Source: Sacramento State Service Overview, UPDATED sheet. Weekly totals use stated service frequencies.':'Source: sanitized Microsoft List snapshot. Completed pickups only in charts; test and future-dated reports retain their source dates. Refresh to load the latest published snapshot.';
    el('trend-heading').textContent=planned?'Weekly service pattern':'Pickup trends over time';
    el('trend-description').textContent=planned?'Planned container pickups by weekday.':'Completed collection reports by week starting Monday. Zero-record weeks are shown within the report range.';
    el('stream-unit').textContent=planned?'Known planned container pickups per week':'Completed pickups in the date selection';
    el('location-unit').textContent=planned?'Top 15 by known planned weekly pickups':'Top 15 by completed pickups';
    bars('overview-stream-chart',OverviewMath.group(rows,'wasteStream',weight));
    const byLocation=OverviewMath.group(rows,'buildingLocation',weight).filter(p=>p[1]>0);
    bars('overview-location-chart',byLocation.slice(0,15));
    const pairs=planned?OverviewMath.weekdays(rows):OverviewMath.weeklyHistory(rows);
    trend(pairs,planned);
    if(planned) {
      const peak=[...pairs].sort((a,b)=>b[1]-a[1])[0];
      el('trend-takeaway').textContent=peak && peak[1] ? `${peak[0]} has the busiest known schedule (${peak[1]} pickups).` : '';
    } else {
      const peak=[...pairs].sort((a,b)=>b[1]-a[1])[0];
      el('trend-takeaway').textContent=peak?`Peak reported week: ${dateLabel(peak[0])} (${peak[1]} completed pickups). ${pairs.length<4?'The limited reporting history does not establish a sustained trend.':''}`:'No completed pickups in this selection.';
    }
    const bins=serviceData.bins.filter(matches).filter(b=>b.qrStatus==='ready');
    el('qr-summary').textContent=`${bins.length} QR labels available for this selection.`;
    el('bin-directory-body').innerHTML=bins.map(b=>`<tr><td><strong>${safe(b.binId)}</strong></td><td>${safe(b.buildingLocation)}<span class="secondary">Container ${b.containerNumber}</span></td><td>${safe(b.wasteStream)}</td><td>${safe(b.containerTypeSize)}</td><td><a class="text-link" href="generated/qr/${safe(b.binId)}.png" download>Download PNG</a></td></tr>`).join('') || '<tr><td colspan="5">No QR labels match this location and stream.</td></tr>';
  }
  function sourceChanged() {
    const planned=el('view-source').value==='planned';
    el('overview-from').disabled=planned; el('overview-to').disabled=planned;
    const rows=planned?serviceData.services:records;
    const previous=el('overview-location').value;
    el('overview-location').replaceChildren(new Option('All locations',''));
    [...new Set(rows.map(r=>r.buildingLocation))].sort().forEach(v=>el('overview-location').add(new Option(v,v)));
    el('overview-location').value=[...el('overview-location').options].some(o=>o.value===previous)?previous:'';
    render();
  }
  async function init() {
    try {
      const read=async path=>{const response=await fetch(path,{cache:'no-cache'}); if(!response.ok)throw new Error(`Unable to read ${path}`); return response.json();};
      [serviceData,records]=await Promise.all([read('data/service-overview.json'),read('data/records.json')]);
      if(!Array.isArray(serviceData.services)||!Array.isArray(serviceData.bins)||!Array.isArray(records))throw new Error('Invalid overview data');
      el('view-source').addEventListener('change',sourceChanged);
      ['overview-location','overview-stream','overview-from','overview-to'].forEach(id=>el(id).addEventListener('change',render));
      el('overview-reset').addEventListener('click',()=>{['overview-location','overview-stream','overview-from','overview-to'].forEach(id=>el(id).value=''); render();});
      sourceChanged();
    } catch(error) {
      el('overview-error').hidden=false; el('overview-error').textContent='Overview data could not be loaded. Refresh the page or try again after the next deployment.';
      el('overview-count').textContent='Data unavailable'; console.error(error);
    }
  }
  init();
})();
