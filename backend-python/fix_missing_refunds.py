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
    
    # 我们先不做限制，查出所有 failed/cancel 的看看情况
    cursor.execute("""
        SELECT id, verification_id, cdk, cost, via, message, timestamp, IFNULL(is_refunded, 0) as is_refunded
        FROM verification_history
        WHERE status IN ('failed', 'cancel')
          AND cdk LIKE 'user:%'
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
        is_refunded = row["is_refunded"]
        
        try:
            user_id = int(cdk.replace("user:", ""))
        except ValueError:
            continue
            
        if not cost or cost <= 0:
            # 尝试根据 via 推断 cost
            cost = 1.5 if "auto" in str(via).lower() else 1.0
            print(f"    [推断] 发现 cost 为 0，根据 via={via} 推断扣分成本为 {cost}")
            
        # 如果已经退过了，跳过
        if is_refunded == 1:
            continue
            
        print(f"-----------------------------------------------------------------")
        print(f"🧾 发现漏退订单 VID: {vid}")
        print(f"👤 用户 ID: {user_id} | 💰 退回成本: {cost}")
        print(f"📝 失败原因: {message}")
        
        try:
            # 1. 退补积分给用户 (并在资产流水中记录理由)
            auth.update_credits(
                user_id, 
                cost, 
                reason="sys_compensate", 
                ref_id=vid
            )
            
            # 2. 将订单状态标记为已被退款，防止未来重复刷新
            conn.execute(
                "UPDATE verification_history SET is_refunded = 1 WHERE id = ?", 
                (record_id,)
            )
            conn.commit()
            
            print(f"✅ 成功退回 {cost} 积分给用户 {user_id}！")
            refunded_count += 1
            total_cost += cost
            
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
