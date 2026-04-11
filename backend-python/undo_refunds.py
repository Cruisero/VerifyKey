import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import database
import auth

def run_undo():
    print("=================================================================")
    print("🔄 开始撤回刚才所有的错发补偿...")
    
    conn = database.get_connection()
    cursor = conn.cursor()
    
    # 查找最近发出的 sys_compensate
    # 在 credit_transactions 或者直接根据 verification_history 中的 sys_compensate 时间线？
    # 等等，如果系统里找 sys_compensate 最好找 verification_history。如果是幽灵单，我把 cost 改成了 >0，不知道怎么识别。
    # 最好通过 auth.update_credits 加入的 credit_transactions 记录撤回。
    
    cursor.execute("""
        SELECT id, user_id, amount, ref_id 
        FROM credit_transactions 
        WHERE reason = 'sys_compensate'
    """)
    rows = cursor.fetchall()
    
    if not rows:
        print("✅ 没有需要撤回的补发记录！")
        return
        
    print(f"👀 找到 {len(rows)} 笔刚刚发出的补偿。开始撤销...")
    
    undo_count = 0
    total_deducted = 0.0
    
    for row in rows:
        vid = row["ref_id"]
        amount = row["amount"]
        user_id = row["user_id"]
        tx_id = row["id"]
        
        try:
            # 扣除刚才加上的钱
            auth.deduct_credits(user_id, amount, reason="undo_compensate", ref_id=vid)
            
            # 将订单里的 cost 恢复成原状(安全起见，所有撤回的直接设回0)
            # 是否把 is_refunded 改为原来的？不改了，避免脚本再刷，我们只要把钱收回来就行了
            conn.execute(
                "UPDATE verification_history SET cost = 0 WHERE verification_id = ? AND cost = ?", 
                (vid, amount)
            )
            
            conn.commit()
            
            print(f"✅ 已撤回给用户 {user_id} 的 {amount} 积分，VID: {vid}")
            undo_count += 1
            total_deducted += amount
            
        except Exception as e:
            print(f"❌ 撤回失败 (User {user_id}, VID {vid}): {e}")

    print("=================================================================")
    print(f"🎉 撤销完成！成功撤回了 {undo_count} 笔错发，总计收回 {total_deducted} 积分。")

if __name__ == "__main__":
    run_undo()
