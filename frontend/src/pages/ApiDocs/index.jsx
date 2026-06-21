import { useState } from 'react';
import './ApiDocs.css';

const API_BASE_URL = 'https://onepass.fun';

const ENDPOINTS = [
    {
        group: '🔑 鉴权与商户余额',
        items: [
            {
                method: 'GET',
                path: '/api/auth/me',
                desc: '查询商户账户余额与状态',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {token}' },
                ],
                response: `{
  "user": {
    "id": 1,
    "email": "merchant@example.com",
    "username": "merchant",
    "credits": 100.0,
    "role": "user"
  }
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
                requestBody: `{
  "email": "user@example.com",
  "password": "your_password",
  "totp_secret": "JBSWY3DPEHPK3PXP",
  "mode": "semi-auto"
}`,
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

# 1. 配置商户永久 Token (在后台生成)
TOKEN = "your_static_api_token"
headers = {"Authorization": f"Bearer {TOKEN}"}

# 2. 查看商户积分余额
me = requests.get(f"{BASE}/api/auth/me", headers=headers).json()
print(f"当前商户积分余额: {me['user']['credits']}")

# 3. 提交 Gemini 验证任务 (普通验证)
job = requests.post(f"{BASE}/api/pixel/jobs", json={
    "email": "google@gmail.com",
    "password": "google_password",
    "totp_secret": "JBSWY3DPEHPK3PXP",
    "mode": "semi-auto"
}, headers=headers).json()
print(f"任务已提交: {job['job_id']}")

# 4. 轮询状态 (查询状态接口不需要携带 Token)
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
                    通过 API 进行商户余额查询与 Gemini 自动化验证 (UPixel) 服务对接。
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
                    <span className="step-label">配置 API Token</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">2</span>
                    <span className="step-label">确认商户余额</span>
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
                所有验证服务使用账户内的积分支付。新账户默认 0 积分，请在网页端充值或由管理员直接为您划转积分。
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
                                        {(() => {
                                            const headerParams = ep.params.filter(p => p.type === 'Header');
                                            if (headerParams.length > 0) {
                                                const headersText = headerParams.map(p => {
                                                    if (p.name === 'Authorization') {
                                                        return 'Authorization: Bearer your_static_api_token';
                                                    }
                                                    return `${p.name}: your_value`;
                                                }).join('\n') + (ep.requestBody ? '\nContent-Type: application/json' : '');
                                                return (
                                                    <>
                                                        <h5>请求头示例 (Headers)</h5>
                                                        <div className="api-code-block" style={{ marginBottom: '16px' }}>
                                                            <span className="code-lang">HTTP</span>
                                                            <pre>{headersText}</pre>
                                                        </div>
                                                    </>
                                                );
                                            }
                                            return null;
                                        })()}
                                        {ep.requestBody && (
                                            <>
                                                <h5>请求示例 (Body)</h5>
                                                <div className="api-code-block" style={{ marginBottom: '16px' }}>
                                                    <span className="code-lang">JSON</span>
                                                    <pre>{ep.requestBody}</pre>
                                                </div>
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
                Token 可以联系平台管理员为您开通账号并获取专属的静态 API Token。
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
