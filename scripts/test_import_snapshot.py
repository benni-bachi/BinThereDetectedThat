"""Checks for the public snapshot boundary; no network or real records needed."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from import_snapshot import FIELDS, main, validate


def record(number=1):
    row = dict.fromkeys(FIELDS, '')
    row.update(responseId=f'LIST-{number}', binId='BIN-001',
               buildingLocation='University Union', wasteStream='Landfill',
               containerTypeSize='3 Yard Dumpster', driverName='Driver withheld',
               collectionDate='2026-10-01', collectionTime='07:30', fullnessLevel=75,
               contaminationObserved=False, serviceCompleted=True,
               overflowOutsideBin=False, damagedMaintenanceIssue=False)
    return row


class SnapshotTests(unittest.TestCase):
    def test_valid_snapshot_sorted(self):
        self.assertEqual(validate([record(2), record(1)]), [record(1), record(2)])

    def test_rejects_private_text_and_invalid_values(self):
        changes = [('driverName', 'Private name'), ('additionalComments', 'Private text'),
                   ('fullnessLevel', '75'), ('fullnessLevel', True), ('fullnessLevel', 101),
                   ('collectionDate', '2026-02-30'), ('collectionTime', '25:00'),
                   ('serviceCompleted', False), ('damagedMaintenanceIssue', True),
                   ('binId', 'BIN-999'), ('buildingLocation', 'Other location')]
        for field, value in changes:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                row = record()
                row[field] = value
                validate([row])

    def test_rejects_schema_and_duplicate_ids(self):
        for records in ([], [record(), record()], [dict(record(), email='private')]):
            with self.assertRaises(ValueError):
                validate(records)

    def test_failed_partial_snapshot_leaves_file_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            previous_cwd = Path.cwd()
            try:
                os.chdir(folder)
                Path('data').mkdir()
                destination = Path('data/records.json')
                original = json.dumps([record(1), record(2)])
                destination.write_text(original)
                event = Path('event.json').resolve()
                event.write_text(json.dumps({'action': 'collection-snapshot',
                                             'client_payload': {'records': [record(1)]}}))
                with patch.dict(os.environ, GITHUB_EVENT_PATH=str(event)):
                    with self.assertRaises(ValueError):
                        main()
                self.assertEqual(destination.read_text(), original)
            finally:
                os.chdir(previous_cwd)


if __name__ == '__main__':
    unittest.main()
