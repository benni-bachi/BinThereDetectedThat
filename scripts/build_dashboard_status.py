"""Write public deployment metadata, without private List connection details."""
import hashlib
import json
import subprocess
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def changed_at(relative):
    result = subprocess.run(['git', 'log', '-1', '--format=%cI', '--', relative], cwd=ROOT,
                            capture_output=True, text=True, check=True)
    return result.stdout.strip() or None


def main():
    records = ROOT / 'data/records.json'
    now = datetime.now(timezone.utc).isoformat()
    records_hash = hashlib.sha256(records.read_bytes()).hexdigest()
    export_checked_at = None
    if os.environ.get('GITHUB_EVENT_NAME') == 'repository_dispatch':
        export_checked_at = now
    else:
        # A code-only deployment must not pretend it just read the private List.
        try:
            if os.environ.get('GITHUB_ACTIONS') == 'true':
                with urllib.request.urlopen('https://benni-bachi.github.io/BinThereDetectedThat/data/dashboard-status.json', timeout=5) as response:
                    previous = json.load(response)
            else:
                previous = json.loads((ROOT / 'data/dashboard-status.json').read_text())
            if previous.get('recordsSha256') == records_hash:
                export_checked_at = previous.get('exportCheckedAt')
        except (OSError, ValueError):
            pass
    status = dict(publishedAt=now, exportCheckedAt=export_checked_at,
                  recordsUpdatedAt=changed_at('data/records.json'),
                  schedulesUpdatedAt=changed_at('data/service-overview.json'),
                  recordCount=len(json.loads(records.read_text(encoding='utf-8-sig'))),
                  recordsSha256=records_hash)
    (ROOT / 'data/dashboard-status.json').write_text(json.dumps(status, indent=2) + '\n', encoding='utf-8')
    print('Wrote public dashboard publication status.')


if __name__ == '__main__':
    main()
