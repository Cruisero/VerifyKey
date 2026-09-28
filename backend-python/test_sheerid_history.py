import sqlite3
import unittest
from unittest.mock import patch

import database
import verification_history as history


class SheerIdHistoryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('''CREATE TABLE verification_history (
            id TEXT, status TEXT, verification_id TEXT, message TEXT,
            cdk TEXT, timestamp TEXT, via TEXT, email TEXT,
            cost REAL DEFAULT 0, is_refunded INTEGER DEFAULT 0)''')
        self.vid = '6ab123456789abcdef0123456'
        self.url = 'https://services.sheerid.com/verify/program/?verificationId=' + self.vid
        self.conn.execute('''INSERT INTO verification_history
            (id, status, verification_id, message, cdk, timestamp, via, email)
            VALUES ('row1', 'pass', 'upstream-job-1', ?, '', '', 'pixel_sheerid', '')''',
            ('Success: ' + self.url,))
        with patch.object(database.os.path, 'exists', return_value=False):
            database._add_sheerid_verification_id(self.conn)
            database._add_sheerid_verification_id(self.conn)
        # The original message can change without losing the association.
        self.conn.execute("UPDATE verification_history SET message = 'Done'")

    def tearDown(self):
        self.conn.close()

    def test_search_original_id_link_and_task_id(self):
        with patch.object(database, 'get_connection', return_value=self.conn), patch.object(history, '_load_reset_timestamp'):
            for query in (self.vid, self.url, '6ab123', 'upstream-job-1'):
                with self.subTest(query=query):
                    result = history.get_paginated_history(search=query)
                    self.assertEqual(result['total'], 1)
                    self.assertEqual(result['history'][0]['verificationId'], 'upstream-job-1')
                    self.assertEqual(result['history'][0]['sheerIdVerificationId'], self.vid)
            self.assertEqual(history.get_paginated_history(search='missing')['total'], 0)

    def test_pending_task_backfill(self):
        import json
        from unittest.mock import mock_open
        self.conn.execute("UPDATE verification_history SET sheerid_verification_id = ''")
        pending = {'pixel:upstream-job-1': {'type': 'pixel', 'task_id': 'upstream-job-1',
                   'payload': {'verification_id': self.vid}}}
        with patch.object(database.os.path, 'exists', return_value=True), patch('builtins.open', mock_open(read_data=json.dumps(pending))):
            database._add_sheerid_verification_id(self.conn)
        self.assertEqual(self.conn.execute('SELECT sheerid_verification_id FROM verification_history').fetchone()[0], self.vid)


if __name__ == '__main__':
    unittest.main()
