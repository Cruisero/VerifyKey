# OnePass API 开发者文档

> **Base URL**: `https://onepass.fun` (或本地/内网服务地址，例如 `http://192.168.5.31:3003`)
> **版本**: v2.0
> **最后更新**: 2026-09-12

欢迎使用 OnePass 自动化服务平台开放接口。本平台对外提供统一的标准 RESTful API，供商户、分销商与大客户进行批量自动化账号验证、SheerID 零凭据认证及 ChatGPT 官方邀请与充值对接。

---

## 认证方式

所有受保护接口须在 HTTP 请求头中携带 Bearer Token 凭证：

```http
Authorization: Bearer <your_access_token>
```

> **如何获取 Token？**
> 请登录平台管理后台，在商户控制台中获取您专属的永久静态 API Token，或联系管理员开通分配。该 Token 具有商户全部调用权限，请妥善保管。

---

## 调用流程说明

```
1. 配置 Token                       --> 将商户永久 Token 配置到请求头 Authorization 中
2. 查询商户余额 (GET /api/auth/me)   --> 查询积分是否充足，若不足请充值或联系管理员
3. 提交任务 (POST /api/pixel/jobs)   --> 开启验证，选择模式，扣除积分，获取 job_id
4. 轮询结果 (GET /api/pixel/jobs/{id}) --> 免 Token 每 5 秒轮询直到终态 (success/failed/cancelled)
```

---

## 接口列表

### 1. 商户信息与余额

#### 1.1 查询商户余额与状态
* **请求方法**: `GET`
* **路径**: `/api/auth/me`
* **请求头**: `Authorization: Bearer <token>`
* **成功响应 (200)**:
  ```json
  {
    "user": {
      "id": 1,
      "email": "merchant@example.com",
      "username": "merchant",
      "credits": 100.0,
      "role": "user",
      "created_at": "2026-01-01T00:00:00Z"
    }
  }
  ```

---

### 2. Gemini 验证服务 (UPixel)

#### 2.1 提交验证 / 认证任务
* **请求方法**: `POST`
* **路径**: `/api/pixel/jobs`
* **请求头**: `Authorization: Bearer <token>`
* **请求体 (JSON)**:

**方式 A: Google 账号密码验证模式**
```json
{
  "email": "user@gmail.com",
  "password": "your_password",
  "totp_secret": "JBSWY3DPEHPK3PXP", // 2FA TOTP 密钥 (Base32 编码)
  "mode": "semi-auto", // semi-auto (普通验证，扣1分) / auto (高级验证，扣2分) / jio (极速订阅，扣2分) / 3-Month (3-Month 订阅，扣2分)
  "priority": 0 // 优先级 (可选，默认 0)
}
```

**方式 B: SheerID 零凭据认证模式 (学生/教师认证)**
```json
{
  "url": "https://services.sheerid.com/verify/67c8b9.../?verificationId=67c8ba...", // 包含 verificationId 的完整验证链接
  "mode": "sheerid", // 固定设为 sheerid (扣除 3 分)
  "priority": 0
}
```

* **普通验证 (semi-auto) 扣减 1.0 积分**：登录 Google 账号获取 Google One 优惠链接，不执行自动绑卡。任务成功后返回 `url`。
* **高级验证 (auto) 扣减 2.0 积分**：登录 + 自动绑卡 + 完成订阅。任务成功后返回 `result_msg: "订阅成功"`。
* **极速订阅 (jio) 扣减 2.0 积分**：登录 + 自动免卡升级订阅流程。任务成功后返回 `result_msg: "激活成功"`。
* **3-Month 订阅 (3-Month) 扣减 2.0 积分**：自动分配 3-Month 优惠试用链接 + 信用卡自动订阅。任务成功后返回 `result_msg: "3-Month 订阅成功"`。
* **SheerID 认证 (sheerid) 扣减 3.0 积分**：零凭据认证，无需邮箱、密码和 2FA，提交后直接排队进入人工处理队列；若被取消或审核失败自动全额退还积分。任务成功后返回 `result_msg: "SheerID 认证成功"`。

* **成功响应 (进入处理队列)**:
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "queued",
    "queue_position": 2,
    "estimated_wait_seconds": 240
  }
  ```

* **重复提交与幂等性保护**:
  已处理成功的账号或 SheerID 链接，若重复提交，将直接返回 200 及历史成功结果（**不重复扣减积分**）：
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "success",
    "queue_position": -1,
    "estimated_wait_seconds": 0
  }
  ```

#### 2.2 查询任务状态与结果
* **请求方法**: `GET`
* **路径**: `/api/pixel/jobs/{job_id}`
* **请求头**: 无需鉴权（通过 `job_id` 直接查询，便于客户端或轮询脚本直接调用）
* **成功响应 (处理中)**:
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "running",
    "stage_label": "人工审核中",
    "queue_position": -1,
    "estimated_wait_seconds": 0
  }
  ```
* **成功响应 (已完成 - 普通验证)**:
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "success",
    "url": "https://one.google.com/partner-eft-onboard/XXXXXXX",
    "queue_position": -1,
    "estimated_wait_seconds": 0
  }
  ```
* **成功响应 (已完成 - 高级验证 / SheerID 认证)**:
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "success",
    "result_msg": "SheerID 认证成功",
    "url": "",
    "queue_position": -1,
    "estimated_wait_seconds": 0
  }
  ```
* **失败响应**:
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "failed",
    "error": "❌ 密码错误",
    "queue_position": -1,
    "estimated_wait_seconds": 0
  }
  ```
  *(注：任务失败时，系统会自动将预扣的积分原路 100% 全额自动返还到商户账户。)*

#### 2.3 反向结果查询 (按 URL / Verification ID / 邮箱)
* **请求方法**: `GET`
* **路径**: `/api/result?url=<sheerid_url>` 或 `/api/result?verification_id=<vid>` 或 `/api/result?email=<email>`
* **请求头**: 可选携带 `Authorization: Bearer <token>`
* **成功响应 (200)**:
  ```json
  {
    "found": true,
    "status": "success",
    "url": "https://services.sheerid.com/verify/.../?verificationId=...",
    "created_at": "2026-09-12 18:30:00"
  }
  ```

#### 2.4 取消任务
* **请求方法**: `POST`
* **路径**: `/api/pixel/jobs/{job_id}/cancel`
* **请求头**: `Authorization: Bearer <token>`
* **成功响应**:
  ```json
  {
    "success": true,
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "cancelled"
  }
  ```
  *(注: 仅处于 `queued` 排队状态的任务可被取消。取消成功后，预扣积分将即时退还。)*

#### 2.5 检查服务状态与业务配额
* **健康检查**: `GET /api/pixel/health`
* **配额查询**: `GET /api/pixel/quota` (需要 `Authorization: Bearer <token>`)
  ```json
  {
    "code": 200,
    "data": {
      "key_name": "MerchantKey",
      "quotas": {
        "auto": { "total": 100, "used": 20, "remaining": 80 },
        "jio": { "total": 50, "used": 10, "remaining": 40 },
        "3-Month": { "total": 50, "used": 5, "remaining": 45 },
        "sheerid": { "total": 20, "used": 2, "remaining": 18 }
      }
    }
  }
  ```

---

### 3. ChatGPT 服务接口

#### 3.1 ChatGPT Team 官方邀请
* **请求方法**: `POST`
* **路径**: `/api/gpt/team-invite`
* **请求头**: `Authorization: Bearer <token>`
* **请求体 (JSON)**:
  ```json
  {
    "email": "user@example.com"
  }
  ```
* **积分消耗**: **-0.6 积分**（零凭据直发邀请邮件，失败自动全额退款）
* **成功响应 (200)**:
  ```json
  {
    "success": true,
    "email": "user@example.com",
    "team_id": 1,
    "team_name": "Pro Team 01",
    "message": "Team 邀请已发送（admin@openai.com / Pro Team 01）"
  }
  ```

#### 3.2 ChatGPT Plus 充值
* **请求方法**: `POST`
* **路径**: `/api/gpt/recharge`
* **请求头**: `Authorization: Bearer <token>`
* **请求体 (JSON)**:
  ```json
  {
    "email": "user@example.com",
    "account": "{\"accessToken\":\"...\",\"user\":{\"email\":\"user@example.com\"}}",
    "channel": "api"
  }
  ```
* **积分消耗**: **-3.0 积分**（失败自动全额退款）
* **成功响应 (200)**:
  ```json
  {
    "success": true,
    "vid": "gpt_1726140000_user",
    "status": "success",
    "message": "ChatGPT Plus 充值成功"
  }
  ```

---

### 4. 历史与订单记录

#### 4.1 获取商户历史记录
* **请求方法**: `GET`
* **路径**: `/api/user/verify-history`
* **请求头**: `Authorization: Bearer <token>`
* **成功响应 (200)**:
  ```json
  {
    "history": [
      {
        "id": 101,
        "type": "pixel",
        "status": "pass",
        "email": "sheerid_67c8ba123456",
        "message": "SheerID 认证成功",
        "url": "https://services.sheerid.com/verify/...",
        "timestamp": "2026-09-12T20:45:00Z"
      },
      {
        "id": 100,
        "type": "pixel",
        "status": "failed",
        "email": "user@gmail.com",
        "message": "3-Month 订阅失败: 链接已失效",
        "url": "",
        "timestamp": "2026-09-05T13:36:00Z"
      },
      {
        "id": "gptteam_45",
        "type": "gpt",
        "subtype": "team",
        "status": "pass",
        "email": "gptuser@example.com",
        "message": "Team 邀请已发送（admin@openai.com / Team A）",
        "timestamp": "2026-09-01T10:20:00Z"
      }
    ]
  }
  ```

---

## 积分消耗对照表

| 业务服务名称 | 积分消耗 | 零凭据要求 | 说明与交付形式 |
| :--- | :--- | :---: | :--- |
| **UPixel 普通验证 (semi-auto)** | **-1.0 积分** | 否 | 登录 Google 账号获取 Google One 优惠链接，不自动绑卡 |
| **UPixel 高级验证 (auto)** | **-2.0 积分** | 否 | 登录 + 自动绑卡 + 确认订阅 |
| **Gemini 极速订阅 (jio)** | **-2.0 积分** | 否 | 免卡自动升级订阅流程 |
| **Gemini 3-Month 订阅 (3-Month)** | **-2.0 积分** | 否 | 自动分配 3-Month 优惠试用链接 + 信用卡自动订阅 |
| **SheerID 认证 (sheerid)** | **-3.0 积分** | **是** | 零凭据，仅需 verificationId 链接，审核失败/取消全额退款 |
| **ChatGPT Team 官方邀请 (gpt_team)** | **-0.6 积分** | **是** | 直发官方 Team 邀请邮件，无需密码，失败全额退款 |
| **ChatGPT Plus 充值 (gpt_plus)** | **-3.0 积分** | 否 | ChatGPT Plus 订阅直充，失败自动退还积分 |

---

## 错误码参考

| HTTP 状态码 | 说明与排查建议 |
| :---: | :--- |
| **200** | 请求成功 |
| **400** | 请求参数错误，或商户账户积分不足 |
| **401** | 未携带 Token、Token 格式错误或 Token 已过期 |
| **403** | 权限不足（账号已被禁用或非管理员访问受限资源） |
| **404** | 资源不存在（Job ID 不存在或链接无效） |
| **429** | 请求过于频繁，触发接口访问限流 |
| **500** | 服务器内部错误 |
| **502** | 上游服务网关不可用 |
| **503** | 对应验证服务未启用或处于维护下架状态 |

---

## 完整调用示例 (Python 3)

```python
import requests
import time

BASE_URL = "https://onepass.fun"  # 或您的自建服务地址
TOKEN = "your_static_api_token"
headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

# 1. 查看商户可用积分余额
me = requests.get(f"{BASE_URL}/api/auth/me", headers=headers).json()
print(f"当前商户可用积分: {me['user']['credits']}")

# 2. 提交任务 (以 SheerID 零凭据认证为例)
job = requests.post(f"{BASE_URL}/api/pixel/jobs", json={
    "url": "https://services.sheerid.com/verify/67c8b9.../?verificationId=67c8ba...",
    "mode": "sheerid"
}, headers=headers).json()
print(f"任务已提交, Job ID: {job['job_id']}")

# 3. 轮询任务状态 (查询接口无需携带 Token)
job_id = job["job_id"]
while True:
    status_res = requests.get(f"{BASE_URL}/api/pixel/jobs/{job_id}").json()
    status = status_res.get("status")
    print(f"  当前状态: {status}")

    if status in ("success", "failed", "cancelled"):
        if status == "success":
            print(f"✅ 任务成功: {status_res.get('result_msg') or status_res.get('url')}")
        else:
            print(f"❌ 任务失败: {status_res.get('error')} (预扣积分已自动返还)")
        break
    time.sleep(5)
```
