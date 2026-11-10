#!/usr/bin/env python3
"""Merge the v1 Rejections & Wastage rows into the live (v2) database.

Source: the csv/ folder of a v1 database backup (one CSV per table).
Target: the seven rw_* tables, through the project's REST API.

The merge only adds. A row is inserted when its id is not in live yet; rows
already there are left exactly as they are, and nothing is deleted. That makes
it safe to run again with a later backup.

    python3 supabase/scripts/rw_v1_merge.py <backup>/csv            # dry run
    python3 supabase/scripts/rw_v1_merge.py <backup>/csv --apply

Masters go first (transaction rows reference them), then the three logs.
Needs SUPABASE_URL and SUPABASE_KEY in the environment, or falls back to the
values in src/integrations/supabase/client.ts.
"""
import csv
import json
import os
import re
import subprocess
import sys

TABLES = ["rw_units", "rw_dispositions", "rw_reasons", "rw_materials",
          "rw_rejections", "rw_leakages", "rw_wastages"]
CHUNK = 500


def config():
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        here = os.path.dirname(os.path.abspath(__file__))
        src = open(os.path.join(here, "..", "..", "src", "integrations", "supabase", "client.ts")).read()
        url = url or re.search(r"SUPABASE_URL = '([^']+)'", src).group(1)
        key = key or re.search(r"SUPABASE_PUBLISHABLE_KEY = '([^']+)'", src).group(1)
    return url.rstrip("/"), key


def call(method, url, key, body=None, extra=()):
    cmd = ["curl", "-sS", "--fail-with-body", "-m", "120", "-X", method, url,
           "-H", f"apikey: {key}", "-H", f"Authorization: Bearer {key}",
           "-H", "Content-Type: application/json"]
    for h in extra:
        cmd += ["-H", h]
    if body is not None:
        cmd += ["--data-binary", "@-"]
    r = subprocess.run(cmd, input=body, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"{method} {url} failed: {r.stdout} {r.stderr}")
    return r.stdout


def live_ids(base, key, table):
    ids, start = set(), 0
    while True:
        out = call("GET", f"{base}/rest/v1/{table}?select=id&order=id", key,
                   extra=(f"Range: {start}-{start + 999}",))
        page = json.loads(out)
        ids.update(r["id"] for r in page)
        if len(page) < 1000:
            return ids
        start += 1000


def backup_rows(folder, table):
    with open(os.path.join(folder, f"{table}.csv"), encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    # A CSV cannot tell NULL from '': every blank is NULL, as in the v1 dump.
    return [{k: (None if v == "" else v) for k, v in r.items()} for r in rows]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply = "--apply" in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)
    base, key = config()
    total = 0
    for t in TABLES:
        rows = backup_rows(args[0], t)
        have = live_ids(base, key, t)
        new = [r for r in rows if r["id"] not in have]
        only_live = len(have - {r["id"] for r in rows})
        print(f"{t:16} backup {len(rows):5}  live {len(have):5}  to insert {len(new):5}  live-only {only_live}")
        total += len(new)
        if apply:
            for i in range(0, len(new), CHUNK):
                call("POST", f"{base}/rest/v1/{t}", key, json.dumps(new[i:i + CHUNK]),
                     extra=("Prefer: resolution=ignore-duplicates,return=minimal",))
    print(("inserted " if apply else "dry run, would insert ") + str(total) + " rows")


if __name__ == "__main__":
    main()
