"""
One-shot script: Find processing pixel tasks that are missing from upstream API,
and resubmit them. Run inside Docker container.
"""
import json
import time
import database
import auth
import httpx

def main():
    conn = database.get_connection()
    
    # Load API config
    cfg = json.load(open("/app/data/config.json"))
    pixel_cfg = cfg.get("pixelApi", {})
    api_key = pixel_cfg.get("apiKey", "")
    base_url = pixel_cfg.get("baseUrl", "https://auto.onepass.fun")
    
    if not api_key:
        print("ERROR: No pixelApi.apiKey in config")
        return
    
    # 1) Get all processing pixel tasks
    rows = conn.execute(
        "SELECT verification_id, email, via, cdk, message "
        "FROM verification_history "
        "WHERE status = 'processing' AND via IN ('pixel', 'pixel_auto') "
        "ORDER BY rowid DESC"
    ).fetchall()
    
    print(f"Found {len(rows)} processing pixel tasks")
    
    orphaned = []
    alive = []
    errors = []
    
    headers = {"X-API-Key": api_key}
    
    # 2) Check each one against upstream
    with httpx.Client(timeout=15) as client:
        for r in rows:
            vid = r["verification_id"]
            email = r["email"] if "email" in r.keys() else ""
            via = r["via"] if "via" in r.keys() else "pixel"
            cdk = r["cdk"]
            
            if not vid:
                continue
            
            try:
                resp = client.get(f"{base_url}/api/jobs/{vid}", headers=headers)
                
                if resp.status_code == 404:
                    # Upstream doesn't know about this job — it's orphaned
                    orphaned.append({"vid": vid, "email": email, "via": via, "cdk": cdk})
                    print(f"  ORPHANED: {vid} | {email}")
                elif resp.status_code == 200:
                    data = resp.json()
                    status = data.get("status", "unknown")
                    alive.append({"vid": vid, "email": email, "status": status})
                    print(f"  ALIVE: {vid} | {email} | upstream={status}")
                else:
                    errors.append({"vid": vid, "email": email, "http": resp.status_code})
                    print(f"  ERROR: {vid} | {email} | HTTP {resp.status_code}")
                    
            except Exception as e:
                errors.append({"vid": vid, "email": email, "error": str(e)})
                print(f"  EXCEPTION: {vid} | {email} | {e}")
            
            time.sleep(0.3)  # Be nice to the API
    
    print(f"\n=== Summary ===")
    print(f"Alive (still on upstream): {len(alive)}")
    print(f"Orphaned (missing from upstream): {len(orphaned)}")
    print(f"Errors: {len(errors)}")
    
    if not orphaned:
        print("\nNo orphaned tasks to resubmit. Done!")
        return
    
    # 3) For orphaned tasks, try to resubmit via email lookup
    #    We can use GET /api/result?email=... to check if upstream has any record
    #    If 404, the task was truly lost. We'll mark it as failed so user can retry.
    print(f"\n=== Processing {len(orphaned)} orphaned tasks ===")
    
    resubmitted = 0
    marked_failed = 0
    
    with httpx.Client(timeout=15) as client:
        for task in orphaned:
            vid = task["vid"]
            email = task["email"]
            via = task["via"]
            cdk = task["cdk"]
            
            # Check if upstream recognizes this email at all
            try:
                resp = client.get(
                    f"{base_url}/api/result",
                    params={"email": email},
                    headers=headers
                )
                
                if resp.status_code == 200:
                    # Upstream has a result for this email!
                    data = resp.json()
                    upstream_status = data.get("status", "")
                    url = data.get("url", "")
                    result_msg = data.get("result_msg", "")
                    
                    if upstream_status == "success":
                        # Great! Task actually succeeded upstream, just update our DB
                        msg = f"✅ 订阅成功: {url}" if url else f"✅ 订阅成功: {result_msg}"
                        conn.execute(
                            "UPDATE verification_history SET status = 'pass', message = ? "
                            "WHERE verification_id = ? AND status = 'processing'",
                            (msg, vid)
                        )
                        conn.commit()
                        
                        # Deduct credits if user
                        user_id = 0
                        if cdk and cdk.startswith("user:"):
                            try:
                                user_id = int(cdk.replace("user:", ""))
                            except:
                                pass
                        # No need to deduct — already deducted when submitted
                        
                        print(f"  RECOVERED SUCCESS: {vid} | {email} | {url}")
                        resubmitted += 1
                        
                    elif upstream_status in ("running", "queued"):
                        # Still processing upstream under different job id
                        print(f"  STILL RUNNING: {vid} | {email}")
                        # Keep as processing
                        
                    elif upstream_status == "failed":
                        error = data.get("error", "UNKNOWN")
                        conn.execute(
                            "UPDATE verification_history SET status = 'failed', message = ? "
                            "WHERE verification_id = ? AND status = 'processing'",
                            (f"失败: {error}（上游确认）", vid)
                        )
                        conn.commit()
                        
                        # Refund user
                        user_id = 0
                        if cdk and cdk.startswith("user:"):
                            try:
                                user_id = int(cdk.replace("user:", ""))
                            except:
                                pass
                        if user_id:
                            cost = 2.0 if "auto" in via else 1.0
                            auth.update_credits(user_id, cost)
                            print(f"  CONFIRMED FAILED + REFUNDED: {vid} | {email} | {error}")
                        else:
                            print(f"  CONFIRMED FAILED: {vid} | {email} | {error}")
                        marked_failed += 1
                    else:
                        print(f"  UNKNOWN STATUS: {vid} | {email} | {upstream_status}")
                        
                elif resp.status_code == 404:
                    # Upstream has NO record of this email at all — truly lost
                    conn.execute(
                        "UPDATE verification_history SET status = 'failed', "
                        "message = '任务丢失（上游API重启），请重新提交' "
                        "WHERE verification_id = ? AND status = 'processing'",
                        (vid,)
                    )
                    conn.commit()
                    
                    # Refund user
                    user_id = 0
                    if cdk and cdk.startswith("user:"):
                        try:
                            user_id = int(cdk.replace("user:", ""))
                        except:
                            pass
                    if user_id:
                        cost = 2.0 if "auto" in via else 1.0
                        auth.update_credits(user_id, cost)
                        print(f"  LOST + REFUNDED: {vid} | {email} | cost={cost}")
                    else:
                        print(f"  LOST (no user): {vid} | {email}")
                    marked_failed += 1
                else:
                    print(f"  API ERROR: {vid} | {email} | HTTP {resp.status_code}")
                    
            except Exception as e:
                print(f"  EXCEPTION: {vid} | {email} | {e}")
            
            time.sleep(0.3)
    
    print(f"\n=== Final Results ===")
    print(f"Recovered (upstream success): {resubmitted}")
    print(f"Marked failed + refunded: {marked_failed}")
    print("Done!")


if __name__ == "__main__":
    database.init_db()
    main()
