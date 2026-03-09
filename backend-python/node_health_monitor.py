"""
Node Health Monitor — Multi-node external status monitoring + smart routing.

Periodically polls external APIs (GetGem, OldBot) and combines with internal
bot_stats_tracker data to determine node health and compute optimal traffic allocation.
"""

import asyncio
import time
import logging
import json
from typing import Dict, Optional, List
from dataclasses import dataclass, field, asdict

import httpx

from bot_stats import bot_stats_tracker

logger = logging.getLogger(__name__)

# ─── Constants ───────────────────────────────────────────────────────
POLL_INTERVAL = 30  # seconds
SPARKLINE_SIZE = 20  # recent results to show in sparkline
CANARY_MIN_PCT = 5   # minimum % allocation per enabled node (canary probing)
DECAY_START_SECS = 600   # 10 minutes — start decaying rate after this idle time
DECAY_FLOOR = 0.30       # decay target (30%)
DECAY_DEFAULT = 0.50     # default rate when no data at all

# Per-node concurrent capacity (how many links can be processed at once)
NODE_CONCURRENCY = {
    "getgem": 10,     # GetGem API: 10 concurrent links
    "oldbot": 5,      # OldBot: 5 per Telegram account
    "blackbot": 1,    # BlackBot: 1 per Telegram account
    "dualbot": 1,     # DualBot: 1 per Telegram account
}

EXTERNAL_APIS = {
    "getgem": "https://getgem.cc/api/stats",
    "oldbot": "https://sheeridbot.com/api/public/gemini-status",
}

DEFAULT_THRESHOLDS = {
    "degradeThreshold": 50,      # % below → degraded
    "circuitBreakThreshold": 20, # % below → circuit_broken
    "recoverThreshold": 70,      # % above (3x consecutive) → healthy
}


# ─── Data Classes ────────────────────────────────────────────────────
@dataclass
class NodeStatus:
    node_id: str
    status: str = "healthy"           # healthy | degraded | circuit_broken
    success_rate: float = 0.5         # 0-1
    enabled: bool = True              # manual toggle
    weight: float = 1.0               # manual cost weight (0.1 - 1.0)
    sparkline: List[int] = field(default_factory=list)  # 0=pass, 1=fail, 2=cancel
    extra: dict = field(default_factory=dict)            # slots, pending, maintenance, etc.
    last_updated: float = 0.0
    source: str = "internal"          # external | internal | mixed
    recover_streak: int = 0           # consecutive healthy polls for recovery

    def to_dict(self):
        return {
            "nodeId": self.node_id,
            "status": self.status,
            "successRate": round(self.success_rate * 100, 1),
            "enabled": self.enabled,
            "weight": self.weight,
            "sparkline": self.sparkline[-SPARKLINE_SIZE:],
            "extra": self.extra,
            "lastUpdated": self.last_updated,
            "source": self.source,
        }


class NodeHealthMonitor:
    """Monitors node health via external APIs + internal stats, computes routing allocation."""

    def __init__(self):
        self._nodes: Dict[str, NodeStatus] = {}
        self._thresholds = dict(DEFAULT_THRESHOLDS)
        self._mode = "auto"          # auto | locked
        self._locked_allocation: Dict[str, int] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._http: Optional[httpx.AsyncClient] = None

    # ─── Lifecycle ───────────────────────────────────────────────────

    async def start(self):
        """Start background polling loop."""
        if self._running:
            return
        self._running = True
        self._http = httpx.AsyncClient(timeout=10, verify=False)
        logger.info("[NodeHealth] Starting background monitor (interval=%ds)", POLL_INTERVAL)
        # Do an initial poll immediately
        await self._poll_all()
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        if self._task:
            self._running = False
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._http:
            await self._http.aclose()

    async def _loop(self):
        while self._running:
            await asyncio.sleep(POLL_INTERVAL)
            try:
                await self._poll_all()
            except Exception as e:
                logger.error("[NodeHealth] Poll error: %s", e)

    # ─── Polling ─────────────────────────────────────────────────────

    async def _poll_all(self):
        """Poll all external APIs and update internal stats."""
        tasks = [
            self._poll_getgem(),
            self._poll_oldbot(),
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

        # Update nodes that have no external API (use internal stats only)
        for bot_id in ("blackbot", "dualbot"):
            self._update_internal_node(bot_id)

        # Recompute statuses based on thresholds
        self._recompute_statuses()

    async def _poll_getgem(self):
        """Poll GetGem /api/stats for resultHistory and capacity info."""
        node = self._ensure_node("getgem")
        try:
            resp = await self._http.get(EXTERNAL_APIS["getgem"])
            data = resp.json()

            # Parse resultHistory for success rate
            history = data.get("resultHistory", [])
            if history:
                recent = history[-50:]  # last 50 results
                passes = sum(1 for r in recent if r.get("r") == 0)
                node.success_rate = passes / len(recent)
                # Update sparkline
                node.sparkline = [r.get("r", 1) for r in history[-SPARKLINE_SIZE:]]
            else:
                # No history — use internal stats
                internal_rate = bot_stats_tracker.get_success_rate("getgem")
                node.success_rate = internal_rate
                internal_stats = bot_stats_tracker.get_stats("getgem")
                node.sparkline = []

            # Maintenance check
            is_maintenance = data.get("status") == "maintenance"

            node.extra = {
                "availableSlots": data.get("availableSlots", 0),
                "activeJobs": data.get("activeJobs", 0),
                "maxConcurrent": data.get("maxConcurrent", 0),
                "identityRemaining": data.get("identityRemaining", 0),
                "maintenance": is_maintenance,
                "apiStatus": data.get("status", "unknown"),
            }
            node.source = "external"
            node.last_updated = time.time()

            # Force circuit break if maintenance
            if is_maintenance:
                node.success_rate = 0.0
                node.status = "circuit_broken"

        except Exception as e:
            logger.warning("[NodeHealth] GetGem poll failed: %s", e)
            # Don't change status on poll failure — keep last known state
            node.extra["pollError"] = str(e)

    async def _poll_oldbot(self):
        """Poll OldBot /api/public/gemini-status for success rate."""
        node = self._ensure_node("oldbot")
        try:
            resp = await self._http.get(EXTERNAL_APIS["oldbot"])
            data = resp.json()

            summary = data.get("summary", {})
            ext_rate = summary.get("success_rate", 0)
            # External rate is 0-1 or 0-100? Check: the API returns 0-1 range
            if ext_rate > 1:
                ext_rate = ext_rate / 100.0
            node.success_rate = ext_rate

            # Build sparkline from sessions if available
            sessions = data.get("sessions", [])
            if sessions:
                sparkline = []
                for s in sessions[-SPARKLINE_SIZE:]:
                    status = s.get("status", "").lower()
                    if status in ("success", "approved"):
                        sparkline.append(0)
                    elif status in ("rejected",):
                        sparkline.append(1)
                    elif status in ("cancelled",):
                        sparkline.append(2)
                    else:
                        sparkline.append(1)
                node.sparkline = sparkline

            node.extra = {
                "total": summary.get("total", 0),
                "success": summary.get("success", 0),
                "failed": summary.get("failed", 0),
                "rejected": summary.get("rejected", 0),
                "pending": summary.get("pending", 0),
                "cancelled": summary.get("cancelled", 0),
            }
            node.source = "external"
            node.last_updated = time.time()

        except Exception as e:
            logger.warning("[NodeHealth] OldBot poll failed: %s", e)
            node.extra["pollError"] = str(e)

    def _update_internal_node(self, bot_id: str):
        """Update a node using only internal bot_stats_tracker data.
        
        Applies data decay: if no recent data for >DECAY_START_SECS,
        the success rate decays linearly toward DECAY_FLOOR.
        """
        node = self._ensure_node(bot_id)
        stats = bot_stats_tracker.get_stats(bot_id)
        total = stats.get("total", 0)
        raw_rate = stats.get("rate", DECAY_DEFAULT)

        # ── Data Decay ──
        # If no records at all, or records are stale, decay toward DECAY_FLOOR
        records = bot_stats_tracker._records.get(bot_id)
        if records:
            last_ts = records[-1][0]  # timestamp of most recent record
            age = time.time() - last_ts
            if age > DECAY_START_SECS:
                # Linear decay: at DECAY_START_SECS → raw_rate, at 2x → DECAY_FLOOR
                decay_progress = min((age - DECAY_START_SECS) / DECAY_START_SECS, 1.0)
                raw_rate = raw_rate + (DECAY_FLOOR - raw_rate) * decay_progress
                node.extra["decayed"] = True
                node.extra["idleMinutes"] = round(age / 60, 1)
        elif total == 0:
            # No data at all — use decay floor
            raw_rate = DECAY_FLOOR
            node.extra["decayed"] = True
            node.extra["idleMinutes"] = None  # no data ever

        node.success_rate = max(raw_rate, 0.0)
        node.source = "internal"
        node.last_updated = time.time()

        # Build sparkline from internal records
        if records:
            node.sparkline = [0 if s else 1 for _, s in list(records)[-SPARKLINE_SIZE:]]

        node.extra.update({
            "total": total,
            "success": stats.get("success", 0),
            "failed": stats.get("failed", 0),
        })

    # ─── Status Computation ──────────────────────────────────────────

    def _recompute_statuses(self):
        """Apply threshold rules to determine node status."""
        degrade = self._thresholds["degradeThreshold"] / 100.0
        circuit = self._thresholds["circuitBreakThreshold"] / 100.0
        recover = self._thresholds["recoverThreshold"] / 100.0

        for node in self._nodes.values():
            # Skip if manually marked maintenance (getgem)
            if node.extra.get("maintenance"):
                node.status = "circuit_broken"
                node.recover_streak = 0
                continue

            rate = node.success_rate

            if node.status == "circuit_broken":
                # Need consecutive recover_streak to come back
                if rate >= recover:
                    node.recover_streak += 1
                    if node.recover_streak >= 3:
                        node.status = "healthy"
                        node.recover_streak = 0
                        logger.info("[NodeHealth] %s recovered → healthy (rate=%.0f%%)", node.node_id, rate * 100)
                else:
                    node.recover_streak = 0
            elif node.status == "degraded":
                if rate >= recover:
                    node.recover_streak += 1
                    if node.recover_streak >= 2:
                        node.status = "healthy"
                        node.recover_streak = 0
                        logger.info("[NodeHealth] %s recovered → healthy (rate=%.0f%%)", node.node_id, rate * 100)
                elif rate < circuit:
                    node.status = "circuit_broken"
                    node.recover_streak = 0
                    logger.warning("[NodeHealth] %s circuit broken (rate=%.0f%%)", node.node_id, rate * 100)
                else:
                    node.recover_streak = 0
            else:  # healthy
                node.recover_streak = 0
                if rate < circuit:
                    node.status = "circuit_broken"
                    logger.warning("[NodeHealth] %s circuit broken (rate=%.0f%%)", node.node_id, rate * 100)
                elif rate < degrade:
                    node.status = "degraded"
                    logger.warning("[NodeHealth] %s degraded (rate=%.0f%%)", node.node_id, rate * 100)

    # ─── Public API ──────────────────────────────────────────────────

    def _ensure_node(self, node_id: str) -> NodeStatus:
        if node_id not in self._nodes:
            self._nodes[node_id] = NodeStatus(node_id=node_id)
        return self._nodes[node_id]

    def get_node_status(self, node_id: str) -> Optional[NodeStatus]:
        return self._nodes.get(node_id)

    def get_all_statuses(self) -> Dict[str, dict]:
        return {nid: n.to_dict() for nid, n in self._nodes.items()}

    def set_node_enabled(self, node_id: str, enabled: bool):
        node = self._ensure_node(node_id)
        node.enabled = enabled
        logger.info("[NodeHealth] %s manually %s", node_id, "enabled" if enabled else "disabled")

    def set_node_weight(self, node_id: str, weight: float):
        """Set cost weight for a node (0.1 - 1.0). Higher = more traffic."""
        node = self._ensure_node(node_id)
        node.weight = max(0.1, min(1.0, weight))
        logger.info("[NodeHealth] %s weight set to %.1f", node_id, node.weight)

    def get_effective_rate(self, node_id: str) -> float:
        """Get the effective success rate for routing decisions."""
        node = self._nodes.get(node_id)
        if not node:
            return bot_stats_tracker.get_success_rate(node_id)
        if not node.enabled:
            return 0.0
        if node.status == "circuit_broken":
            return 0.0
        return node.success_rate

    # ─── Allocation ──────────────────────────────────────────────────

    def get_allocation(self, available_nodes: List[str] = None) -> Dict[str, int]:
        """Compute traffic allocation percentages.
        
        In auto mode: weight by success rate, exclude circuit_broken/disabled.
        In locked mode: return the manually set allocation.
        """
        if self._mode == "locked" and self._locked_allocation:
            return dict(self._locked_allocation)

        # Auto mode: compute from rates
        if available_nodes is None:
            available_nodes = list(self._nodes.keys())

        weights = {}
        for nid in available_nodes:
            node = self._nodes.get(nid)
            if not node or not node.enabled:
                continue
            if node.status == "circuit_broken":
                continue
            rate = node.success_rate
            if node.status == "degraded":
                rate *= 0.5  # halve the rate for degraded nodes
            # Blend: 70% success rate + 30% manual weight
            weights[nid] = max(rate * 0.7 + node.weight * 0.3, 0.01)

        if not weights:
            # No healthy nodes — fallback to equal distribution of available
            return {nid: round(100 / len(available_nodes)) for nid in available_nodes}

        total_weight = sum(weights.values())
        allocation = {}
        for nid in available_nodes:
            if nid in weights:
                allocation[nid] = round(weights[nid] / total_weight * 100)
            else:
                allocation[nid] = 0

        # ── Canary minimum: ensure each enabled non-broken node gets at least CANARY_MIN_PCT ──
        canary_nodes = [nid for nid in available_nodes if nid in weights and allocation.get(nid, 0) < CANARY_MIN_PCT]
        if canary_nodes and len(weights) > 1:
            for nid in canary_nodes:
                deficit = CANARY_MIN_PCT - allocation.get(nid, 0)
                allocation[nid] = CANARY_MIN_PCT
                # Take from the highest-allocation node
                top = max(allocation, key=allocation.get)
                if top != nid:
                    allocation[top] = max(allocation[top] - deficit, CANARY_MIN_PCT)

        # Ensure sum = 100
        diff = 100 - sum(allocation.values())
        if diff != 0 and allocation:
            # Add remainder to highest weight node
            top = max(allocation, key=allocation.get)
            allocation[top] += diff

        return allocation

    def allocate_by_capacity(self, total_vids: int, capacities: Dict[str, int]) -> Dict[str, int]:
        """Allocate VIDs across nodes respecting capacity constraints.
        
        3-step algorithm:
          1. Compute ideal allocation by effective weight (rate×0.7 + weight×0.3)
          2. Cap each node by its capacity
          3. Redistribute overflow to nodes with remaining capacity
        
        Args:
            total_vids: Number of VIDs to distribute
            capacities: {node_id: max_concurrent_capacity}
        
        Returns:
            {node_id: num_vids_assigned}
        """
        if not capacities or total_vids <= 0:
            return {}

        # Filter to enabled, non-broken nodes with capacity > 0
        effective = {}
        for nid, cap in capacities.items():
            if cap <= 0:
                continue
            node = self._nodes.get(nid)
            if node and not node.enabled:
                continue
            if node and node.status == "circuit_broken":
                continue
            rate = node.success_rate if node else DECAY_DEFAULT
            if node and node.status == "degraded":
                rate *= 0.5
            w = node.weight if node else 1.0
            effective[nid] = {
                "weight": max(rate * 0.7 + w * 0.3, 0.01),
                "capacity": cap,
            }

        if not effective:
            return {}

        # Step 1: Ideal allocation by weight
        total_weight = sum(e["weight"] for e in effective.values())
        assigned = {}
        for nid, e in effective.items():
            ideal = total_vids * e["weight"] / total_weight
            assigned[nid] = round(ideal)

        # Fix rounding to match total
        rounding_diff = total_vids - sum(assigned.values())
        if rounding_diff != 0:
            # Add/remove from highest weight node
            top = max(effective, key=lambda n: effective[n]["weight"])
            assigned[top] += rounding_diff

        # Step 2 & 3: Cap and redistribute (iterative)
        for _ in range(5):  # max 5 redistribution rounds
            overflow = 0
            for nid in list(assigned.keys()):
                cap = effective[nid]["capacity"]
                if assigned[nid] > cap:
                    overflow += assigned[nid] - cap
                    assigned[nid] = cap

            if overflow == 0:
                break

            # Redistribute overflow to nodes with remaining capacity
            remaining = {nid: effective[nid]["capacity"] - assigned[nid]
                        for nid in assigned if effective[nid]["capacity"] - assigned[nid] > 0}
            if not remaining:
                # All nodes at capacity — drop the overflow (shouldn't happen normally)
                logger.warning("[NodeHealth] All nodes at capacity, %d VIDs unassignable", overflow)
                break

            remaining_weight = sum(effective[nid]["weight"] for nid in remaining)
            for nid in remaining:
                share = round(overflow * effective[nid]["weight"] / remaining_weight)
                share = min(share, remaining[nid])  # don't exceed remaining capacity
                assigned[nid] += share

            # Handle any leftover from rounding
            leftover = total_vids - sum(assigned.values())
            if leftover > 0:
                for nid in sorted(remaining, key=lambda n: effective[n]["weight"], reverse=True):
                    can_add = effective[nid]["capacity"] - assigned[nid]
                    add = min(leftover, can_add)
                    assigned[nid] += add
                    leftover -= add
                    if leftover <= 0:
                        break

        logger.info("[NodeHealth] Capacity allocation: %s (total=%d)", assigned, total_vids)
        return assigned

    def select_node(self, available_nodes: List[str] = None) -> str:
        """Select a single node probabilistically based on allocation weights.
        
        Used for routing individual verification requests.
        Returns the node_id of the selected node, or None if no nodes available.
        """
        import random
        alloc = self.get_allocation(available_nodes)
        # Filter out zero-allocation nodes
        candidates = [(nid, pct) for nid, pct in alloc.items() if pct > 0]
        if not candidates:
            return None
        # Weighted random selection
        total = sum(pct for _, pct in candidates)
        r = random.uniform(0, total)
        cumulative = 0
        for nid, pct in candidates:
            cumulative += pct
            if r <= cumulative:
                return nid
        return candidates[-1][0]

    def get_ordered_nodes(self, available_nodes: List[str] = None) -> List[str]:
        """Return nodes ordered by allocation weight (highest first).
        
        Used for waterfall fallback: try the highest-weight node first,
        then fall back to the next one, etc.
        Excludes circuit_broken and disabled nodes.
        """
        alloc = self.get_allocation(available_nodes)
        # Sort by allocation descending, exclude 0%
        ordered = sorted(
            [(nid, pct) for nid, pct in alloc.items() if pct > 0],
            key=lambda x: x[1],
            reverse=True,
        )
        return [nid for nid, _ in ordered]

    # ─── Configuration ───────────────────────────────────────────────

    def get_config(self) -> dict:
        return {
            "thresholds": dict(self._thresholds),
            "mode": self._mode,
            "lockedAllocation": dict(self._locked_allocation),
        }

    def update_config(self, thresholds: dict = None, mode: str = None, locked_allocation: dict = None):
        if thresholds:
            for key in ("degradeThreshold", "circuitBreakThreshold", "recoverThreshold"):
                if key in thresholds:
                    self._thresholds[key] = max(0, min(100, int(thresholds[key])))
            logger.info("[NodeHealth] Thresholds updated: %s", self._thresholds)
        if mode and mode in ("auto", "locked"):
            self._mode = mode
            logger.info("[NodeHealth] Mode set to: %s", mode)
        if locked_allocation is not None:
            self._locked_allocation = dict(locked_allocation)
            logger.info("[NodeHealth] Locked allocation set: %s", locked_allocation)

        # Persist config
        self._save_config()

    def _save_config(self):
        """Save monitor config to file for persistence across restarts."""
        try:
            import os
            config_path = os.path.join(os.path.dirname(__file__), "node_health_config.json")
            with open(config_path, "w") as f:
                json.dump({
                    "thresholds": self._thresholds,
                    "mode": self._mode,
                    "lockedAllocation": self._locked_allocation,
                    "nodeEnabled": {nid: n.enabled for nid, n in self._nodes.items()},
                    "nodeWeights": {nid: n.weight for nid, n in self._nodes.items()},
                }, f, indent=2)
        except Exception as e:
            logger.error("[NodeHealth] Failed to save config: %s", e)

    def _load_config(self):
        """Load saved config on startup."""
        try:
            import os
            config_path = os.path.join(os.path.dirname(__file__), "node_health_config.json")
            if os.path.exists(config_path):
                with open(config_path) as f:
                    data = json.load(f)
                if "thresholds" in data:
                    self._thresholds.update(data["thresholds"])
                if "mode" in data:
                    self._mode = data["mode"]
                if "lockedAllocation" in data:
                    self._locked_allocation = data["lockedAllocation"]
                if "nodeEnabled" in data:
                    for nid, enabled in data["nodeEnabled"].items():
                        self._ensure_node(nid).enabled = enabled
                if "nodeWeights" in data:
                    for nid, weight in data["nodeWeights"].items():
                        self._ensure_node(nid).weight = max(0.1, min(1.0, float(weight)))
                logger.info("[NodeHealth] Loaded saved config")
        except Exception as e:
            logger.warning("[NodeHealth] Could not load config: %s", e)

    async def force_refresh(self):
        """Force an immediate re-poll of all external APIs."""
        await self._poll_all()
        return self.get_all_statuses()


# ─── Capacity Tracker (real-time slot management) ────────────────────
class CapacityTracker:
    """Track real-time in-use capacity per node.
    
    acquire(node_id) before processing a VID, release(node_id) when done.
    available(node_id, max_cap) returns remaining free slots.
    """

    def __init__(self):
        self._in_use: Dict[str, int] = {}
        self._lock = __import__("threading").Lock()

    def acquire(self, node_id: str, count: int = 1):
        """Mark slots as in-use."""
        with self._lock:
            self._in_use[node_id] = self._in_use.get(node_id, 0) + count
            logger.debug("[Capacity] %s acquired %d → in_use=%d", node_id, count, self._in_use[node_id])

    def release(self, node_id: str, count: int = 1):
        """Release slots back to available pool."""
        with self._lock:
            self._in_use[node_id] = max(0, self._in_use.get(node_id, 0) - count)
            logger.debug("[Capacity] %s released %d → in_use=%d", node_id, count, self._in_use[node_id])

    def available(self, node_id: str, max_capacity: int) -> int:
        """Return remaining free slots for a node."""
        with self._lock:
            return max(0, max_capacity - self._in_use.get(node_id, 0))

    def in_use(self, node_id: str) -> int:
        """Return current in-use count."""
        with self._lock:
            return self._in_use.get(node_id, 0)

    def get_all_usage(self) -> Dict[str, int]:
        """Return snapshot of all in-use counts."""
        with self._lock:
            return dict(self._in_use)


# ─── Global Singletons ───────────────────────────────────────────────
node_health_monitor = NodeHealthMonitor()
node_health_monitor._load_config()
capacity_tracker = CapacityTracker()
