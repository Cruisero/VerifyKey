# OnePASS API 文档

> **Base URL**: `https://onepass.fun`
> **最后更新**: 2026-06-21

欢迎使用 OnePASS 自动化验证接口。本平台对外提供统一的 B2B API，供分销商与大客户进行批量自动化账号验证。

---

## 认证方式

所有受保护接口须在请求头中携带 JWT Token 凭证：

```http
Authorization: Bearer <your_access_token>
```

> **如何获取 Token？**
> 请登录商户管理后台，在个人中心生成或获取您专属的静态 API Token。

---

## 调用流程说明

```
1. 配置 Token                       --> 将商户永久 Token 配置到请求头 Authorization 中
2. 查询商户余额 (GET /api/auth/me)   --> 查询积分是否充足，若不足请在网页端充值或联系管理员
3. 提交任务 (POST /api/pixel/jobs)   --> 开启验证，选择模式，扣除积分，获取 job_id
4. 轮询结果 (GET /api/pixel/jobs/{id}) --> 每 5 秒轮询直到 terminal 状态 (success/failed)
```

---

## 接口列表

### 1. 商户余额与状态查询

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
      "role": "user"
    }
  }
  ```

---

### 3. Gemini 验证服务 (UPixel)

#### 3.1 提交验证任务
* **请求方法**: `POST`
* **路径**: `/api/pixel/jobs`
* **请求头**: `Authorization: Bearer <token>`
* **请求体 (JSON)**:
  ```json
  {
    "email": "user@gmail.com",
    "password": "your_password",
    "totp_secret": "JBSWY3DPEHPK3PXP", // 2FA TOTP 密钥 (Base32 编码)
    "mode": "semi-auto", // semi-auto (普通验证，扣1分) 或 auto (高级验证，扣2分)
    "priority": 0 // 优先级 (可选，默认0)
  }
  ```

* **普通验证 (semi-auto) 扣减 1.0 积分**：登录 Google 账号获取 Google One 优惠链接，不执行绑卡。任务成功后返回 `url`。
* **高级验证 (auto) 扣减 2.0 积分**：登录 + 自动绑卡 + 完成订阅。任务成功后返回 `result_msg`。

* **成功响应 (进入处理队列)**:
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "queued",
    "queue_position": 2,
    "estimated_wait_seconds": 240
  }
  ```

* **重复提交**:
  已处理成功的邮箱，若重复提交，将返回 200 及原成功结果（不重复扣分）：
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "success",
    "queue_position": -1,
    "estimated_wait_seconds": 0
  }
  ```

#### 3.2 查询任务状态
* **请求方法**: `GET`
* **路径**: `/api/pixel/jobs/{job_id}`
* **请求头**: 无需鉴权（通过 job_id 直接访问）
* **成功响应 (处理中)**:
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "running",
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
* **成功响应 (已完成 - 高级验证)**:
  ```json
  {
    "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "success",
    "url": "", // 高级验证无订阅链接，直接完成订阅
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
  *(任务失败时，系统会自动将扣除的积分全额原路退回到提交者的用户余额中。)*

#### 3.3 取消任务
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
  *(注: 仅处于 `queued` 排队状态的任务可被取消。已开始运行 `running` 的任务无法取消。取消成功后，积分将即时退还。)*

#### 3.4 检查服务状态
* **请求方法**: `GET`
* **路径**: `/api/pixel/health`
* **成功响应 (200)**:
  ```json
  {
    "status": "ok",
    "api_key_configured": true,
    "base_url": "https://api.example.com"
  }
  ```

#### 3.5 检查 API 余额
* **请求方法**: `GET`
* **路径**: `/api/pixel/balance`
* **成功响应 (200)**:
  ```json
  {
    "balance": 150.0,
    "currency": "CNY"
  }
  ```

---

## 积分消耗对照表

| 验证服务类型 | 积分消耗 | 说明 |
| :--- | :--- | :--- |
| **UPixel 普通验证 (semi-auto)** | **-1.0 积分** | 登录并生成 Partner 优惠链接，由人工/下游进行后续绑定 |
| **UPixel 高级验证 (auto)** | **-2.0 积分** | 自动完成登录、绑卡、确认订阅全套流程 |
