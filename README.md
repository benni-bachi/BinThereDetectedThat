# Bin There, Detected That

Sacramento State CSC 131 waste-operations dashboard, built with HTML, CSS, and vanilla JavaScript.

## Operational data flow

Unique bin QR → Microsoft Forms → existing Power Automate intake → Microsoft List → scheduled sanitized export → GitHub Actions → data/records.json → GitHub Pages.

The separate Power Automate flow **Bin There Dashboard Export — Review** runs every 15 minutes. It reads Waste Collection Records, selects the existing 16-field dashboard schema, and sends the `collection-snapshot` repository dispatch event. GitHub validates the snapshot before committing the JSON and deploying the static website. Refresh the browser to see newly published data; allow the export interval plus deployment time. This is periodic synchronization, not an instant streaming feed.

Driver names are replaced with `Driver withheld`. Original free-text comments and service/maintenance details remain internal; public detail fields use standard incident descriptions. Emails, credentials, private URLs, and photographs are not exported. The source List remains private. The first four published records are test submissions with future collection dates.

## Validation and maintenance

Run `python -B -m unittest discover -s scripts -p test_import_snapshot.py` to check the validator. It accepts bins registered in `data/bin-links.csv` with matching metadata, unique List IDs, valid dates/times, native booleans, fullness from 0–100, and approved public text. Invalid, empty, or partial snapshots fail without replacing the published JSON. Source record deletion requires manual review because removal is deliberately rejected.

Check Power Automate run history for export failures and the repository's Actions tab for validation/deployment failures. If a connection expires, reconnect the existing SharePoint or GitHub connection. Pages must use **GitHub Actions** as its publishing source. Do not manually overwrite records.json with demo data while automatic sync is enabled. The dispatch transport has GitHub's 64 KB payload limit; larger datasets require a different transport before exceeding that limit.

## Local preview

Run `python -m http.server 8000` from the repository root, then open http://localhost:8000. Run `git pull --ff-only` before local edits to receive automatically published records.

## Service overview and QR labels

Open `overview.html` for pickup trends, pickups by stream, and the top 15 locations. Planned service uses the workbook's UPDATED sheet. Recorded pickups use completed Microsoft List reports. The workbook contains service levels, not dated pickup history; no historical collection events are invented. Weekly planned pickups equal quantity times a stated numeric weekly frequency. Missing or qualified frequencies remain unknown. Weekday charts include only schedules whose listed days match that frequency. Schedule notes expose exclusions.

The workbook supplies 300 containers (102 Landfill, 86 Recycling, 112 Organics) in 153 service entries at 64 locations. These reconcile to its total row. There are 410 known planned weekly container pickups; frequency is unspecified or qualified for 110 containers. Six known weekly pickups cannot be allocated to weekdays because source day counts disagree. The ORIGINAL sheet is retained only in the user's source workbook and is not added a second time.

To refresh the workbook import, install `requirements-data.txt`, then run `python scripts/import_service_overview.py "path/to/Sacramento State_ Service Overview.xlsx"` followed by `python scripts/generate_qr.py`. Reimport preserves existing IDs by location, stream, and container ordinal. Location/stream renames require a mapping review before importing. Account numbers and the raw workbook are not published. The separate service JSON is not overwritten by the recurring List export.

New workbook container labels use BIN-004 through BIN-303. The original three pilot labels remain unchanged and are not counted as three extra workbook containers; their physical correspondence to workbook entries has not been established. There are 269 ready workbook QR codes plus three pilot codes in `generated/qr-labels.zip`. Thirty-one mixed-size containers are held: 21 ALUMNI CENTER TEMP recycling containers, seven HORNET NEST FEST organics containers, and three PERM RO landfill containers. Confirm each size before issuing their codes. No held ID is admitted to the public snapshot validator.

Use the directory's source row, stream, and container number to attach each label to a distinct physical bin; the workbook does not provide physical bin serial numbers. Each ready PNG encodes a Microsoft Forms URL prefilled with its bin ID, location, stream, and known size. The form requires the driver's existing Microsoft access. A representative new URL was checked without submitting a collection. When Forms offers a previous draft, choose New draft to use the current bin's prefilled answers. The generated manifest maps each issued PNG to its prefilled URL. The overview offers individual PNGs and the ZIP download. The generated ZIP is the versioned distribution of all PNGs; deployment extracts it into the public QR directory. Regenerated individual workbook PNGs are ignored in Git.

Overview calculation checks: `node scripts/test_overview.js` (development/CI only; the website requires no Node server or framework). Worksheet data is a one-time import and updates only when the import is rerun. Microsoft List collections continue syncing on the existing schedule.
