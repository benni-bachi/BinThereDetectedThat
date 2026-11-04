"""Publication must never imply a private List read during a code-only deploy."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_dashboard_status as publication


class PublicationCoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.records = b'[]\n'
        (self.root / 'data/records.json').write_bytes(self.records)
        self.prior_check = '2026-11-03T20:00:00+00:00'
        self.previous = {'recordsSha256': hashlib.sha256(self.records).hexdigest(),
                         'exportCheckedAt': self.prior_check}
        self.path = self.root / 'data/dashboard-status.json'

    def publish(self, event='push'):
        with patch.object(publication, 'ROOT', self.root), \
             patch.object(publication, 'changed_at', return_value='2026-11-01T00:00:00+00:00'), \
             patch.dict('os.environ', {'GITHUB_EVENT_NAME': event, 'GITHUB_ACTIONS': 'false'}):
            publication.main()
        return json.loads(self.path.read_text())

    def test_code_only_deploy_preserves_prior_coverage(self):
        self.path.write_text(json.dumps(self.previous))
        result = self.publish()
        self.assertEqual(result['exportCheckedAt'], self.prior_check)
        self.assertNotEqual(result['publishedAt'], result['exportCheckedAt'])
        self.assertEqual(result['recordCount'], 0)

    def test_changed_records_invalidate_prior_coverage(self):
        self.path.write_text(json.dumps(self.previous))
        (self.root / 'data/records.json').write_text('[{}]')
        self.assertIsNone(self.publish()['exportCheckedAt'])

    def test_first_code_deploy_has_no_coverage(self):
        self.assertIsNone(self.publish()['exportCheckedAt'])

    def test_successful_dispatch_establishes_coverage_without_changes(self):
        self.path.write_text(json.dumps(self.previous))
        result = self.publish('repository_dispatch')
        self.assertEqual(result['exportCheckedAt'], result['publishedAt'])
        self.assertNotEqual(result['exportCheckedAt'], self.prior_check)
        self.assertEqual(result['recordsSha256'], self.previous['recordsSha256'])

    def test_unavailable_public_status_cannot_claim_freshness(self):
        with patch.object(publication, 'ROOT', self.root), \
             patch.object(publication, 'changed_at', return_value=None), \
             patch.dict('os.environ', {'GITHUB_EVENT_NAME': 'push', 'GITHUB_ACTIONS': 'true'}), \
             patch.object(publication.urllib.request, 'urlopen', side_effect=OSError('Unavailable')):
            publication.main()
        self.assertIsNone(json.loads(self.path.read_text())['exportCheckedAt'])


if __name__ == '__main__':
    unittest.main()
