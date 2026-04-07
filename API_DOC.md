# AutoPixel API 文档

> **Base URL**: `https://auto.onepass.fun`
> **最后更新**: 2026-04-03

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
| `GET` | `/api/queue` | 是 | 队列状态 |
| `GET` | `/api/history` | 是 | 成功历史 |
| `GET` | `/api/result` | 是 | Email 查询结果 |

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
| `mode` | string | 否 | `semi-auto`（默认）获取链接 / `auto` 全自动订阅 |

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

### 成功响应

```json
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued",
  "queue_position": 1,
  "estimated_wait_seconds": 120
}
```

### 重复提交

已成功处理过的邮箱，返回 HTTP 409 并附带结果：

```json
{
  "code": "already_processed",
  "message": "该邮箱已处理成功",
  "url": "https://one.google.com/partner-eft-onboard/XXXXXXX",
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
| `status` | string | `queued` / `running` / `success` / `failed` |
| `mode` | string | `semi-auto` / `auto` |
| `stage` | int | 当前阶段（0-6） |
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

## 4. 队列状态

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

## 5. 成功历史

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

## 6. Email 查询结果

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

## 完整调用流程

```
1. GET  /api/health             — 检查服务是否正常
2. POST /api/jobs               — 提交任务 → 获取 job_id
3. GET  /api/jobs/{job_id}      — 每 5 秒轮询直到 success / failed
4. GET  /api/result?email=...   — 或用 email 直接查结果
```

---

## 错误码

### HTTP 错误

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 401 | `invalid_api_key` | Key 缺失或无效 |
| 409 | `already_queued` | 邮箱已在队列中 |
| 409 | `already_processed` | 邮箱已处理（附带结果） |
| 404 | `job_not_found` | 任务 ID 不存在 |
| 404 | `not_found` | 记录不存在 |
| 400 | `invalid_request` | 请求参数错误 |

### 任务失败错误码

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
2. 同一邮箱处理完成前不能重复提交
3. 重复提交已处理的邮箱会返回之前的结果，可用于找回链接
4. `semi-auto` 模式只获取链接不绑卡，`auto` 模式会自动绑卡完成订阅
5. 系统为单设备串行处理，每个任务约需 1-2 分钟
