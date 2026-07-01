import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import database

conn = database.get_connection()
cursor = conn.cursor()

cursor.execute("SELECT id, verification_id, status, is_refunded, cost, timestamp FROM verification_history WHERE email = 'avawan0612@gmail.com' ORDER BY id DESC LIMIT 5")
for r in cursor.fetchall():
    print(dict(r))
