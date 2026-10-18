"""Import UPDATED service schedules; never turn scheduled service into actual pickups.

Usage: python scripts/import_service_overview.py path/to/workbook.xlsx
Requires openpyxl for read-only XLSX extraction. Account numbers are not exported.
"""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
FIELDS = ['BinID', 'BuildingLocation', 'WasteStream', 'ContainerTypeSize', 'FormsURL']
PARAMS = ['r2d455617ff384368bbbe8db40143fec2', 'r9761ab84a4c24f9bbc2d1be73ebefb24',
          'rb34d2a0b27ac4267a378f0d6f3559c8f', 'ra0f751a713f74430a130cc8d382f52b9']


def days_for(value):
    text = str(value or '').strip()
    if text in ('', '-'):
        return []
    if text == 'MON-FRI':
        return DAYS[:5]
    if text == 'MON-SAT':
        return DAYS[:6]
    parts = text.split('/')
    if any(part not in DAYS for part in parts) or len(set(parts)) != len(parts):
        raise ValueError(f'Unrecognized service days: {text}')
    return parts


def container_size(value):
    match = re.fullmatch(r'(\d+)(YD|GAL)', str(value or '').strip())
    if not match:
        return None
    number, unit = match.groups()
    return f'{number} Yard Dumpster' if unit == 'YD' else f'{number} Gallon Container'


def form_url(template, row):
    url = urlsplit(template)
    query = dict(parse_qsl(url.query))
    for key, field in zip(PARAMS, FIELDS[1:2] + FIELDS[:1] + FIELDS[2:4]):
        query[key] = row[field]
    # Microsoft Forms prefill preserves '+' literally; encode spaces as %20.
    return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query, quote_via=quote), ''))


def build(source, prior=None):
    import openpyxl
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
    sheet = workbook['UPDATED']
    values = list(sheet.iter_rows(values_only=True))
    if values[4][:6] != ('ACCT #', 'LOCATION', 'QTY', 'SIZE', 'FREQ', 'SVC DAY'):
        raise ValueError('UPDATED header changed; review the import mapping.')
    def service_key(location, stream):
        return hashlib.sha256(f'{location}|{stream}'.encode()).hexdigest()[:16]
    prior_ids = {f"{service_key(b['buildingLocation'], b['wasteStream'])}-{b['containerNumber']}": b['binId']
                 for b in (prior or {}).get('bins', [])}
    next_id = max([3] + [int(x.split('-')[1]) for x in prior_ids.values()]) + 1
    services, bins = [], []
    seen = set()
    for index, values_row in enumerate(values[5:], 6):
        if values_row[0] == 'TOTAL CONTAINERS':
            expected = [values_row[c] for c in [2, 6, 10]]
            break
        account, location = values_row[:2]
        if not location:
            continue
        for stream, offset in [('Landfill', 2), ('Recycling', 6), ('Organics', 10)]:
            qty, size, freq, days = values_row[offset:offset + 4]
            if qty in (None, '-', 0):
                continue
            if type(qty) is not int or qty < 1:
                raise ValueError(f'Invalid quantity at row {index}')
            key = service_key(location.strip(), stream)
            if key in seen:
                raise ValueError(f'Duplicate service at row {index}')
            seen.add(key)
            frequency = freq if type(freq) is int and 0 < freq <= 7 else None
            days = days_for(days)
            size_label = container_size(size)
            issues = []
            if not size_label:
                issues.append('Confirm each container size')
            if frequency is None:
                issues.append('Weekly frequency unspecified or qualified')
            if frequency and len(days) != frequency:
                issues.append('Service days do not match weekly frequency')
            service = dict(sourceRow=index, buildingLocation=location.strip(), wasteStream=stream,
                           quantity=qty, containerTypeSize=size_label, sourceSize=str(size or ''),
                           weeklyFrequency=frequency, sourceFrequency=str(freq or ''),
                           serviceDays=days, issues=issues)
            services.append(service)
            for ordinal in range(1, qty + 1):
                source_key = f'{key}-{ordinal}'
                bin_id = prior_ids.get(source_key)
                if not bin_id:
                    bin_id = f'BIN-{next_id:03}'
                    next_id += 1
                bins.append(dict(sourceKey=source_key, binId=bin_id,
                                 buildingLocation=location.strip(), wasteStream=stream,
                                 containerTypeSize=size_label, sourceSize=str(size or ''),
                                 containerNumber=ordinal, sourceRow=index,
                                 qrStatus='ready' if size_label else 'size confirmation needed'))
    else:
        raise ValueError('Missing source totals')
    actual = [sum(s['quantity'] for s in services if s['wasteStream'] == stream)
              for stream in ['Landfill', 'Recycling', 'Organics']]
    if actual != expected or len(bins) != sum(expected):
        raise ValueError(f'Container totals do not reconcile: {actual} versus {expected}')
    workbook.close()
    return dict(sourceFile=Path(source).name, sourceSheet='UPDATED',
                sourceSha256=hashlib.sha256(Path(source).read_bytes()).hexdigest(),
                description='Planned service levels; not historical collection events.',
                services=services, bins=bins)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    args = parser.parse_args()
    destination = ROOT / 'data/service-overview.json'
    prior = json.loads(destination.read_text()) if destination.exists() else None
    result = build(args.workbook, prior)
    link_path = ROOT / 'data/bin-links.csv'
    with link_path.open(encoding='utf-8-sig', newline='') as file:
        original = [row for row in csv.DictReader(file) if row['BinID'] in ['BIN-001', 'BIN-002', 'BIN-003']]
    if len(original) != 3:
        raise ValueError('Expected the three original pilot bin URLs')
    rows = [{field: row[field] for field in FIELDS} for row in original]
    for b in result['bins']:
        if b['qrStatus'] != 'ready':
            continue
        row = dict(BinID=b['binId'], BuildingLocation=b['buildingLocation'],
                   WasteStream=b['wasteStream'], ContainerTypeSize=b['containerTypeSize'])
        row['FormsURL'] = form_url(original[0]['FormsURL'], row)
        rows.append(row)
    if len({r['BinID'] for r in rows}) != len(rows):
        raise ValueError('Duplicate QR bin ID')
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    with link_path.open('w', encoding='utf-8', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Imported {len(result['services'])} services and {len(result['bins'])} containers.")
    print(f"QR-ready: {len(rows)} including 3 pilot bins; held: {sum(b['qrStatus'] != 'ready' for b in result['bins'])}.")


if __name__ == '__main__':
    main()
