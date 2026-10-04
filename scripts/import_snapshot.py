"""Validate a sanitized Power Automate snapshot before replacing dashboard JSON."""
import json
import os
import re
from datetime import date, time
from pathlib import Path

FIELDS = 'responseId binId buildingLocation wasteStream containerTypeSize driverName collectionDate collectionTime fullnessLevel contaminationObserved serviceCompleted nonServiceReason overflowOutsideBin damagedMaintenanceIssue maintenanceDamageDetails additionalComments'.split()
FLAGS = ['contaminationObserved', 'serviceCompleted', 'overflowOutsideBin', 'damagedMaintenanceIssue']
BINS = {'BIN-001': ('University Union', 'Landfill', '3 Yard Dumpster'), 'BIN-002': ('Library', 'Recycling', '4 Yard Dumpster'), 'BIN-003': ('The WELL', 'Organics', '3 Yard Dumpster')}
EXCEPTION = 'Service exception reported; details retained internally.'
MAINTENANCE = 'Maintenance issue reported; details retained internally.'

def validate(records):
    if not isinstance(records, list) or not records:
        raise ValueError('Snapshot must contain records; empty snapshots require manual review.')
    seen = set()
    for index, row in enumerate(records):
        if not isinstance(row, dict) or set(row) != set(FIELDS):
            raise ValueError(f'Record {index}: schema mismatch')
        for field in FIELDS:
            expected = bool if field in FLAGS else int if field == 'fullnessLevel' else str
            if type(row[field]) is not expected:
                raise ValueError(f'Record {index}: invalid type for {field}')
        if not re.fullmatch(r'LIST-[1-9][0-9]*', row['responseId']) or row['responseId'] in seen:
            raise ValueError(f'Record {index}: invalid or duplicate response ID')
        seen.add(row['responseId'])
        if row['binId'] not in BINS or tuple(row[k] for k in ['buildingLocation','wasteStream','containerTypeSize']) != BINS[row['binId']]:
            raise ValueError(f'Record {index}: bin metadata mismatch')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', row['collectionDate']) or not re.fullmatch(r'\d{2}:\d{2}', row['collectionTime']):
            raise ValueError(f'Record {index}: invalid date/time format')
        date.fromisoformat(row['collectionDate'])
        time.fromisoformat(row['collectionTime'])
        if not 0 <= row['fullnessLevel'] <= 100:
            raise ValueError(f'Record {index}: fullness outside 0–100')
        if row['driverName'] != 'Driver withheld' or row['additionalComments'] != '':
            raise ValueError(f'Record {index}: unapproved public text')
        if row['nonServiceReason'] != ('' if row['serviceCompleted'] else EXCEPTION):
            raise ValueError(f'Record {index}: inconsistent service reason')
        if row['maintenanceDamageDetails'] != (MAINTENANCE if row['damagedMaintenanceIssue'] else ''):
            raise ValueError(f'Record {index}: inconsistent maintenance details')
    return sorted(records, key=lambda r: int(r['responseId'].split('-')[1]))

def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    if event.get('action') != 'collection-snapshot':
        raise ValueError('Unexpected dispatch event')
    records = validate(event.get('client_payload', {}).get('records'))
    # Do not permit accidental partial reads to remove existing exported records.
    destination = Path('data/records.json')
    old = json.loads(destination.read_text(encoding='utf-8-sig'))
    previous = {r['responseId'] for r in old if r['responseId'].startswith('LIST-')}
    if not previous.issubset({r['responseId'] for r in records}):
        raise ValueError('Snapshot would remove List records; manual review required.')
    destination.write_text(json.dumps(records, indent=2)+'\n', encoding='utf-8')
    print(f'Validated {len(records)} sanitized records.')

if __name__ == '__main__':
    main()
