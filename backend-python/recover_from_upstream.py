"""
Batch recovery script: pull ALL success records from upstream API history,
cross-reference with our verification_history DB, and recover any missing records.

For records that exist in upstream but NOT in our DB:
  - If we can match the email to a user → create the DB record (status=pass)
  - Credits are NOT re-deducted (they were already deducted at submit time)

Run inside Docker container:
  python3 /app/recover_from_upstream.py
"""
import json
import sqlite3
import urllib.request
import time
import os
import sys

DB_PATH = "/app/data/onepass.db"

def get_pixel_config():
    """Load pixel API config."""
    for p in ["/app/data/config.json", "/app/data/onepass_config.json", "/app/config.json"]:
        if os.path.exists(p):
            try:
                with open(p) as f:
                    cfg = json.load(f)
                pixel = cfg.get("pixelApi", {})
                api_key = pixel.get("apiKey", "")
                base_url = pixel.get("baseUrl", "https://iqless.icu")
                if api_key:
                    return api_key, base_url
            except:
                pass
    return "", "https://iqless.icu"


def fetch_upstream_history(api_key, base_url, limit=200, max_pages=10):
    """Fetch all success records from upstream /api/history."""
    all_records = []
    offset = 0
    for page in range(max_pages):
        try:
            url = f"{base_url}/api/history?limit={limit}&offset={offset}"
            req = urllib.request.Request(url, headers={"X-API-Key": api_key})
            resp = urllib.request.urlopen(req, timeout=30)
            data = json.loads(resp.read())
            records = data.get("records", [])
            total = data.get("total", 0)
            all_records.extend(records)
            print(f"  Page {page+1}: got {len(records)} records (total upstream: {total})")
            if len(records) < limit or offset + limit >= total:
                break
            offset += limit
            time.sleep(0.5)
        except Exception as e:
            print(f"  Error fetching page {page+1}: {e}")
            break
    return all_records


def main():
    api_key, base_url = get_pixel_config()
    print(f"API Key: {'found' if api_key else 'NOT FOUND'}")
    print(f"Base URL: {base_url}")

    if not api_key:
        print("ERROR: No API key found.")
        return

    # Step 1: Fetch upstream history
    print("\n=== Step 1: Fetching upstream success history ===")
    upstream_records = fetch_upstream_history(api_key, base_url)
    print(f"Total upstream success records: {len(upstream_records)}")

    if not upstream_records:
        print("No records found upstream. Exiting.")
        return

    # Step 2: Connect to DB
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Step 3: Build email -> user_id mapping from users table
    users = conn.execute("SELECT id, email FROM users").fetchall()
    # Map the TARGET email (gmail that was verified) -> we need to find users by their account email
    # But upstream records contain the TARGET gmail, not the user's login email
    # We need a different approach: check by verification email in our DB

    # Build set of emails already in our verification_history 
    existing_vids = set()
    existing_emails = set()
    rows = conn.execute("SELECT verification_id, email FROM verification_history WHERE via IN ('pixel', 'pixel_auto')").fetchall()
    for r in rows:
        existing_vids.add(r["verification_id"])
        if r["email"]:
            existing_emails.add(r["email"].lower())
    print(f"\nExisting pixel records in DB: {len(existing_vids)}")
    print(f"Existing verified emails in DB: {len(existing_emails)}")

    # Step 4: Find missing records
    missing = []
    already_have = 0
    for rec in upstream_records:
        email = rec.get("email", "").lower()
        if email in existing_emails:
            already_have += 1
        else:
            missing.append(rec)

    print(f"\nAlready in DB: {already_have}")
    print(f"Missing from DB: {len(missing)}")

    if not missing:
        print("Nothing to recover!")
        conn.close()
        return

    # Step 5: Try to match missing emails to users
    # We need to find which user submitted each email
    # Since we don't have this mapping for missing records, we'll try:
    # 1. Check if the email matches a user's login email (unlikely for gmail targets)
    # 2. Check credit_transactions table for deduction records
    # 3. If can't match, create record without user_id (orphan)

    user_email_map = {}
    for u in users:
        user_email_map[u["email"].lower()] = u["id"]

    # Check if there's a credit_transactions or orders table
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"\nDB tables: {', '.join(tables)}")

    has_credit_log = "credit_transactions" in tables or "credit_log" in tables
    credit_table = "credit_transactions" if "credit_transactions" in tables else ("credit_log" if "credit_log" in tables else None)

    recovered = 0
    unmatched = 0

    print(f"\n=== Step 5: Recovering missing records ===")
    for rec in missing:
        email = rec.get("email", "")
        mode = rec.get("mode", "semi-auto")
        url = rec.get("url", "")
        result_msg = rec.get("result_msg", "")
        created_at = rec.get("created_at", "")
        via = "pixel_auto" if mode == "auto" else "pixel"

        # Try to find which user owns this email via credit log
        user_id = 0
        if credit_table:
            try:
                # Look for a deduction that mentions this email
                cr = conn.execute(
                    f"SELECT user_id FROM {credit_table} WHERE description LIKE ? LIMIT 1",
                    (f"%{email}%",)
                ).fetchone()
                if cr:
                    user_id = cr["user_id"]
            except:
                pass

        # Fallback: check if verified email is also a user login email
        if not user_id and email.lower() in user_email_map:
            user_id = user_email_map[email.lower()]

        cdk_tag = f"user:{user_id}" if user_id else ""

        if user_id:
            # Create recovery record
            import uuid
            row_id = str(uuid.uuid4())[:8]
            msg = f"✅ 订阅成功: {url}" if url else f"✅ {result_msg or '订阅成功'}"
            msg += " （历史恢复）"

            conn.execute(
                "INSERT OR IGNORE INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (row_id, "pass", f"recovered-{row_id}", msg, cdk_tag, created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), via, email)
            )
            conn.commit()
            recovered += 1
            print(f"  ✅ {email} -> user:{user_id} ({mode})")
        else:
            unmatched += 1
            if unmatched <= 10:
                print(f"  ❓ {email} -> no matching user found")

    conn.close()

    print(f"\n=== Recovery Summary ===")
    print(f"  Upstream total: {len(upstream_records)}")
    print(f"  Already in DB: {already_have}")
    print(f"  Recovered: {recovered}")
    print(f"  Unmatched (no user found): {unmatched}")


if __name__ == "__main__":
    main()
