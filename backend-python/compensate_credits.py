"""
Credit compensation script: find users who lost verification records
by comparing their credit income vs outcomes.

Logic:
  total_earned = CDK redeemed credits + registration bonus (1.5) + invitation rewards
  total_spent_in_db = sum of verification costs from verification_history
  current_balance = users.credits
  
  expected_balance = total_earned - total_spent_in_db
  if expected_balance > current_balance:
      lost_credits = expected_balance - current_balance
      → Should compensate user with lost_credits

Scope: only users registered after 2026-04-10 04:00:00 UTC (12:00 Beijing)

Run inside Docker container:
  python3 /app/compensate_credits.py
"""
import json
import sqlite3
import time
import os

DB_PATH = "/app/data/onepass.db"
USERS_DB_PATH = "/app/data/verifykey.db"

# Beijing 12:00 = UTC 04:00 on 2026-04-10
CUTOFF_UTC_T = "2026-04-10T04:00:00"      # Python isoformat (CDK last_used_at)
CUTOFF_UTC_SPACE = "2026-04-10 04:00:00"   # SQLite CURRENT_TIMESTAMP (users.created_at)


def main():
    # Connect to both DBs
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    users_conn = sqlite3.connect(USERS_DB_PATH)
    users_conn.row_factory = sqlite3.Row

    # Step 1: Get all users
    all_users = users_conn.execute("SELECT id, email, credits, created_at FROM users").fetchall()
    print(f"Total users in DB: {len(all_users)}")

    # Step 2: Get CDK redemptions (total credits earned per user)
    # Get ALL CDK redemptions for balance calculation
    cdk_rows = conn.execute(
        "SELECT redeemed_by, SUM(quota) as total FROM cdkeys WHERE redeemed_by IS NOT NULL AND status = 'used' GROUP BY redeemed_by"
    ).fetchall()
    cdk_earned = {r["redeemed_by"]: r["total"] for r in cdk_rows}

    # Filter: users who registered after cutoff AND redeemed CDK after cutoff
    cdk_after_cutoff = conn.execute(
        "SELECT DISTINCT redeemed_by FROM cdkeys WHERE redeemed_by IS NOT NULL AND last_used_at >= ?",
        (CUTOFF_UTC_T,)
    ).fetchall()
    cdk_active_ids = {r["redeemed_by"] for r in cdk_after_cutoff}

    # Users registered after cutoff (SQLite uses space format)
    registered_after_ids = set()
    for u in all_users:
        created = (u["created_at"] or "").replace("T", " ")  # normalize
        if created >= CUTOFF_UTC_SPACE:
            registered_after_ids.add(u["id"])

    # Must satisfy BOTH: registered after cutoff AND redeemed CDK after cutoff
    active_user_ids = cdk_active_ids & registered_after_ids

    # Filter to only these users
    users = [u for u in all_users if u["id"] in active_user_ids]
    print(f"Registered after cutoff: {len(registered_after_ids)}")
    print(f"Redeemed CDK after cutoff: {len(cdk_active_ids)}")
    print(f"Both (registered AND redeemed): {len(users)}")
    print(f"Users with CDK redemptions (all time): {len(cdk_earned)}")

    # Step 3: Get invitation rewards per user (inviter gets 0.2 per invitee)
    try:
        inv_rows = users_conn.execute(
            "SELECT inviter_id, SUM(reward_amount) as total FROM invitation_rewards GROUP BY inviter_id"
        ).fetchall()
        inv_earned = {r["inviter_id"]: r["total"] for r in inv_rows}
    except:
        inv_earned = {}
    print(f"Users with invitation rewards: {len(inv_earned)}")

    # Step 4: Get ALL verification costs per user from verification_history
    # Include ALL service types that deduct credits, not just pixel
    # Cost mapping:
    #   pixel_auto → 1.5, pixel → 1.0
    #   vpixel → 1.0, kpixel → 1.0, ypixel → 1.0
    #   gpt → varies (usually 1.0)
    #   pro_submit → 1.0
    #   Others → 1.0 (default)
    
    COST_MAP = {
        "pixel_auto": 1.5,
        "pixel": 1.0,
        "vpixel": 1.0,
        "kpixel": 1.0,
        "ypixel": 1.0,
        "gpt": 1.0,
        "pro_submit": 1.0,
    }
    
    # Count ALL pass records (credits legitimately spent)
    vh_rows = conn.execute("""
        SELECT cdk, via, COUNT(*) as cnt 
        FROM verification_history 
        WHERE status = 'pass'
        GROUP BY cdk, via
    """).fetchall()
    
    # Parse user_id from cdk field (format: "user:123")
    user_spent = {}  # user_id -> total credits spent on successful verifications
    for r in vh_rows:
        cdk_val = r["cdk"] or ""
        if cdk_val.startswith("user:"):
            try:
                uid = int(cdk_val.split(":")[1])
            except:
                continue
        else:
            continue
        via = r["via"] or ""
        cost_per = COST_MAP.get(via, 1.0)
        spent = cost_per * r["cnt"]
        user_spent[uid] = user_spent.get(uid, 0) + spent

    # Failed records: originally charged, then refunded → net cost = 0
    # So we don't count them as spent

    # Count ALL processing records (credits locked, not yet finalized)
    vh_processing = conn.execute("""
        SELECT cdk, via, COUNT(*) as cnt 
        FROM verification_history 
        WHERE status = 'processing'
        GROUP BY cdk, via
    """).fetchall()
    
    user_processing_spent = {}
    for r in vh_processing:
        cdk_val = r["cdk"] or ""
        if cdk_val.startswith("user:"):
            try:
                uid = int(cdk_val.split(":")[1])
            except:
                continue
        else:
            continue
        via = r["via"] or ""
        cost_per = COST_MAP.get(via, 1.0)
        spent = cost_per * r["cnt"]
        user_processing_spent[uid] = user_processing_spent.get(uid, 0) + spent

    print(f"Users with pass records: {len(user_spent)}")
    print(f"Users with processing records: {len(user_processing_spent)}")

    # Step 5: Calculate expected vs actual balance
    REGISTRATION_BONUS = 0  # Registration gives 0 credits; all credits come from CDK

    compensate_list = []
    
    for u in users:
        uid = u["id"]
        email = u["email"]
        current_credits = float(u["credits"] or 0)
        created_at = u["created_at"] or ""
        
        # Filter: only users active after cutoff
        # We check if they have any CDK redemption or verification after cutoff
        # Simpler: check all users but only compensate if there's a discrepancy
        
        # Total earned
        earned_cdk = float(cdk_earned.get(uid, 0))
        earned_inv = float(inv_earned.get(uid, 0))
        total_earned = earned_cdk + REGISTRATION_BONUS + earned_inv
        
        # Total spent (on successful verifications)
        total_pass_spent = float(user_spent.get(uid, 0))
        
        # Total locked in processing
        total_processing = float(user_processing_spent.get(uid, 0))
        
        # Expected balance = earned - pass_spent - processing_spent
        expected = total_earned - total_pass_spent - total_processing
        
        # Discrepancy
        diff = expected - current_credits
        
        # If diff > 0.1 (rounding tolerance), user lost credits
        if diff > 0.1:
            compensate_list.append({
                "user_id": uid,
                "email": email,
                "created_at": created_at,
                "earned_cdk": earned_cdk,
                "earned_inv": earned_inv,
                "total_earned": total_earned,
                "pass_spent": total_pass_spent,
                "processing_spent": total_processing,
                "expected": round(expected, 2),
                "actual": current_credits,
                "diff": round(diff, 2),
            })

    print(f"\n{'='*60}")
    print(f"Users needing compensation: {len(compensate_list)}")
    print(f"{'='*60}")
    
    total_compensate = 0
    for c in sorted(compensate_list, key=lambda x: x["diff"], reverse=True):
        print(f"  user:{c['user_id']} | {c['email']}")
        print(f"    earned={c['total_earned']} (cdk={c['earned_cdk']}, inv={c['earned_inv']}, reg={REGISTRATION_BONUS})")
        print(f"    pass_spent={c['pass_spent']}, processing={c['processing_spent']}")
        print(f"    expected={c['expected']}, actual={c['actual']}, DIFF={c['diff']}")
        total_compensate += c["diff"]
    
    print(f"\nTotal credits to compensate: {total_compensate}")
    
    if not compensate_list:
        print("No compensation needed!")
        conn.close()
        users_conn.close()
        return
    
    # Check if --apply flag is provided
    import sys
    if "--apply" not in sys.argv:
        print(f"\n⚠️  DRY RUN — 以上为预览，未执行任何修改")
        print(f"   确认无误后，运行: python3 /app/compensate_credits.py --apply")
        conn.close()
        users_conn.close()
        return
    
    print(f"\n>>> Applying compensation to {len(compensate_list)} users...")
    compensated = 0
    for c in compensate_list:
        uid = c["user_id"]
        diff = c["diff"]
        current = users_conn.execute("SELECT credits FROM users WHERE id = ?", (uid,)).fetchone()
        if current:
            new_credits = round(float(current["credits"] or 0) + diff, 2)
            users_conn.execute("UPDATE users SET credits = ? WHERE id = ?", (new_credits, uid))
            compensated += 1
            print(f"  ✅ user:{uid} ({c['email']}): {current['credits']} + {diff} = {new_credits}")
    
    users_conn.commit()
    print(f"\nCompensated {compensated} users, total {total_compensate} credits")
    
    conn.close()
    users_conn.close()
    print("Done!")


if __name__ == "__main__":
    main()
