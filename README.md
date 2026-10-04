# Bin There, Detected That

Sacramento State CSC 131 waste-operations dashboard, built with HTML, CSS, and vanilla JavaScript.

## Operational data flow

Unique bin QR → Microsoft Forms → existing Power Automate intake → Microsoft List → scheduled sanitized export → GitHub Actions → data/records.json → GitHub Pages.

The separate Power Automate flow **Bin There Dashboard Export — Review** runs every 15 minutes. It reads Waste Collection Records, selects the existing 16-field dashboard schema, and sends the `collection-snapshot` repository dispatch event. GitHub validates the snapshot before committing the JSON and deploying the static website. Refresh the browser to see newly published data; allow the export interval plus deployment time. This is periodic synchronization, not an instant streaming feed.

Driver names are replaced with `Driver withheld`. Original free-text comments and service/maintenance details remain internal; public detail fields use standard incident descriptions. Emails, credentials, private URLs, and photographs are not exported. The source List remains private. The first four published records are test submissions with future collection dates.

## Validation and maintenance

Run `python -B -m unittest discover -s scripts -p test_import_snapshot.py` to check the validator. It accepts only BIN-001, BIN-002, and BIN-003 with matching metadata, unique List IDs, valid dates/times, native booleans, fullness from 0–100, and approved public text. Invalid, empty, or partial snapshots fail without replacing the published JSON. Source record deletion requires manual review because removal is deliberately rejected.

Check Power Automate run history for export failures and the repository's Actions tab for validation/deployment failures. If a connection expires, reconnect the existing SharePoint or GitHub connection. Pages must use **GitHub Actions** as its publishing source. Do not manually overwrite records.json with demo data while automatic sync is enabled. The dispatch transport has GitHub's 64 KB payload limit; larger datasets require a different transport before exceeding that limit.

## Local preview

Run `python -m http.server 8000` from the repository root, then open http://localhost:8000. Run `git pull --ff-only` before local edits to receive automatically published records.
