"""
One-shot script to recover pixel jobs that exist in pending_async_tasks.json
but are missing from verification_history in the database.

For each missing job:
1. Create a 'processing' record in verification_history
2. Query upstream API for current status
3. If terminal (success/failed), finalize the record and handle credits

Run inside Docker container:
  python3 /app/recover_missing_jobs.py
"""
import json
import sqlite3
import urllib.request
import time
import os

PENDING_FILE = "/app/data/pending_async_tasks.json"
DB_PATH = "/app/data/onepass.db"

# Load pixel config for upstream API
def get_pixel_config():
    try:
        config_path = "/app/data/config.json"
        if os.path.exists(config_path):
            with open(config_path) as f:
                cfg = json.load(f)
            pixel = cfg.get("pixelApi", {})
            return pixel.get("apiKey", ""), pixel.get("baseUrl", "https://iqless.icu")
    except:
        pass
    return "", "https://iqless.icu"

def main():
    api_key, base_url = get_pixel_config()
    if not api_key:
        # Try alt config path
        for p in ["/app/data/onepass_config.json", "/app/config.json"]:
            if os.path.exists(p):
                with open(p) as f:
                    cfg = json.load(f)
                pixel = cfg.get("pixelApi", {})
                api_key = pixel.get("apiKey", "")
                base_url = pixel.get("baseUrl", "https://iqless.icu")
                if api_key:
                    break
    
    print(f"API Key: {'found' if api_key else 'NOT FOUND'}")
    print(f"Base URL: {base_url}")
    
    if not api_key:
        print("ERROR: No API key found. Cannot query upstream.")
        return

    # Load pending tasks
    if not os.path.exists(PENDING_FILE):
        print(f"No pending file at {PENDING_FILE}")
        return
    
    with open(PENDING_FILE) as f:
        data = json.load(f)
    
    pixel_tasks = {k: v for k, v in data.items() if v.get("type") == "pixel"}
    print(f"\nTotal pending pixel tasks: {len(pixel_tasks)}")
    
    # Connect to DB
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Find missing ones
    missing = []
    for k, v in pixel_tasks.items():
        tid = v["task_id"]
        payload = v.get("payload", {})
        row = conn.execute("SELECT status FROM verification_history WHERE verification_id = ? LIMIT 1", (tid,)).fetchone()
        if not row:
            missing.append({
                "task_id": tid,
                "user_id": int(payload.get("user_id", 0) or 0),
                "email": payload.get("email", ""),
                "mode": payload.get("mode", "semi-auto"),
                "cost": float(payload.get("cost", 0) or 0),
            })
    
    print(f"Missing from DB: {len(missing)}")
    if not missing:
        print("Nothing to recover!")
        return
    
    # Process each missing job
    stats = {"success": 0, "failed": 0, "queued": 0, "running": 0, "error": 0, "created": 0}
    
    for job in missing:
        tid = job["task_id"]
        uid = job["user_id"]
        email = job["email"]
        mode = job["mode"]
        cost = 1.5 if mode == "auto" else 1.0
        via = "pixel_auto" if mode == "auto" else "pixel"
        cdk_tag = f"user:{uid}" if uid else ""
        
        # Step 1: Create processing record in DB
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        import uuid
        row_id = str(uuid.uuid4())[:8]
        conn.execute(
            "INSERT OR IGNORE INTO verification_history (id, status, verification_id, message, cdk, timestamp, via, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (row_id, "processing", tid, "🔄 恢复中...", cdk_tag, now, via, email)
        )
        conn.commit()
        stats["created"] += 1
        
        # Step 2: Query upstream
        try:
            req = urllib.request.Request(
                f"{base_url}/api/jobs/{tid}",
                headers={"X-API-Key": api_key}
            )
            resp = urllib.request.urlopen(req, timeout=15)
            result = json.loads(resp.read())
            upstream_status = result.get("status", "")
            
            if upstream_status == "success":
                url = result.get("url", "")
                msg = f"✅ 订阅成功: {url}" if url else "✅ 订阅成功"
                
                # Check if user was already refunded (status was 'failed' before)
                # For missing jobs, they were never recorded, so credits were deducted but never refunded
                # Mark as pass WITHOUT re-deducting (user already paid at submit time)
                conn.execute(
                    "UPDATE verification_history SET status = 'pass', message = ? WHERE verification_id = ? AND cdk = ?",
                    (msg + " （任务恢复）", tid, cdk_tag)
                )
                conn.commit()
                stats["success"] += 1
                print(f"  ✅ {tid[:20]} -> SUCCESS (user:{uid}, {email})")
                
            elif upstream_status in ("failed", "cancelled"):
                err = result.get("error", "")
                rm = result.get("result_msg", "")
                disp = rm if rm else (err if err else "未知错误")
                msg = f"失败: {disp} （任务恢复）"
                
                conn.execute(
                    "UPDATE verification_history SET status = 'failed', message = ? WHERE verification_id = ? AND cdk = ?",
                    (msg, tid, cdk_tag)
                )
                conn.commit()
                
                # Refund credits since job failed and user already paid
                if uid and cost > 0:
                    try:
                        conn2 = sqlite3.connect(DB_PATH)
                        current = conn2.execute("SELECT credits FROM users WHERE id = ?", (uid,)).fetchone()
                        if current:
                            new_credits = (current[0] or 0) + cost
                            conn2.execute("UPDATE users SET credits = ? WHERE id = ?", (new_credits, uid))
                            conn2.commit()
                            print(f"  ❌ {tid[:20]} -> FAILED + REFUND {cost} (user:{uid}, {email})")
                        conn2.close()
                    except Exception as e:
                        print(f"  ❌ {tid[:20]} -> FAILED, refund error: {e}")
                else:
                    print(f"  ❌ {tid[:20]} -> FAILED (user:{uid}, {email})")
                stats["failed"] += 1
                
            elif upstream_status in ("queued", "running"):
                # Still in progress — leave as processing, sweep will handle
                conn.execute(
                    "UPDATE verification_history SET message = '排队/执行中，等待巡检处理...' WHERE verification_id = ? AND cdk = ?",
                    (tid, cdk_tag)
                )
                conn.commit()
                stats[upstream_status] += 1
                print(f"  ⏳ {tid[:20]} -> {upstream_status.upper()} (user:{uid}, {email})")
                
            else:
                print(f"  ❓ {tid[:20]} -> UNKNOWN: {upstream_status}")
                stats["error"] += 1
                
        except Exception as e:
            print(f"  ⚠️  {tid[:20]} -> ERROR: {str(e)[:60]}")
            stats["error"] += 1
        
        time.sleep(0.5)
    
    # Remove completed tasks from pending file
    completed_keys = []
    for k, v in pixel_tasks.items():
        tid = v["task_id"]
        row = conn.execute("SELECT status FROM verification_history WHERE verification_id = ? LIMIT 1", (tid,)).fetchone()
        if row and row["status"] in ("pass", "failed"):
            completed_keys.append(k)
    
    if completed_keys:
        for k in completed_keys:
            if k in data:
                del data[k]
        with open(PENDING_FILE, "w") as f:
            json.dump(data, f, ensure_ascii=False)
        print(f"\nCleaned {len(completed_keys)} completed tasks from pending file")
    
    conn.close()
    
    print(f"\n=== Recovery Summary ===")
    print(f"  Created DB records: {stats['created']}")
    print(f"  Success (no extra charge): {stats['success']}")
    print(f"  Failed (refunded): {stats['failed']}")
    print(f"  Still queued: {stats['queued']}")
    print(f"  Still running: {stats['running']}")
    print(f"  Errors: {stats['error']}")

if __name__ == "__main__":
    main()
