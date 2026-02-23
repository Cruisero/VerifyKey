import { useState } from 'react';
import { useLanguage } from '../../stores/LanguageContext';
import './ApiDocs.css';

const API_BASE_URL = 'https://onepass.fun';

const ENDPOINTS = [
    {
        group: '验证接口',
        items: [
            {
                method: 'POST',
                path: '/api/v1/verify',
                desc: '提交单个验证',
                params: [
                    { name: 'verificationId', type: 'string', required: true, desc: 'SheerID 验证 ID' },
                    { name: 'cdk', type: 'string', required: true, desc: 'CDK 激活码' },
                ],
                response: `{
  "taskId": "uuid-xxxx-xxxx",
  "verificationId": "abc123",
  "status": "pending",
  "message": "Verification task created"
}`,
            },
            {
                method: 'POST',
                path: '/api/v1/verify/batch',
                desc: '批量提交验证',
                params: [
                    { name: 'verificationIds', type: 'string[]', required: true, desc: '验证 ID 列表（最多10个）' },
                    { name: 'cdk', type: 'string', required: true, desc: 'CDK 激活码' },
                ],
                response: `{
  "tasks": [
    { "taskId": "uuid-1", "verificationId": "id1", "status": "pending" },
    { "taskId": "uuid-2", "verificationId": "id2", "status": "pending" }
  ],
  "total": 2,
  "message": "2 verification tasks created"
}`,
            },
        ],
    },
    {
        group: '任务管理',
        items: [
            {
                method: 'GET',
                path: '/api/v1/status/{task_id}',
                desc: '查询任务状态',
                params: [
                    { name: 'task_id', type: 'string', required: true, desc: '任务 ID（URL 参数）' },
                ],
                response: `{
  "taskId": "uuid-xxxx",
  "verificationId": "abc123",
  "status": "approved",
  "completed": true,
  "success": true,
  "error": null,
  "redirectUrl": "https://...",
  "createdAt": "2026-02-23T12:00:00",
  "completedAt": "2026-02-23T12:01:30"
}`,
            },
        ],
    },
    {
        group: 'CDK 额度',
        items: [
            {
                method: 'GET',
                path: '/api/v1/cdk/status',
                desc: '查询 CDK 余额',
                params: [
                    { name: 'cdk', type: 'string', required: true, desc: 'CDK 激活码（query 参数或 X-CDK-Key Header）' },
                ],
                response: `{
  "code": "CDK-...XXXX",
  "total_uses": 100,
  "remaining_uses": 87,
  "used_uses": 13,
  "valid": true
}`,
            },
        ],
    },
    {
        group: '系统状态',
        items: [
            {
                method: 'GET',
                path: '/api/v1/health',
                desc: '健康检查',
                params: [],
                response: `{
  "status": "ok",
  "provider": "getgem",
  "version": "1.0.0",
  "timestamp": "2026-02-23T12:00:00"
}`,
            },
        ],
    },
];

const RATE_LIMITS = [
    { path: '/api/v1/verify, /api/v1/verify/batch', limit: '100 次/IP', window: '60 秒' },
    { path: '/api/v1/status/{id}', limit: '20 次/task_id', window: '60 秒' },
    { path: '/api/v1/health', limit: '60 次/IP', window: '60 秒' },
    { path: '/api/v1/cdk/status', limit: '60 次/IP', window: '60 秒' },
];

const ERROR_CODES = [
    { code: 400, desc: '请求参数错误' },
    { code: 401, desc: '缺少 CDK 认证' },
    { code: 403, desc: 'CDK 无效或额度不足' },
    { code: 404, desc: '任务不存在' },
    { code: 429, desc: '请求过于频繁（限流）' },
    { code: 500, desc: '服务器内部错误' },
];

const FULL_EXAMPLE = `import requests
import time

BASE = "${API_BASE_URL}"
CDK = "CDK-XXXXXXXXXXXXXXXX"

# 1. 检查 CDK 余额
cdk_info = requests.get(f"{BASE}/api/v1/cdk/status", params={"cdk": CDK}).json()
print(f"CDK 剩余: {cdk_info['remaining_uses']}")

# 2. 提交验证
resp = requests.post(f"{BASE}/api/v1/verify", json={
    "verificationId": "your-verification-id",
    "cdk": CDK
}).json()
task_id = resp["taskId"]
print(f"Task: {task_id}")

# 3. 轮询状态
interval = 5
while True:
    r = requests.get(f"{BASE}/api/v1/status/{task_id}")
    if r.status_code == 429:
        interval = min(interval * 2, 30)
        time.sleep(interval)
        continue
    status = r.json()
    print(f"  [{status['status']}]")
    if status["completed"]:
        if status["success"]:
            print(f"✅ {status['redirectUrl']}")
        else:
            print(f"❌ {status['error']}")
        break
    interval = 5
    time.sleep(interval)`;

export default function ApiDocs() {
    const { t } = useLanguage();
    const [expanded, setExpanded] = useState({});

    const toggle = (key) => {
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    return (
        <div className="api-docs">
            {/* Hero */}
            <div className="api-hero">
                <h1>Student Verification API</h1>
                <p className="api-subtitle">
                    通过 API 提交学生身份验证请求，查询任务状态，管理 CDK 额度。
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
                    <span className="step-label">获取 CDK</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">2</span>
                    <span className="step-label">POST /api/v1/verify</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">3</span>
                    <span className="step-label">轮询 /api/v1/status/{'{id}'}</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">4</span>
                    <span className="step-label">获取 redirectUrl</span>
                </div>
            </div>
            <div className="api-info-banner">
                每次验证消耗 1 次 CDK 额度。验证失败会自动退还额度。请在提交前确保 CDK 有剩余次数。
            </div>

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

            {/* Rate Limits */}
            <h3 className="api-section-title">限流规则</h3>
            <table className="rate-limit-table">
                <thead>
                    <tr>
                        <th>接口</th>
                        <th>限制</th>
                        <th>窗口</th>
                    </tr>
                </thead>
                <tbody>
                    {RATE_LIMITS.map((r, i) => (
                        <tr key={i}>
                            <td>{r.path}</td>
                            <td>{r.limit}</td>
                            <td>{r.window}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="api-info-banner warning">
                超出限制返回 429 Too Many Requests。建议使用指数退避重试。<br />
                /api/v1/status 按 task_id 独立限流，并发轮询多个任务不会互相影响。其余接口按 IP 限流。
            </div>

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
