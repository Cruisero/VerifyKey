import { useState } from 'react';
import './ApiDocs.css';

const API_BASE_URL = 'https://onepass.fun';

const ENDPOINTS = [
    {
        group: '🔐 用户认证',
        items: [
            {
                method: 'POST',
                path: '/api/auth/register',
                desc: '用户注册',
                params: [
                    { name: 'email', type: 'string', required: true, desc: '邮箱地址' },
                    { name: 'password', type: 'string', required: true, desc: '密码' },
                    { name: 'username', type: 'string', required: false, desc: '用户名（默认取邮箱前缀）' },
                    { name: 'inviteCode', type: 'string', required: false, desc: '邀请码' },
                ],
                response: `{
  "success": true,
  "token": "eyJhbGci...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "user",
    "credits": 0,
    "role": "user"
  }
}`,
            },
            {
                method: 'POST',
                path: '/api/auth/login',
                desc: '用户登录',
                params: [
                    { name: 'email', type: 'string', required: true, desc: '邮箱地址' },
                    { name: 'password', type: 'string', required: true, desc: '密码' },
                ],
                response: `{
  "success": true,
  "token": "eyJhbGci...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "user",
    "credits": 10.0,
    "role": "user"
  }
}`,
            },
            {
                method: 'GET',
                path: '/api/auth/me',
                desc: '获取当前用户信息与余额',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {token}' },
                ],
                response: `{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "user",
    "credits": 10.0,
    "role": "user"
  }
}`,
            },
        ],
    },
    {
        group: '💳 CDK 积分管理',
        items: [
            {
                method: 'POST',
                path: '/api/cdk/validate',
                desc: '验证 CDK 卡密有效性与额度',
                params: [
                    { name: 'code', type: 'string', required: true, desc: 'CDK 激活码' },
                ],
                response: `{
  "valid": true,
  "remaining": 5.0,
  "total": 5.0,
  "used": 0.0,
  "note": "CDK充值码"
}`,
            },
            {
                method: 'POST',
                path: '/api/cdk/redeem',
                desc: '兑换 CDK 积分到账户余额',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {token}' },
                    { name: 'code', type: 'string', required: true, desc: 'CDK 激活码' },
                ],
                response: `{
  "success": true,
  "credits_added": 5.0,
  "new_balance": 15.0,
  "message": "兑换成功，获得 5.0 积分"
}`,
            },
        ],
    },
    {
        group: '📡 Gemini 验证服务 (UPixel)',
        items: [
            {
                method: 'POST',
                path: '/api/pixel/jobs',
                desc: '提交 Gemini 验证任务',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {token}' },
                    { name: 'email', type: 'string', required: true, desc: 'Google 账号邮箱' },
                    { name: 'password', type: 'string', required: true, desc: '账号密码' },
                    { name: 'totp_secret', type: 'string', required: true, desc: '2FA TOTP 密钥（Base32 编码）' },
                    { name: 'mode', type: 'string', required: false, desc: '验证模式：semi-auto (普通验证，扣1.0积分) / auto (高级验证，扣2.0积分)，默认为 semi-auto' },
                    { name: 'priority', type: 'number', required: false, desc: '任务优先级（默认 0）' },
                ],
                response: `{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued",
  "queue_position": 2,
  "estimated_wait_seconds": 240
}`,
            },
            {
                method: 'GET',
                path: '/api/pixel/jobs/{job_id}',
                desc: '查询验证任务处理进度与状态',
                params: [
                    { name: 'job_id', type: 'string', required: true, desc: '任务 ID（URL 路径参数）' },
                ],
                response: `{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "success",
  "url": "https://one.google.com/partner-eft-onboard/XXXXXXX",
  "queue_position": -1,
  "estimated_wait_seconds": 0
}`,
            },
            {
                method: 'POST',
                path: '/api/pixel/jobs/{job_id}/cancel',
                desc: '取消排队中 (queued) 的验证任务 (取消成功将全额退还积分)',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {token}' },
                    { name: 'job_id', type: 'string', required: true, desc: '任务 ID（URL 路径参数）' },
                ],
                response: `{
  "success": true,
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "cancelled"
}`,
            },
            {
                method: 'GET',
                path: '/api/pixel/health',
                desc: 'UPixel 验证服务健康检查',
                params: [],
                response: `{
  "status": "ok",
  "api_key_configured": true,
  "base_url": "https://api.example.com"
}`,
            },
            {
                method: 'GET',
                path: '/api/pixel/balance',
                desc: '查询 UPixel 底层运行余额',
                params: [],
                response: `{
  "balance": 150.0,
  "currency": "CNY"
}`,
            },
        ],
    },
];

const CREDITS_TABLE = [
    { service: 'UPixel 普通验证 (semi-auto)', cost: '-1.0 积分' },
    { service: 'UPixel 高级验证 (auto)', cost: '-2.0 积分' },
];

const ERROR_CODES = [
    { code: 400, desc: '请求参数错误' },
    { code: 401, desc: '未登录或 Token 过期' },
    { code: 403, desc: '权限不足（账号被禁用等）' },
    { code: 404, desc: '资源不存在' },
    { code: 429, desc: '请求过于频繁' },
    { code: 500, desc: '服务器内部错误' },
    { code: 502, desc: '上游服务不可用' },
    { code: 503, desc: '服务未启用或处于维护状态' },
];

const FULL_EXAMPLE = `import requests

BASE = "${API_BASE_URL}"

# 1. 登录获取 Token
login = requests.post(f"{BASE}/api/auth/login", json={
    "email": "user@example.com",
    "password": "your_password"
}).json()
token = login["token"]
headers = {"Authorization": f"Bearer {token}"}

# 2. 查看当前积分
me = requests.get(f"{BASE}/api/auth/me", headers=headers).json()
print(f"当前积分: {me['user']['credits']}")

# 3. 兑换 CDK 积分
redeem = requests.post(f"{BASE}/api/cdk/redeem", 
    json={"code": "CDK-XXXXXXXX"},
    headers=headers
).json()
print(f"兑换成功，新余额: {redeem['new_balance']}")

# 4. 提交 Gemini 验证任务 (普通验证)
job = requests.post(f"{BASE}/api/pixel/jobs", json={
    "email": "google@gmail.com",
    "password": "google_password",
    "totp_secret": "JBSWY3DPEHPK3PXP",
    "mode": "semi-auto"
}, headers=headers).json()
print(f"任务已提交: {job['job_id']}")

# 5. 轮询状态 (查询状态接口不需要携带 Token)
import time
while True:
    status = requests.get(
        f"{BASE}/api/pixel/jobs/{job['job_id']}"
    ).json()
    print(f"  状态: {status['status']}")
    if status["status"] in ("success", "failed"):
        if status["status"] == "success":
            print(f"  验证成功，优惠链接: {status.get('url')}")
        else:
            print(f"  验证失败，原因: {status.get('error')}")
        break
    time.sleep(5)`;

export default function ApiDocs() {
    const [expanded, setExpanded] = useState({});

    const toggle = (key) => {
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    return (
        <div className="api-docs">
            {/* Hero */}
            <div className="api-hero">
                <h1>OnePass API 文档</h1>
                <p className="api-subtitle">
                    通过 API 管理用户认证、积分兑换、Gemini 验证、ChatGPT 充值等服务。
                </p>
                <div className="api-base-url">
                    Base URL: <code>{API_BASE_URL}</code>
                </div>
            </div>

            {/* Flow */}
            <h3 className="api-section-title">调用流程</h3>
            <div className="api-flow">
                <div className="flow-step">
                    <span className="step-num">1</span>
                    <span className="step-label">注册 / 登录</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">2</span>
                    <span className="step-label">兑换 CDK 积分</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">3</span>
                    <span className="step-label">提交验证</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">4</span>
                    <span className="step-label">轮询状态</span>
                </div>
            </div>

            {/* Credits info */}
            <div className="api-info-banner">
                所有服务使用积分支付。新用户默认 0 积分，需通过 CDK 兑换或邀请好友获取。
            </div>

            {/* Credits Table */}
            <h3 className="api-section-title">积分消耗</h3>
            <table className="rate-limit-table">
                <thead>
                    <tr>
                        <th>服务</th>
                        <th>积分消耗</th>
                    </tr>
                </thead>
                <tbody>
                    {CREDITS_TABLE.map((r, i) => (
                        <tr key={i}>
                            <td>{r.service}</td>
                            <td><code style={{ color: r.cost.startsWith('+') ? '#10b981' : '#ef4444' }}>{r.cost}</code></td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Endpoint Groups */}
            {ENDPOINTS.map((group) => (
                <div className="endpoint-group" key={group.group}>
                    <h3 className="api-section-title">{group.group}</h3>
                    {group.items.map((ep) => {
                        const key = ep.method + ep.path;
                        const isOpen = expanded[key];
                        return (
                            <div key={key}>
                                <div
                                    className={`endpoint-card ${isOpen ? 'expanded' : ''}`}
                                    onClick={() => toggle(key)}
                                >
                                    <span className={`method-badge ${ep.method.toLowerCase()}`}>
                                        {ep.method}
                                    </span>
                                    <span className="endpoint-path">{ep.path}</span>
                                    <span className="endpoint-desc">
                                        {ep.desc} <span className="chevron">›</span>
                                    </span>
                                </div>
                                {isOpen && (
                                    <div className="endpoint-details">
                                        {ep.params.length > 0 && (
                                            <>
                                                <h5>请求参数</h5>
                                                <table className="param-table">
                                                    <thead>
                                                        <tr>
                                                            <th>参数</th>
                                                            <th>类型</th>
                                                            <th>必填</th>
                                                            <th>说明</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {ep.params.map((p) => (
                                                            <tr key={p.name}>
                                                                <td><code>{p.name}</code></td>
                                                                <td><code>{p.type}</code></td>
                                                                <td>
                                                                    {p.required
                                                                        ? <span className="param-required">必填</span>
                                                                        : <span className="param-optional">可选</span>}
                                                                </td>
                                                                <td>{p.desc}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </>
                                        )}
                                        <h5>响应示例</h5>
                                        <div className="api-code-block">
                                            <span className="code-lang">JSON</span>
                                            <pre>{ep.response}</pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}

            {/* Error Codes */}
            <h3 className="api-section-title">错误码参考</h3>
            <table className="error-table">
                <thead>
                    <tr>
                        <th>状态码</th>
                        <th>说明</th>
                    </tr>
                </thead>
                <tbody>
                    {ERROR_CODES.map((e) => (
                        <tr key={e.code}>
                            <td><code>{e.code}</code></td>
                            <td>{e.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Auth Info */}
            <h3 className="api-section-title">认证方式</h3>
            <div className="api-info-banner">
                需要认证的接口请在请求头中携带 <code>Authorization: Bearer {'<token>'}</code>。
                Token 通过 <code>/api/auth/login</code> 或 <code>/api/auth/register</code> 获取。
                Token 有效期 7 天，过期后需重新登录。
            </div>

            {/* Full Example */}
            <div className="full-example">
                <h3 className="api-section-title">完整调用示例</h3>
                <div className="api-code-block">
                    <span className="code-lang">PYTHON</span>
                    <pre>{FULL_EXAMPLE}</pre>
                </div>
            </div>
        </div>
    );
}
