#!/bin/bash

SERVER="root@159.195.71.45"

echo "🔌 连接到服务器并执行自动退款脚本..."
ssh -t $SERVER "docker exec -it onepass-backend-1 python3 /app/fix_missing_refunds.py"

echo ""
echo "✅ 跑完啦！请检查上面的输出确认退还金额。"
