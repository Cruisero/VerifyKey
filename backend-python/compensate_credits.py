"""
Credit compensation script v2.

Since CDK redeemed_by is not tracked, we use a simpler heuristic:
  For users registered after cutoff (today 12:00 Beijing):
    - If credits = 0 AND no verification_history records → lost all credits
    - If credits > 0 but fewer records than expected → partially lost

Compensation: give back enough credits for 1 auto verification (1.5 credits)
since we can't determine exact amount lost.

Run inside Docker container:
  python3 /app/compensate_credits.py          # Preview only
  python3 /app/compensate_credits.py --apply  # Actually compensate
"""
import sqlite3
import sys

DB_PATH = "/app/data/onepass.db"
USERS_DB_PATH = "/app/data/verifykey.db"

# Beijing 12:00 = UTC 04:00 on 2026-04-10
CUTOFF_UTC_SPACE = "2026-04-10 04:00:00"
CUTOFF_UTC_T = "2026-04-10T04:00:00"

# Fixed compensation amount (max single-use cost)
COMPENSATE_AMOUNT = 1.5


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    users_conn = sqlite3.connect(USERS_DB_PATH)
    users_conn.row_factory = sqlite3.Row

    # Step 1: Get users registered after cutoff
    all_users = users_conn.execute("SELECT id, email, credits, created_at FROM users").fetchall()
    
    cutoff_users = []
    for u in all_users:
        created = (u["created_at"] or "").replace("T", " ")
        if created >= CUTOFF_UTC_SPACE:
            cutoff_users.append(u)

    print(f"Total users in DB: {len(all_users)}")
    print(f"Users registered after cutoff: {len(cutoff_users)}")

    # Step 2: For each cutoff user, count their verification records
    compensate_list = []
    
    for u in cutoff_users:
        uid = u["id"]
        email = u["email"]
        credits = float(u["credits"] or 0)
        
        cdk_tag = f"user:{uid}"
        
        # Count ALL records for this user
        row = conn.execute(
            "SELECT COUNT(*) as total FROM verification_history WHERE cdk = ?",
            (cdk_tag,)
        ).fetchone()
        total_records = row["total"]
        
        # Count by status
        pass_cnt = conn.execute(
            "SELECT COUNT(*) as c FROM verification_history WHERE cdk = ? AND status = 'pass'",
            (cdk_tag,)
        ).fetchone()["c"]
        
        failed_cnt = conn.execute(
            "SELECT COUNT(*) as c FROM verification_history WHERE cdk = ? AND status = 'failed'",
            (cdk_tag,)
        ).fetchone()["c"]
        
        processing_cnt = conn.execute(
            "SELECT COUNT(*) as c FROM verification_history WHERE cdk = ? AND status = 'processing'",
            (cdk_tag,)
        ).fetchone()["c"]
        
        # Determine if compensation needed:
        # credits=0 and no records at all → definitely lost credits
        # credits=0 and only has pass records → credits legitimately spent, no compensation
        # credits=0 and no records → lost
        needs_comp = False
        reason = ""
        
        if credits == 0 and total_records == 0:
            needs_comp = True
            reason = "积分=0 且无任何记录"
        elif credits == 0 and pass_cnt == 0 and failed_cnt == 0 and processing_cnt == 0:
            needs_comp = True
            reason = "积分=0 且无有效记录"
        
        if needs_comp:
            compensate_list.append({
                "user_id": uid,
                "email": email,
                "credits": credits,
                "total_records": total_records,
                "pass": pass_cnt,
                "failed": failed_cnt,
                "processing": processing_cnt,
                "reason": reason,
                "compensate": COMPENSATE_AMOUNT,
            })

    # Print results
    print(f"\n{'='*60}")
    print(f"Users needing compensation: {len(compensate_list)}")
    print(f"Compensation per user: {COMPENSATE_AMOUNT} credits")
    print(f"{'='*60}")
    
    total_cost = 0
    for c in compensate_list:
        print(f"  user:{c['user_id']} | {c['email']}")
        print(f"    credits={c['credits']}, records={c['total_records']} (pass={c['pass']}, failed={c['failed']}, processing={c['processing']})")
        print(f"    reason: {c['reason']} → 补偿 {c['compensate']}")
        total_cost += c["compensate"]
    
    print(f"\nTotal compensation: {total_cost} credits for {len(compensate_list)} users")

    if not compensate_list:
        print("No compensation needed!")
        conn.close()
        users_conn.close()
        return

    # Check --apply flag
    if "--apply" not in sys.argv:
        print(f"\n⚠️  DRY RUN — 预览模式，未执行任何修改")
        print(f"   确认无误后运行: python3 /app/compensate_credits.py --apply")
        conn.close()
        users_conn.close()
        return

    # Apply compensation
    print(f"\n>>> 正在补偿 {len(compensate_list)} 个用户...")
    done = 0
    for c in compensate_list:
        uid = c["user_id"]
        amt = c["compensate"]
        cur = users_conn.execute("SELECT credits FROM users WHERE id = ?", (uid,)).fetchone()
        if cur:
            new_val = round(float(cur["credits"] or 0) + amt, 2)
            users_conn.execute("UPDATE users SET credits = ? WHERE id = ?", (new_val, uid))
            done += 1
            print(f"  ✅ user:{uid} ({c['email']}): {cur['credits']} + {amt} = {new_val}")
    
    users_conn.commit()
    print(f"\n完成! 补偿了 {done} 个用户，共 {total_cost} 积分")
    
    conn.close()
    users_conn.close()


if __name__ == "__main__":
    main()
