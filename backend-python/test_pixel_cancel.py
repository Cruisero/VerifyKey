"""Exercise the cancellation endpoint without booting unrelated workers/services."""
import ast
import logging
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import Header, HTTPException
import httpx
from typing import Optional


def load_cancel_endpoint(namespace):
    source = Path(__file__).with_name('main.py')
    tree = ast.parse(source.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'pixel_cancel_job')
    node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), namespace)
    return namespace['pixel_cancel_job']


class PixelCancelTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.client = AsyncMock()
        client_context = AsyncMock()
        client_context.__aenter__.return_value = self.client
        self.task = Mock()
        self.task.done.return_value = False
        self.ns = {
            'Optional': Optional, 'Header': Header, 'HTTPException': HTTPException,
            'httpx': SimpleNamespace(AsyncClient=Mock(return_value=client_context), RequestError=httpx.RequestError),
            'logging': logging,
            'auth': SimpleNamespace(verify_token=Mock(return_value={'id': 7, 'role': 'user'})),
            '_pixel_job_context': {'job1': {'user_id': 7, 'cost': 3, 'mode': 'sheerid', 'email': 'sheerid_example'}},
            '_pixel_polling_tasks': {'job1': self.task},
            '_get_pixel_config': lambda: {'baseUrl': 'https://upstream.test', 'apiKey': 'test'},
            '_finalize_user_failure': Mock(return_value={'finalized': True, 'refunded': True}),
            '_complete_async_task': Mock(),
            '_build_verify_event_meta': Mock(return_value={}),
            'broadcast_verify_event': Mock(),
        }
        self.cancel = load_cancel_endpoint(self.ns)

    def assert_unchanged(self):
        self.ns['_finalize_user_failure'].assert_not_called()
        self.ns['_complete_async_task'].assert_not_called()
        self.ns['broadcast_verify_event'].assert_not_called()
        self.task.cancel.assert_not_called()
        self.assertIn('job1', self.ns['_pixel_job_context'])
        self.assertIn('job1', self.ns['_pixel_polling_tasks'])

    async def test_network_failures_never_refund_or_drop_task(self):
        for error in (httpx.ReadTimeout('timeout'), httpx.ConnectError('offline')):
            with self.subTest(error=type(error).__name__):
                self.client.post.side_effect = error
                with self.assertRaises(HTTPException) as exc:
                    await self.cancel('job1', 'Bearer token')
                self.assertEqual(exc.exception.status_code, 502)
                self.assert_unchanged()

    async def test_unconfirmed_responses_never_refund(self):
        for status, body, expected in [
            (503, {'success': True}, 502), (409, {'success': False}, 409),
            (200, {'success': False}, 409), (200, {'success': 'true'}, 409),
            (200, {}, 409), (200, [], 409),
        ]:
            with self.subTest(status=status, body=body):
                self.client.post.return_value = httpx.Response(status, json=body)
                with self.assertRaises(HTTPException) as exc:
                    await self.cancel('job1', 'Bearer token')
                self.assertEqual(exc.exception.status_code, expected)
                self.assert_unchanged()

    async def test_invalid_json_keeps_task(self):
        self.client.post.return_value = httpx.Response(200, text='not JSON')
        with self.assertRaises(HTTPException) as exc:
            await self.cancel('job1', 'Bearer token')
        self.assertEqual(exc.exception.status_code, 502)
        self.assert_unchanged()

    async def test_confirmed_cancellation_finishes_and_refunds(self):
        self.client.post.return_value = httpx.Response(200, json={'success': True})
        result = await self.cancel('job1', 'Bearer token')
        self.assertTrue(result['cancelled'])
        self.ns['_finalize_user_failure'].assert_called_once_with(
            'job1', 7, '已取消: 用户取消', via='pixel_sheerid', refund_cost=3, email='sheerid_example')
        self.task.cancel.assert_called_once()
        self.ns['_complete_async_task'].assert_called_once_with('pixel', 'job1')
        self.assertNotIn('job1', self.ns['_pixel_job_context'])

    async def test_other_users_cannot_cancel(self):
        self.ns['auth'].verify_token.return_value = {'id': 8, 'role': 'user'}
        with self.assertRaises(HTTPException) as exc:
            await self.cancel('job1', 'Bearer token')
        self.assertEqual(exc.exception.status_code, 403)
        self.client.post.assert_not_called()
        self.assert_unchanged()

    async def test_restart_recovers_sheerid_source_from_sqlite_row(self):
        self.ns['_pixel_job_context'].clear()
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.execute('CREATE TABLE verification_history (verification_id, cdk, via, email, cost)')
        conn.execute("INSERT INTO verification_history VALUES ('job1', 'user:7', 'pixel_sheerid', 'sheerid_example', 3)")
        self.client.post.return_value = httpx.Response(200, json={'success': True})
        try:
            with patch.dict(sys.modules, {'database': SimpleNamespace(get_connection=lambda: conn)}):
                await self.cancel('job1', 'Bearer token')
            self.assertEqual(self.ns['_finalize_user_failure'].call_args.kwargs['via'], 'pixel_sheerid')
            self.assertEqual(self.ns['_finalize_user_failure'].call_args.kwargs['refund_cost'], 3)
        finally:
            conn.close()


if __name__ == '__main__':
    unittest.main()
