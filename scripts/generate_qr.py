"""Generate bin QR codes and a manifest from data/bin-links.csv."""

import csv
from pathlib import Path

import qrcode


ROOT = Path(__file__).resolve().parents[1]
FIELDS = ["BinID", "BuildingLocation", "WasteStream", "ContainerTypeSize", "FormsURL"]


def main():
    source = ROOT / "data" / "bin-links.csv"
    with source.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        missing = set(FIELDS) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing CSV columns: {', '.join(sorted(missing))}")
        rows = list(reader)

    seen = set()
    for line, row in enumerate(rows, start=2):
        bin_id = row["BinID"]
        if not bin_id or not bin_id.strip():
            raise ValueError(f"Row {line}: BinID is required")
        if bin_id in seen:
            raise ValueError(f"Row {line}: duplicate BinID {bin_id!r}")
        seen.add(bin_id)
        # Keep each ID a safe, portable PNG filename.
        if any(char in bin_id for char in '<>:"/\\|?*') or any(ord(char) < 32 for char in bin_id) or bin_id.endswith((".", " ")):
            raise ValueError(f"Row {line}: BinID cannot be used as a filename: {bin_id!r}")
        if not row["FormsURL"] or not row["FormsURL"].strip():
            raise ValueError(f"Row {line}: FormsURL is required")
    if len({row["BinID"].casefold() for row in rows}) != len(rows):
        raise ValueError("BinIDs must also be unique ignoring case to avoid filename collisions")

    output = ROOT / "generated" / "qr"
    output.mkdir(parents=True, exist_ok=True)
    for row in rows:
        qrcode.make(row["FormsURL"]).save(output / f'{row["BinID"]}.png')

    manifest = ROOT / "generated" / "qr-manifest.csv"
    with manifest.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS + ["QR filename"])
        writer.writeheader()
        for row in rows:
            writer.writerow({**{field: row[field] for field in FIELDS}, "QR filename": f'{row["BinID"]}.png'})
    print(f"Generated {len(rows)} QR PNGs in {output}")
    print(f"Manifest: {manifest}")


if __name__ == "__main__":
    main()
