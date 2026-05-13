import sys
import os

# Ensure the script can import local backend-python modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import database
import auth
import logging

logging.basicConfig(level=logging.INFO)

def run_fix():
    print("=================================================================")
    print("🔍 开始扫描因状态机漏洞未退款的失败/取消订单...")
    
    conn = database.get_connection()
    cursor = conn.cursor()
    
    # 针对 cost=0 幽灵账单的终极追踪：
    # 哪怕 is_refunded=1，只要当时记录的 cost是0，它就没有真正退过费！
    cursor.execute("""
        SELECT id, verification_id, cdk, cost, via, message, timestamp, IFNULL(is_refunded, 0) as is_refunded
        FROM verification_history
        WHERE status IN ('failed', 'cancel')
          AND cdk LIKE 'user:%'
          AND (IFNULL(is_refunded, 0) = 0 OR cost = 0)
          AND timestamp >= date('now', '-1 day')
    """)
    
    rows = cursor.fetchall()
    
    if not rows:
        print("✅ 数据库里没有任何失败记录！")
        return
        
    print(f"👀 一共找到 {len(rows)} 笔属于用户的失败记录。开始筛查漏退订单...")
    
    refunded_count = 0
    total_cost = 0.0
    
    for row in rows:
        vid = row["verification_id"]
        cost = row["cost"]
        cdk = row["cdk"]
        record_id = row["id"]
        message = row["message"]
        try:
            user_id = int(cdk.replace("user:", ""))
        except ValueError:
            continue
            
        is_refunded = row["is_refunded"]
        via = row["via"]
            
        # 如果是不经过上游的直接失败单（提交失败），当时就已经通过其它路径秒退过了，直接跳过
        if str(vid).startswith("fail-"):
            continue
            
        # 【最高级别真实判定】直接去金库流水里查这笔单子有没有真的退过钱！
        # 如果当初真的退了钱（或是我们用脚本发了sys_compensate），在流水表里肯定有一笔或者多笔总计 >0 的入账。
        # 如果我们用 undo_compensate 扣除回去了，它们的总计就会抵消为 0。
        tx_row = conn.execute("""
            SELECT SUM(amount) as actual_refunded_total 
            FROM credit_transactions 
            WHERE ref_id = ? 
              AND (reason LIKE '%refund%' OR reason LIKE '%compensate%')
        """, (vid,)).fetchone()
        
        actual_refunded_total = tx_row["actual_refunded_total"] if tx_row and tx_row["actual_refunded_total"] else 0.0
        
        if actual_refunded_total > 0:
            # print(f"    [防刷跳过] VID {vid} 经流水查证，总计已成功退还了 {actual_refunded_total} 积分，不产生重复退款。")
            continue
            
        if not cost or cost <= 0:
            # 尝试根据 via 推断 cost
            via_text = str(via).lower()
            real_cost = 2.0 if any(key in via_text for key in ("auto", "kpixel", "vpixel", "pro_submit")) else 1.0
            print(f"    [推断] 发现账本记为 0，且流水没退钱：根据 {via} 必须补回 {real_cost}")
        else:
            real_cost = cost
            
        print(f"-----------------------------------------------------------------")
        print(f"🧾 发现流水干净的漏退订单 VID: {vid}")
        print(f"👤 用户 ID: {user_id} | 💰 退回成本: {real_cost} (原记账: {cost})")
        print(f"📝 失败原因: {message}")
        
        try:
            # 1. 退补积分给用户 (并在资产流水中记录理由)
            auth.update_credits(
                user_id, 
                real_cost, 
                reason="sys_compensate", 
                ref_id=vid
            )
            
            # 2. 将订单状态标记为已被退款，且把错误的0修正为实际金额，防止重复退款
            conn.execute(
                "UPDATE verification_history SET is_refunded = 1, cost = ? WHERE id = ?", 
                (real_cost, record_id)
            )
            conn.commit()
            
            print(f"✅ 成功退回 {real_cost} 积分给用户 {user_id}！")
            refunded_count += 1
            total_cost += real_cost
            
        except Exception as e:
            print(f"❌ 补发失败 (User {user_id}, VID {vid}): {e}")

    print("=================================================================")
    print(f"🎉 修复完成！成功补发了 {refunded_count} 笔退款，总计退还了 {total_cost} 积分。")
    print("如果在运行此脚本前你已经给某位用户手动加过分，请注意核对他是否重复获得了双倍积分，必要时可在后台手动扣走刚才人工补偿的部分。")

if __name__ == "__main__":
    try:
        run_fix()
    except Exception as e:
        print(f"致命错误: {e}")
