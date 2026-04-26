# AutoPixel API 文档

> **Base URL**: `https://auto.onepass.fun`
> **最后更新**: 2026-04-26

---

## 认证

所有接口（健康检查除外）须在请求头中携带 API Key：

```
X-API-Key: <your_api_key>
```

本地 Dashboard（127.0.0.1）免认证。

---

## 接口列表

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/api/health` | 否 | 健康检查 |
| `POST` | `/api/jobs` | 是 | 提交任务 |
| `GET` | `/api/jobs/{job_id}` | 是 | 查询任务状态 |
| `POST` | `/api/jobs/{job_id}/cancel` | 是 | 取消排队中的任务 |
| `GET` | `/api/queue` | 是 | 队列状态 |
| `GET` | `/api/history` | 是 | 成功历史 |
| `GET` | `/api/result` | 是 | Email 查询结果 |
| `GET` | `/api/accounts/query` | 是 | 批量查询账号结果 |
| `GET` | `/api/stats` | 是 | 统计数据 |

---

## 1. 健康检查

```
GET /api/health
```

无需认证。

```json
{
  "status": "ok",
  "device_connected": true,
  "device_model": "Pixel 10 Pro",
  "task_status": "standby"
}
```

**`task_status` 可能值：**

| 值 | 说明 |
|----|------|
| `idle` | 未启动 |
| `standby` | 待机中（等待账号） |
| `running` | 正在处理任务 |

---

## 2. 提交任务

```
POST /api/jobs
```

提交 Google 账号信息，系统自动处理。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | string | 是 | Google 邮箱 |
| `password` | string | 是 | 密码 |
| `totp_secret` | string | 否 | TOTP 密钥（Base32 编码） |
| `mode` | string | 否 | `semi-auto`（默认）/ `auto` |

### 模式说明

| 模式 | 说明 | 成功后返回 |
|------|------|-----------| 
| `semi-auto` | 登录 + 获取 Google One 链接，不绑卡 | `url`（Partner 链接） |
| `auto` | 登录 + 自动绑卡 + 完成订阅 | `result_msg`（订阅成功） |

### 请求示例

```json
{
  "email": "user@gmail.com",
  "password": "your_password",
  "totp_secret": "JBSWY3DPEHPK3PXP",
  "mode": "semi-auto"
}
```

### 成功响应（进入手机队列）

首次提交或无历史记录时，任务进入手机处理队列：

```json
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued",
  "queue_position": 2,
  "estimated_wait_seconds": 240
}
```

> **`queue_position`** 表示前面还有多少个任务：`0` = 下一个处理，`2` = 前面还有 2 个，`-1` = 不在手机队列（MAC 直接处理中或已结束）。

### 成功响应（auto 模式直接 MAC 绑卡）

`auto` 模式下，若该邮箱之前**绑卡失败并已获取过 Offer URL**，系统跳过手机步骤直接提交 MAC 绑卡。

**MAC 提交成功** — 立即返回 `running`，轮询 `/api/jobs/{id}` 直到 `success` / `failed`：

```json
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running",
  "queue_position": -1,
  "estimated_wait_seconds": 0
}
```

**MAC 服务不可用**（服务未启动、无可用信用卡）— 直接返回 `failed`，不进手机队列，下游可直接确认失败：

```json
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "failed",
  "queue_position": -1,
  "estimated_wait_seconds": 0,
  "error": "CARD_FAILED",
  "result_msg": "MAC 服务提交失败: 没有可用信用卡"
}
```

### 重复提交

已成功处理过的邮箱，返回 HTTP 409 并附带结果：

```json
{
  "code": "already_processed",
  "message": "该邮箱已处理成功",
  "url": "https://one.google.com/partner-eft-onboard/XXXXXXX",
  "result_msg": "订阅成功",
  "created_at": "2026-04-03 19:30:00"
}
```

正在队列中的邮箱，返回 HTTP 409：

```json
{
  "code": "already_queued",
  "message": "该邮箱已在队列中",
  "job_id": "a1b2c3d4-..."
}
```

---

## 3. 查询任务状态

```
GET /api/jobs/{job_id}
```

轮询任务进度。建议每 **5 秒** 轮询一次。

### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `job_id` | string | 任务 ID |
| `email` | string | 邮箱 |
| `status` | string | `queued` / `running` / `success` / `failed` / `cancelled` |
| `mode` | string | `semi-auto` / `auto` |
| `queue_position` | int | 前面还有几个任务（`-1` 表示非排队状态） |
| `estimated_wait_seconds` | int | 预估等待秒数（非排队状态为 0） |
| `stage` | int | 当前阶段（0-6，失败时保留阶段，取消为 -1） |
| `total_stages` | int | 总阶段数（6） |
| `stage_label` | string | 阶段名称 |
| `url` | string | 成功时的链接（semi-auto 模式） |
| `result_msg` | string | 结果描述 |
| `error` | string | 失败时的错误码 |
| `elapsed_seconds` | float | 耗时（秒） |
| `created_at` | string | 创建时间 |

### 阶段说明

| Stage | Label | 说明 |
|-------|-------|------|
| -1 | `CANCELLED` | 已取消 |
| 0 | `QUEUED` | 排队等待 |
| 1 | `PREPARING` | 移除旧账号 + 设备伪装 |
| 2 | `REBOOTING` | 重启 + 缓存清理 |
| 3 | `CONNECTING` | WiFi + VPN 连接 |
| 4 | `LOGIN` | Google 登录 |
| 5 | `SUBSCRIBING` | 获取链接 / 订阅 |
| 6 | `DONE` | 完成 |

### 成功响应

```json
{
  "job_id": "a1b2c3d4-...",
  "email": "user@gmail.com",
  "status": "success",
  "mode": "semi-auto",
  "queue_position": -1,
  "estimated_wait_seconds": 0,
  "stage": 6,
  "total_stages": 6,
  "stage_label": "DONE",
  "url": "https://one.google.com/partner-eft-onboard/8GSA888AD9PPN2SER720",
  "result_msg": "订阅成功",
  "error": "",
  "elapsed_seconds": 95.3,
  "created_at": "2026-04-03 19:30:00"
}
```

### 失败响应

```json
{
  "job_id": "a1b2c3d4-...",
  "email": "user@gmail.com",
  "status": "failed",
  "mode": "semi-auto",
  "queue_position": -1,
  "estimated_wait_seconds": 0,
  "stage": 4,
  "total_stages": 6,
  "stage_label": "LOGIN",
  "url": "",
  "result_msg": "",
  "error": "WRONG_PASSWORD",
  "elapsed_seconds": 42.1,
  "created_at": "2026-04-03 19:30:00"
}
```

---

## 4. 取消任务

```
POST /api/jobs/{job_id}/cancel
```

取消排队中（`queued`）的任务。**正在运行（`running`）的任务无法取消。**

### 成功响应

```json
{
  "success": true,
  "job_id": "a1b2c3d4-...",
  "status": "cancelled"
}
```

### 错误响应

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 404 | `job_not_found` | 任务不存在 |
| 400 | `task_running` | 任务正在运行中，无法取消 |
| 400 | `invalid_status` | 任务非排队状态（如已完成） |

---

## 5. 队列状态

```
GET /api/queue
```

```json
{
  "task_status": "running",
  "current_email": "user@gmail.com",
  "pending_count": 3,
  "completed_today": 8,
  "estimated_seconds_per_job": 120
}
```

---

## 6. 成功历史

```
GET /api/history?limit=50&offset=0
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `limit` | int | 50 | 每页数量（1~200） |
| `offset` | int | 0 | 跳过前 N 条 |

```json
{
  "records": [
    {
      "email": "user@gmail.com",
      "mode": "semi-auto",
      "url": "https://one.google.com/partner-eft-onboard/XXXXXXX",
      "result_msg": "订阅成功",
      "created_at": "2026-04-03 19:30:00"
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

---

## 7. Email 查询结果

```
GET /api/result?email=user@gmail.com
```

按邮箱查询处理结果。

### 成功

```json
{
  "email": "user@gmail.com",
  "status": "success",
  "mode": "semi-auto",
  "url": "https://one.google.com/partner-eft-onboard/XXXXXXX",
  "result_msg": "订阅成功",
  "created_at": "2026-04-03 19:30:00"
}
```

### 失败

```json
{
  "email": "user@gmail.com",
  "status": "failed",
  "mode": "semi-auto",
  "error": "WRONG_PASSWORD",
  "result_msg": "密码错误",
  "created_at": "2026-04-03 19:31:00"
}
```

### 处理中

```json
{
  "email": "user@gmail.com",
  "status": "running",
  "mode": "semi-auto",
  "stage": 4,
  "stage_label": "LOGIN"
}
```

### 未找到

HTTP 404：

```json
{"code": "not_found", "message": "未找到该邮箱的记录"}
```

---

## 8. 批量查询账号结果

```
GET /api/accounts/query?email=user@gmail.com
GET /api/accounts/query?emails=a@gmail.com,b@gmail.com
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `email` | string | 单个邮箱精确匹配 |
| `emails` | string | 逗号分隔的多个邮箱 |

```json
{
  "total": 2,
  "results": {
    "a@gmail.com": {
      "email": "a@gmail.com",
      "status": "success",
      "link": "https://one.google.com/partner-eft-onboard/XXXXXXX",
      "result_msg": "订阅成功",
      "card_used": "card_001",
      "timestamp": "2026-04-03 19:30:00",
      "mode": "semi-auto"
    },
    "b@gmail.com": {
      "email": "b@gmail.com",
      "status": "not_found"
    }
  },
  "global_stats": {
    "accounts_total": 100,
    "accounts_pending": 5,
    "accounts_success": 90,
    "accounts_failed": 5,
    "accounts_skipped": 0,
    "cards_total": 10,
    "cards_active": 8,
    "cards_exhausted": 1,
    "cards_failed": 1,
    "total_binds": 45
  }
}
```

---

## 完整调用流程

```
1. GET  /api/health                  — 检查服务是否正常
2. POST /api/jobs                    — 提交任务 → 获取 job_id
3. GET  /api/jobs/{job_id}           — 每 5 秒轮询直到 success / failed / cancelled
4. POST /api/jobs/{job_id}/cancel    — 可选：取消排队中的任务
5. GET  /api/result?email=...        — 或用 email 直接查结果
```

---

## 错误码

### HTTP 错误

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 401 | `invalid_api_key` | Key 缺失或无效 |
| 403 | — | Key 无效或已禁用 |
| 409 | `already_queued` | 邮箱已在队列中 |
| 409 | `already_processed` | 邮箱已处理（附带结果） |
| 404 | `job_not_found` | 任务 ID 不存在 |
| 404 | `not_found` | 记录不存在 |
| 400 | `invalid_request` | 请求参数错误 |
| 400 | `task_running` | 任务运行中，无法取消 |
| 400 | `invalid_status` | 任务状态不允许此操作 |

### 任务失败错误码（`error` 字段）

| 错误码 | 说明 |
|--------|------|
| `WRONG_PASSWORD` | 密码错误 |
| `TOTP_ERROR` | TOTP 验证码错误 |
| `INVALID_EMAIL` | 邮箱无效（账号不存在） |
| `INVALID_ACCOUNT` | 账号信息有误（手动标记） |
| `ACCOUNT_DISABLED` | 账号已停用 |
| `CAPTCHA` | 遇到人机验证 |
| `OFFER_UNAVAILABLE` | Google One 优惠不可用 |
| `ALREADY_SUBSCRIBED` | 已有订阅 |
| `CARD_FAILED` | 信用卡被拒（auto 模式） |
| `LOGIN_FAILED` | 登录失败 |
| `DEVICE_ERROR` | 设备错误 |
| `NETWORK_ERROR` | WiFi/VPN 连接失败 |
| `MANUAL_CANCEL` | 手动取消（由操作员在 Dashboard 手动标记失败） |
| `INTERNAL_ERROR` | 系统内部错误 |

---

## 注意事项

1. **TOTP 密钥** 必须是 Base32 编码的原始密钥（不是 6 位数字验证码）
2. 同一邮箱处理完成（`success`）后不能重复提交，会返回 409 附带历史结果
3. 失败（`failed`）的邮箱可重新提交，系统会创建新任务
4. 重复提交已处理的邮箱会返回之前的结果，可用于找回链接
5. `semi-auto` 模式只获取链接不绑卡，`auto` 模式会自动绑卡完成订阅
6. 系统支持多设备并行处理，`task_status: standby` 表示服务在线等待任务
7. `cancelled` 状态表示任务被用户或系统主动取消，非处理失败
