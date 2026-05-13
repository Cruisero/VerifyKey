"""
Complete recovery script:

Phase 1: Pull upstream /api/history (success records) → restore missing DB records
Phase 2: For users who were charged but have NO verification records at all →
          check upstream /api/result for each missing target email (from pending_tasks.json)
Phase 3: Report users who need manual credit refund

Run inside Docker container:
  python3 /app/recover_from_upstream.py
"""
import json
import sqlite3
import urllib.request
import time
import os
import uuid

DB_PATH = "/app/data/onepass.db"
USERS_DB_PATH = "/app/data/verifykey.db"
PENDING_FILE = "/app/data/pending_async_tasks.json"


def get_pixel_config():
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


def fetch_upstream_history(api_key, base_url, limit=200, max_pages=20):
    all_records = []
    offset = 0
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    for page in range(max_pages):
        try:
            url = f"{base_url}/api/history?limit={limit}&offset={offset}"
            req = urllib.request.Request(url, headers={
                "X-API-Key": api_key,
                "User-Agent": "OnePass/1.0",
            })
            resp = urllib.request.urlopen(req, timeout=30, context=ctx)
            data = json.loads(resp.read())
            records = data.get("records", [])
            total = data.get("total", 0)
            all_records.extend(records)
            print(f"  Page {page+1}: got {len(records)} records (total upstream: {total})")
            if len(records) < limit or offset + limit >= total:
                break
            offset += limit
            time.sleep(0.3)
        except Exception as e:
            print(f"  Error fetching page {page+1}: {e}")
            break
    return all_records


def fetch_upstream_result(api_key, base_url, email):
    """Query upstream for a specific email's result."""
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        url = f"{base_url}/api/result?email={urllib.request.quote(email)}"
        req = urllib.request.Request(url, headers={
            "X-API-Key": api_key,
            "User-Agent": "OnePass/1.0",
        })
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"status": "not_found"}
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def main():
    api_key, base_url = get_pixel_config()
    print(f"API Key: {'found' if api_key else 'NOT FOUND'}")
    print(f"Base URL: {base_url}")

    if not api_key:
        print("ERROR: No API key found.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # ===== PHASE 1: Recover from upstream success history =====
    print("\n" + "=" * 60)
    print("PHASE 1: Recovering from upstream success history")
    print("=" * 60)

    upstream_records = fetch_upstream_history(api_key, base_url)
    print(f"Total upstream success records: {len(upstream_records)}")

    # Get all existing verified emails in our DB
    existing_emails = set()
    rows = conn.execute("SELECT email FROM verification_history WHERE via IN ('pixel', 'pixel_auto') AND email != ''").fetchall()
    for r in rows:
        if r["email"]:
            existing_emails.add(r["email"].lower())
    print(f"Existing verified emails in DB: {len(existing_emails)}")

    # Find upstream successes missing from our DB
    missing_successes = []
    for rec in upstream_records:
        email = rec.get("email", "").lower()
        if email and email not in existing_emails:
            missing_successes.append(rec)

    print(f"Missing from DB: {len(missing_successes)}")

    # For each missing success, try to find the user via pending_tasks
    pending_email_to_user = {}  # target_email -> {user_id, mode}
    if os.path.exists(PENDING_FILE):
        with open(PENDING_FILE) as f:
            pending = json.load(f)
        for k, v in pending.items():
            if v.get("type") == "pixel":
                p = v.get("payload", {})
                target_email = p.get("email", "").lower()
                if target_email:
                    pending_email_to_user[target_email] = {
                        "user_id": int(p.get("user_id", 0) or 0),
                        "mode": p.get("mode", "semi-auto"),
                    }

    # Also try matching from verification_history where we DO have records for other emails of same user
    # Build user_email_map (login email -> user_id)
    # Users table is in verifykey.db, not onepass.db
    users_conn = sqlite3.connect(USERS_DB_PATH)
    users_conn.row_factory = sqlite3.Row
    user_rows = users_conn.execute("SELECT id, email FROM users").fetchall()
    login_email_to_uid = {}
    for u in user_rows:
        login_email_to_uid[u["email"].lower()] = u["id"]

    phase1_recovered = 0
    phase1_unmatched = 0
    phase1_unmatched_emails = []

    for rec in missing_successes:
        email = rec.get("email", "")
        mode = rec.get("mode", "semi-auto")
        url_val = rec.get("url", "")
        result_msg = rec.get("result_msg", "")
        created_at = rec.get("created_at", "")
        via = "pixel_auto" if mode == "auto" else "pixel"

        # Try to find user
        user_id = 0

        # Method 1: From pending tasks
        if email.lower() in pending_email_to_user:
            info = pending_email_to_user[email.lower()]
            user_id = info["user_id"]

        # Method 2: Target email is also login email
        if not user_id and email.lower() in login_email_to_uid:
            user_id = login_email_to_uid[email.lower()]

        if user_id:
            row_id = str(uuid.uuid4())[:8]
            msg = f"✅ 订阅成功: {url_val}" if url_val else f"✅ {result_msg or '订阅成功'}"
            msg += " （历史恢复）"
            cdk_tag = f"user:{user_id}"
            conn.execute(
                "INSERT OR IGNORE INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (row_id, "pass", f"recovered-{row_id}", msg, cdk_tag,
                 created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), via, email)
            )
            conn.commit()
            phase1_recovered += 1
            print(f"  ✅ {email} -> user:{user_id} ({mode})")
        else:
            phase1_unmatched += 1
            phase1_unmatched_emails.append(email)

    print(f"\nPhase 1 results: recovered={phase1_recovered}, unmatched={phase1_unmatched}")

    # ===== PHASE 2: Check pending tasks against upstream =====
    print("\n" + "=" * 60)
    print("PHASE 2: Checking pending tasks against upstream /api/result")
    print("=" * 60)

    phase2_success = 0
    phase2_failed = 0
    phase2_not_found = 0
    phase2_refunded = 0

    if os.path.exists(PENDING_FILE):
        with open(PENDING_FILE) as f:
            pending = json.load(f)
        pixel_tasks = {k: v for k, v in pending.items() if v.get("type") == "pixel"}
        print(f"Pending pixel tasks: {len(pixel_tasks)}")

        for k, v in pixel_tasks.items():
            p = v.get("payload", {})
            target_email = p.get("email", "")
            user_id = int(p.get("user_id", 0) or 0)
            mode = p.get("mode", "semi-auto")
            cost = 2.0 if mode == "auto" else 1.0
            via = "pixel_auto" if mode == "auto" else "pixel"
            cdk_tag = f"user:{user_id}" if user_id else ""

            if not target_email:
                continue

            # Check if already in DB
            existing = conn.execute(
                "SELECT status FROM verification_history WHERE email = ? AND cdk = ? LIMIT 1",
                (target_email, cdk_tag)
            ).fetchone()
            if existing and existing["status"] in ("pass", "failed"):
                continue  # Already handled

            # Query upstream
            result = fetch_upstream_result(api_key, base_url, target_email)
            status = result.get("status", "")

            if status == "success":
                url_val = result.get("url", "")
                result_msg = result.get("result_msg", "")
                created_at = result.get("created_at", "")
                row_id = str(uuid.uuid4())[:8]
                msg = f"✅ 订阅成功: {url_val}" if url_val else f"✅ {result_msg or '订阅成功'}"
                msg += " （历史恢复）"
                conn.execute(
                    "INSERT OR REPLACE INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (row_id, "pass", v["task_id"], msg, cdk_tag,
                     created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), via, target_email)
                )
                conn.commit()
                phase2_success += 1
                print(f"  ✅ {target_email} -> SUCCESS (user:{user_id})")

            elif status == "failed":
                err = result.get("error", "") or result.get("result_msg", "未知错误")
                row_id = str(uuid.uuid4())[:8]
                conn.execute(
                    "INSERT OR REPLACE INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (row_id, "failed", v["task_id"], f"失败: {err} （历史恢复）", cdk_tag,
                     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), via, target_email)
                )
                conn.commit()
                # Refund credits
                if user_id and cost > 0:
                    current = users_conn.execute("SELECT credits FROM users WHERE id = ?", (user_id,)).fetchone()
                    if current:
                        new_credits = (current["credits"] or 0) + cost
                        users_conn.execute("UPDATE users SET credits = ? WHERE id = ?", (new_credits, user_id))
                        users_conn.commit()
                        phase2_refunded += 1
                        print(f"  ❌ {target_email} -> FAILED + REFUND {cost} (user:{user_id})")
                    else:
                        print(f"  ❌ {target_email} -> FAILED, user not found for refund")
                phase2_failed += 1

            elif status == "not_found":
                # Upstream doesn't have this email at all — job was lost
                row_id = str(uuid.uuid4())[:8]
                conn.execute(
                    "INSERT OR REPLACE INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (row_id, "failed", v["task_id"], "失败: 上游无记录，任务丢失 （已退积分）", cdk_tag,
                     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), via, target_email)
                )
                conn.commit()
                # Refund
                if user_id and cost > 0:
                    current = users_conn.execute("SELECT credits FROM users WHERE id = ?", (user_id,)).fetchone()
                    if current:
                        new_credits = (current["credits"] or 0) + cost
                        users_conn.execute("UPDATE users SET credits = ? WHERE id = ?", (new_credits, user_id))
                        users_conn.commit()
                        phase2_refunded += 1
                        print(f"  💀 {target_email} -> LOST + REFUND {cost} (user:{user_id})")
                phase2_not_found += 1

            else:
                print(f"  ⏳ {target_email} -> {status} (still processing)")

            time.sleep(0.3)

    print(f"\nPhase 2 results: success={phase2_success}, failed={phase2_failed}, not_found={phase2_not_found}, refunded={phase2_refunded}")

    # ===== PHASE 3: Report summary =====
    print("\n" + "=" * 60)
    print("PHASE 3: Final Summary")
    print("=" * 60)

    total_processing = conn.execute(
        "SELECT COUNT(*) FROM verification_history WHERE status = 'processing' AND via IN ('pixel', 'pixel_auto')"
    ).fetchone()[0]
    total_pass = conn.execute(
        "SELECT COUNT(*) FROM verification_history WHERE status = 'pass' AND via IN ('pixel', 'pixel_auto')"
    ).fetchone()[0]
    total_failed = conn.execute(
        "SELECT COUNT(*) FROM verification_history WHERE status = 'failed' AND via IN ('pixel', 'pixel_auto')"
    ).fetchone()[0]

    print(f"  DB Processing: {total_processing}")
    print(f"  DB Pass: {total_pass}")
    print(f"  DB Failed: {total_failed}")
    print(f"  Phase 1 recovered (from history): {phase1_recovered}")
    print(f"  Phase 1 unmatched: {phase1_unmatched}")
    print(f"  Phase 2 success: {phase2_success}")
    print(f"  Phase 2 failed+refund: {phase2_failed}")
    print(f"  Phase 2 lost+refund: {phase2_not_found}")
    print(f"  Total refunded: {phase2_refunded}")

    if phase1_unmatched_emails:
        print(f"\n  Unmatched emails (upstream success but no user found):")
        for e in phase1_unmatched_emails[:20]:
            print(f"    - {e}")
        if len(phase1_unmatched_emails) > 20:
            print(f"    ... and {len(phase1_unmatched_emails)-20} more")

    conn.close()
    users_conn.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
