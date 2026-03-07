"""
Bot Stats Tracker — Real-time sliding window success rate tracking for each bot type.
Used by the waterfall priority system to sort bots by expected cost = price / success_rate.

Storage: In-memory only (resets on restart, re-learns quickly).
"""

import time
import logging
from collections import deque
from typing import Dict, Optional

logger = logging.getLogger(__name__)

DEFAULT_WINDOW_MINUTES = 60
DEFAULT_SUCCESS_RATE = 0.5  # Neutral default when no data


class BotStatsTracker:
    """Track per-bot success rates using a sliding time window."""

    def __init__(self, window_minutes: int = DEFAULT_WINDOW_MINUTES):
        self._window_seconds = window_minutes * 60
        self._window_minutes = window_minutes
        # {bot_id: deque of (timestamp, success: bool)}
        self._records: Dict[str, deque] = {}

    @property
    def window_minutes(self) -> int:
        return self._window_minutes

    def set_window(self, minutes: int):
        """Update the sliding window size (in minutes)."""
        self._window_minutes = max(5, min(minutes, 1440))  # 5min - 24h
        self._window_seconds = self._window_minutes * 60
        logger.info(f"[BotStats] Window updated to {self._window_minutes} minutes")

    def _cleanup(self, bot_id: str):
        """Remove records older than the sliding window."""
        if bot_id not in self._records:
            return
        cutoff = time.time() - self._window_seconds
        q = self._records[bot_id]
        while q and q[0][0] < cutoff:
            q.popleft()

    def record(self, bot_id: str, success: bool):
        """Record a verification result for a bot."""
        if bot_id not in self._records:
            self._records[bot_id] = deque()
        self._records[bot_id].append((time.time(), success))
        self._cleanup(bot_id)

    def get_success_rate(self, bot_id: str) -> float:
        """
        Get success rate for a bot within the sliding window.
        Returns DEFAULT_SUCCESS_RATE if no data available.
        """
        self._cleanup(bot_id)
        q = self._records.get(bot_id)
        if not q or len(q) == 0:
            return DEFAULT_SUCCESS_RATE

        successes = sum(1 for _, s in q if s)
        return successes / len(q)

    def get_stats(self, bot_id: str) -> dict:
        """Get detailed stats for a specific bot."""
        self._cleanup(bot_id)
        q = self._records.get(bot_id)
        if not q:
            return {"total": 0, "success": 0, "failed": 0, "rate": DEFAULT_SUCCESS_RATE}

        total = len(q)
        successes = sum(1 for _, s in q if s)
        return {
            "total": total,
            "success": successes,
            "failed": total - successes,
            "rate": round(successes / total, 4) if total > 0 else DEFAULT_SUCCESS_RATE
        }

    def get_all_stats(self) -> dict:
        """Get stats for all tracked bots."""
        result = {}
        for bot_id in list(self._records.keys()):
            result[bot_id] = self.get_stats(bot_id)
        return result

    def get_expected_cost(self, bot_id: str, cost_per_verify: float = 1.0) -> float:
        """
        Calculate expected cost per successful verification.
        expected_cost = price / success_rate
        Lower is better.
        """
        rate = self.get_success_rate(bot_id)
        return cost_per_verify / max(rate, 0.01)


# Global singleton
bot_stats_tracker = BotStatsTracker()
