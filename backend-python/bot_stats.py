"""
Bot Stats Tracker — Real-time sliding window success rate tracking for each bot type.
Used by the waterfall priority system to sort bots by expected cost = price / success_rate.

Storage: SQLite-backed (persists across restarts).
"""

import time
import logging
from collections import deque
from typing import Dict, Optional

logger = logging.getLogger(__name__)

DEFAULT_WINDOW_MINUTES = 60
DEFAULT_SUCCESS_RATE = 0.5  # Neutral default when no data

# Per-bot window overrides (minutes)
BOT_WINDOW_OVERRIDES = {
    "dualbot": 20,   # DualBot: 20min (frequent data from channel monitoring)
}

# Per-bot default success rate overrides (when no data)
# prior_rate: assumed success rate, prior_count: virtual sample size for smoothing
BOT_PRIOR_CONFIG = {
    "blackbot": {"prior_rate": 0.5, "prior_count": 10},
    # BlackBot: starts at 50% with 10 virtual records (5 success, 5 fail)
    # Real data blends in gradually: 1 real success → (5+1)/(10+1) = 54.5%
}


class BotStatsTracker:
    """Track per-bot success rates using a sliding time window with SQLite persistence."""

    def __init__(self, window_minutes: int = DEFAULT_WINDOW_MINUTES):
        self._window_seconds = window_minutes * 60
        self._window_minutes = window_minutes
        # {bot_id: deque of (timestamp, success: bool)}
        self._records: Dict[str, deque] = {}
        self._db_loaded = False

    def _load_from_db(self):
        """Load records from SQLite on first access."""
        if self._db_loaded:
            return
        self._db_loaded = True
        try:
            import database
            conn = database.get_connection()
            # Load all records within the max possible window (24h)
            cutoff = time.time() - 86400
            cursor = conn.execute(
                "SELECT bot_id, success, timestamp FROM bot_stats WHERE timestamp > ? ORDER BY timestamp",
                (cutoff,)
            )
            count = 0
            for row in cursor.fetchall():
                bot_id = row["bot_id"]
                if bot_id not in self._records:
                    self._records[bot_id] = deque()
                self._records[bot_id].append((row["timestamp"], bool(row["success"])))
                count += 1
            if count > 0:
                logger.info(f"[BotStats] Loaded {count} records from database")
        except Exception as e:
            logger.warning(f"[BotStats] Failed to load from DB: {e}")

    def _save_to_db(self, bot_id: str, success: bool, ts: float):
        """Save a single record to SQLite."""
        try:
            import database
            conn = database.get_connection()
            conn.execute(
                "INSERT INTO bot_stats (bot_id, success, timestamp) VALUES (?, ?, ?)",
                (bot_id, 1 if success else 0, ts)
            )
            conn.commit()
        except Exception as e:
            logger.warning(f"[BotStats] Failed to save to DB: {e}")

    def _cleanup_db(self):
        """Remove old records from DB (older than 24h)."""
        try:
            import database
            conn = database.get_connection()
            cutoff = time.time() - 86400
            conn.execute("DELETE FROM bot_stats WHERE timestamp < ?", (cutoff,))
            conn.commit()
        except Exception as e:
            logger.warning(f"[BotStats] Failed to cleanup DB: {e}")

    @property
    def window_minutes(self) -> int:
        return self._window_minutes

    def set_window(self, minutes: int):
        """Update the global sliding window size (in minutes)."""
        self._window_minutes = max(5, min(minutes, 1440))  # 5min - 24h
        self._window_seconds = self._window_minutes * 60
        logger.info(f"[BotStats] Window updated to {self._window_minutes} minutes")

    def _get_window_seconds(self, bot_id: str) -> int:
        """Get the effective window (in seconds) for a specific bot."""
        override = BOT_WINDOW_OVERRIDES.get(bot_id)
        if override is not None:
            return override * 60
        return self._window_seconds

    def _get_prior(self, bot_id: str) -> tuple:
        """Get Bayesian prior (virtual_successes, virtual_total) for a bot."""
        cfg = BOT_PRIOR_CONFIG.get(bot_id)
        if cfg:
            count = cfg["prior_count"]
            successes = round(cfg["prior_rate"] * count)
            return (successes, count)
        return (0, 0)

    def _cleanup(self, bot_id: str):
        """Remove records older than the sliding window."""
        if bot_id not in self._records:
            return
        cutoff = time.time() - self._get_window_seconds(bot_id)
        q = self._records[bot_id]
        while q and q[0][0] < cutoff:
            q.popleft()

    def record(self, bot_id: str, success: bool):
        """Record a verification result for a bot."""
        self._load_from_db()
        ts = time.time()
        if bot_id not in self._records:
            self._records[bot_id] = deque()
        self._records[bot_id].append((ts, success))
        self._cleanup(bot_id)
        # Persist to DB
        self._save_to_db(bot_id, success, ts)

    def get_success_rate(self, bot_id: str) -> float:
        """
        Get success rate for a bot within the sliding window.
        Uses Bayesian prior smoothing for bots with configured priors.
        """
        self._load_from_db()
        self._cleanup(bot_id)
        q = self._records.get(bot_id)
        prior_s, prior_n = self._get_prior(bot_id)

        real_total = len(q) if q else 0
        real_successes = sum(1 for _, s in q if s) if q else 0

        total = real_total + prior_n
        if total == 0:
            return DEFAULT_SUCCESS_RATE

        return (real_successes + prior_s) / total

    def get_stats(self, bot_id: str) -> dict:
        """Get detailed stats for a specific bot."""
        self._load_from_db()
        self._cleanup(bot_id)
        q = self._records.get(bot_id)
        prior_s, prior_n = self._get_prior(bot_id)

        real_total = len(q) if q else 0
        real_successes = sum(1 for _, s in q if s) if q else 0

        blended_total = real_total + prior_n
        blended_successes = real_successes + prior_s
        rate = round(blended_successes / blended_total, 4) if blended_total > 0 else DEFAULT_SUCCESS_RATE

        return {
            "total": real_total,
            "success": real_successes,
            "failed": real_total - real_successes,
            "rate": rate,
        }

    def get_all_stats(self) -> dict:
        """Get stats for all tracked bots."""
        self._load_from_db()
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
