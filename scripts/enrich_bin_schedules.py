"""Attach existing imported service days to their exact physical-bin group."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def enrich(data):
    groups = {}
    for service in data['services']:
        key = (service['sourceRow'], service['wasteStream'])
        if key in groups:
            raise ValueError('Duplicate source service group')
        groups[key] = service
    for bin_row in data['bins']:
        source = groups[(bin_row['sourceRow'], bin_row['wasteStream'])]
        if source['buildingLocation'] != bin_row['buildingLocation']:
            raise ValueError('Bin and service locations disagree')
        bin_row['weeklyFrequency'] = source['weeklyFrequency']
        bin_row['serviceDays'] = list(source['serviceDays'])
    return data


if __name__ == '__main__':
    target = ROOT / 'data/service-overview.json'
    data = enrich(json.loads(target.read_text(encoding='utf-8')))
    target.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    print(f"Attached exact service schedules to {len(data['bins'])} existing bin IDs.")
