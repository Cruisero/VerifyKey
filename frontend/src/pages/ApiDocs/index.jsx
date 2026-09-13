import { useState } from 'react';
import './ApiDocs.css';

const DEFAULT_BASE_URL = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'https://onepass.fun';

const ENDPOINTS = [
    {
        group: '🔑 鉴权与商户信息',
        items: [
            {
                method: 'GET',
                path: '/api/auth/me',
                desc: '查询当前商户账户信息与积分余额',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {your_api_token}' },
                ],
                response: `{
  "user": {
    "id": 1,
    "email": "merchant@example.com",
    "username": "merchant",
    "credits": 100.0,
    "role": "user",
    "created_at": "2026-01-01T00:00:00Z"
  }
}`,
            },
        ],
    },
    {
        group: '📡 Gemini 自动化验证服务 (UPixel)',
        items: [
            {
                method: 'POST',
                path: '/api/pixel/jobs',
                desc: '提交 Gemini 账号验证或 SheerID 零凭据认证任务',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {your_api_token}' },
                    { name: 'mode', type: 'string', required: false, desc: '验证模式：semi-auto (普通验证，扣1分) / auto (高级验证，扣2分) / jio (极速订阅，扣2分) / 3-Month (3-Month 订阅，扣2分) / sheerid (SheerID 认证，扣3分)。默认 semi-auto' },
                    { name: 'email', type: 'string', required: false, desc: 'Google 账号邮箱 (mode 为 semi-auto / auto / jio / 3-Month 时必填)' },
                    { name: 'password', type: 'string', required: false, desc: '账号密码 (mode 为 semi-auto / auto / jio / 3-Month 时必填)' },
                    { name: 'totp_secret', type: 'string', required: false, desc: '2FA TOTP 密钥 Base32 编码 (上述账号密码模式必填)' },
                    { name: 'url', type: 'string', required: false, desc: 'SheerID 认证完整链接 (mode 为 sheerid 时必填，无需邮箱、密码和 2FA)' },
                    { name: 'priority', type: 'number', required: false, desc: '任务优先级（默认 0）' },
                ],
                requestBody: `// 方式 1: Google 账号模式 (以普通验证 semi-auto 为例)
{
  "email": "user@gmail.com",
  "password": "your_password",
  "totp_secret": "JBSWY3DPEHPK3PXP",
  "mode": "semi-auto"
}

// 方式 2: SheerID 零凭据认证模式 (学生/教师资格认证)
{
  "url": "https://services.sheerid.com/verify/67c8b9.../?verificationId=67c8ba...",
  "mode": "sheerid"
}`,
                response: `// 成功进入处理队列响应
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued",
  "queue_position": 2,
  "estimated_wait_seconds": 240
}

// 若该账号/链接此前已成功处理过，支持幂等直出（不重复扣分）
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "success",
  "queue_position": -1,
  "estimated_wait_seconds": 0
}`,
            },
            {
                method: 'GET',
                path: '/api/pixel/jobs/{job_id}',
                desc: '查询任务处理进度、排队位置与最终结果（支持免 Token 轮询）',
                params: [
                    { name: 'job_id', type: 'string', required: true, desc: '提交任务时返回的 job_id（URL 路径参数）' },
                ],
                response: `// 1. 排队或处理中状态
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running",
  "stage_label": "登录验证中",
  "queue_position": -1,
  "estimated_wait_seconds": 0
}

// 2. 成功完成状态 (普通验证返回优惠链接 url，SheerID/高级验证返回 result_msg)
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "success",
  "url": "https://one.google.com/partner-eft-onboard/XXXXXXX",
  "result_msg": "验证成功",
  "queue_position": -1,
  "estimated_wait_seconds": 0
}

// 3. 失败状态 (系统将自动原路退还扣除的积分)
{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "failed",
  "error": "❌ 密码错误",
  "queue_position": -1,
  "estimated_wait_seconds": 0
}`,
            },
            {
                method: 'GET',
                path: '/api/result',
                desc: '反向结果查询（支持按 URL / Verification ID / 邮箱反查）',
                params: [
                    { name: 'url', type: 'query', required: false, desc: 'SheerID 完整验证链接' },
                    { name: 'verification_id', type: 'query', required: false, desc: 'SheerID verificationId' },
                    { name: 'email', type: 'query', required: false, desc: 'Google 账号邮箱地址' },
                ],
                response: `{
  "found": true,
  "status": "success",
  "url": "https://services.sheerid.com/verify/.../?verificationId=...",
  "created_at": "2026-09-12 18:30:00"
}`,
            },
            {
                method: 'POST',
                path: '/api/pixel/jobs/{job_id}/cancel',
                desc: '取消排队中 (queued) 的验证任务 (取消成功将即时全额退还积分)',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {your_api_token}' },
                    { name: 'job_id', type: 'string', required: true, desc: '任务 ID（URL 路径参数，必须处于 queued 状态）' },
                ],
                response: `{
  "success": true,
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "cancelled"
}`,
            },
            {
                method: 'GET',
                path: '/api/pixel/quota',
                desc: '查询当前商户 API Key 各业务模式的上游配额（剩余/已用/总额）',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {your_api_token}' },
                ],
                response: `{
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
  "base_url": "https://auto.onepass.fun"
}`,
            },
        ],
    },
    {
        group: '⚡ ChatGPT 充值与邀请服务',
        items: [
            {
                method: 'POST',
                path: '/api/gpt/team-invite',
                desc: '提交 ChatGPT Team 官方邀请任务（仅需提供目标邮箱，自动加入 Team）',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {your_api_token}' },
                    { name: 'email', type: 'string', required: true, desc: '需加入 Team 的 OpenAI 账号邮箱' },
                ],
                requestBody: `{
  "email": "user@example.com"
}`,
                response: `// 成功响应 (扣除 0.6 积分)
{
  "success": true,
  "email": "user@example.com",
  "team_id": 1,
  "team_name": "Pro Team 01",
  "message": "Team 邀请已发送（admin@openai.com / Pro Team 01）"
}`,
            },
            {
                method: 'POST',
                path: '/api/gpt/recharge',
                desc: '提交 ChatGPT Plus 自动充值 / 升级任务',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {your_api_token}' },
                    { name: 'account', type: 'string', required: true, desc: 'OpenAI 账号凭据或 Session JSON 字符串' },
                    { name: 'email', type: 'string', required: false, desc: '账号邮箱' },
                    { name: 'channel', type: 'string', required: false, desc: '充值通道（默认 auto 或 指定通道）' },
                    { name: 'card_key', type: 'string', required: false, desc: '卡密密钥（若通过卡密充值）' },
                ],
                requestBody: `{
  "email": "user@example.com",
  "account": "{\\"accessToken\\":\\"...\\",\\"user\\":{\\"email\\":\\"user@example.com\\"}}",
  "channel": "api"
}`,
                response: `// 成功响应 (扣除 3.0 积分，失败全额退还)
{
  "success": true,
  "vid": "gpt_1726140000_user",
  "status": "success",
  "message": "ChatGPT Plus 充值成功"
}`,
            },
        ],
    },
    {
        group: '📜 历史与订单记录',
        items: [
            {
                method: 'GET',
                path: '/api/user/verify-history',
                desc: '获取当前商户的所有历史验证与充值记录（支持 Pixel / SheerID / GPT 记录）',
                params: [
                    { name: 'Authorization', type: 'Header', required: true, desc: 'Bearer {your_api_token}' },
                ],
                response: `{
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
}`,
            },
        ],
    },
];

const CREDITS_TABLE = [
    { service: 'UPixel 普通验证 (semi-auto)', cost: '-1.0 积分', zeroCred: '否', note: '登录 Google 账号获取 Google One 优惠链接，不自动绑卡' },
    { service: 'UPixel 高级验证 (auto)', cost: '-2.0 积分', zeroCred: '否', note: '登录 + 自动绑卡 + 确认订阅' },
    { service: 'Gemini 极速订阅 (jio)', cost: '-2.0 积分', zeroCred: '否', note: '免卡自动升级订阅流程' },
    { service: 'Gemini 3-Month 订阅 (3-Month)', cost: '-2.0 积分', zeroCred: '否', note: '自动分配 3-Month 优惠试用链接 + 信用卡自动订阅' },
    { service: 'SheerID 零凭据认证 (sheerid)', cost: '-3.0 积分', zeroCred: '是', note: '零凭据，仅需 verificationId 链接，审核失败/取消全额退款' },
    { service: 'ChatGPT Team 官方邀请 (gpt_team)', cost: '-0.6 积分', zeroCred: '是', note: '直发官方 Team 邀请邮件，无需账号密码，失败全额退款' },
    { service: 'ChatGPT Plus 充值 (gpt_plus)', cost: '-3.0 积分', zeroCred: '否', note: 'ChatGPT Plus 订阅直充，失败自动退还积分' },
];

const ERROR_CODES = [
    { code: 200, desc: '请求成功' },
    { code: 400, desc: '请求参数错误或账户积分不足' },
    { code: 401, desc: '未登录、Token 缺失或 Token 已过期' },
    { code: 403, desc: '权限不足（账号已被禁用或非管理员访问受限资源）' },
    { code: 404, desc: '资源不存在（任务 ID 不存在或链接无效）' },
    { code: 429, desc: '请求过于频繁（触发频率限制）' },
    { code: 500, desc: '服务器内部错误' },
    { code: 502, desc: '上游服务网关不可用' },
    { code: 503, desc: '对应服务未启用或处于维护状态' },
];

export default function ApiDocs() {
    const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
    const [expanded, setExpanded] = useState(() => {
        // Expand first endpoint by default
        return { 'POST/api/pixel/jobs': true };
    });
    const [copyTip, setCopyTip] = useState({});
    const [selectedTab, setSelectedTab] = useState('python');

    const toggle = (key) => {
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const expandAll = () => {
        const all = {};
        ENDPOINTS.forEach(group => {
            group.items.forEach(ep => {
                all[ep.method + ep.path] = true;
            });
        });
        setExpanded(all);
    };

    const collapseAll = () => {
        setExpanded({});
    };

    const handleCopy = (text, id) => {
        if (!navigator.clipboard) {
            const el = document.createElement('textarea');
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        } else {
            navigator.clipboard.writeText(text);
        }
        setCopyTip(prev => ({ ...prev, [id]: true }));
        setTimeout(() => {
            setCopyTip(prev => ({ ...prev, [id]: false }));
        }, 1800);
    };

    const pythonCode = `import requests
import time

BASE_URL = "${baseUrl}"
TOKEN = "your_static_api_token"  # 在后台获取商户专属 Token
headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

# 1. 查询商户积分余额
me_res = requests.get(f"{BASE_URL}/api/auth/me", headers=headers).json()
print(f"当前商户可用积分: {me_res['user']['credits']}")

# 2. 方式 A: 提交 SheerID 零凭据认证任务
sheerid_job = requests.post(f"{BASE_URL}/api/pixel/jobs", json={
    "url": "https://services.sheerid.com/verify/67c8b9.../?verificationId=67c8ba...",
    "mode": "sheerid"
}, headers=headers).json()
print(f"SheerID 任务已提交: {sheerid_job['job_id']}")

# 3. 轮询任务状态 (查询接口无需 Token，可直接用 job_id 轮询)
job_id = sheerid_job["job_id"]
while True:
    res = requests.get(f"{BASE_URL}/api/pixel/jobs/{job_id}").json()
    status = res.get("status")
    print(f"  当前状态: {status}, 阶段: {res.get('stage_label', '-')}")
    
    if status in ("success", "failed", "cancelled"):
        if status == "success":
            print(f"✅ 任务成功: {res.get('result_msg') or res.get('url')}")
        else:
            print(f"❌ 任务失败: {res.get('error')} (积分已原路全额自动退还)")
        break
    time.sleep(5)
`;

    const curlCode = `# 1. 查询商户账户余额
curl -X GET "${baseUrl}/api/auth/me" \\
  -H "Authorization: Bearer your_static_api_token"

# 2. 提交 SheerID 零凭据认证任务 (扣除 3 积分)
curl -X POST "${baseUrl}/api/pixel/jobs" \\
  -H "Authorization: Bearer your_static_api_token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://services.sheerid.com/verify/67c8b9.../?verificationId=67c8ba...",
    "mode": "sheerid"
  }'

# 3. 轮询任务状态 (免 Token)
curl -X GET "${baseUrl}/api/pixel/jobs/{job_id}"

# 4. 提交 ChatGPT Team 邀请任务 (扣除 0.6 积分)
curl -X POST "${baseUrl}/api/gpt/team-invite" \\
  -H "Authorization: Bearer your_static_api_token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "user@example.com"
  }'
`;

    const jsCode = `// Node.js 18+ 或前端环境原生 fetch 调用示例
const BASE_URL = "${baseUrl}";
const TOKEN = "your_static_api_token";

async function runDemo() {
  const headers = {
    "Authorization": \`Bearer \${TOKEN}\`,
    "Content-Type": "application/json"
  };

  // 1. 查询商户余额
  const meRes = await fetch(\`\${BASE_URL}/api/auth/me\`, { headers });
  const me = await meRes.json();
  console.log("当前积分余额:", me.user.credits);

  // 2. 提交任务 (以普通验证为例)
  const jobRes = await fetch(\`\${BASE_URL}/api/pixel/jobs\`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: "user@gmail.com",
      password: "password123",
      totp_secret: "JBSWY3DPEHPK3PXP",
      mode: "semi-auto"
    })
  });
  const job = await jobRes.json();
  console.log("任务提交成功, Job ID:", job.job_id);

  // 3. 轮询结果
  const timer = setInterval(async () => {
    const statusRes = await fetch(\`\${BASE_URL}/api/pixel/jobs/\${job.job_id}\`);
    const statusData = await statusRes.json();
    console.log("处理状态:", statusData.status);

    if (["success", "failed", "cancelled"].includes(statusData.status)) {
      clearInterval(timer);
      console.log("最终结果:", statusData);
    }
  }, 5000);
}

runDemo();
`;

    const getFullExampleCode = () => {
        if (selectedTab === 'curl') return curlCode;
        if (selectedTab === 'js') return jsCode;
        return pythonCode;
    };

    return (
        <div className="api-docs">
            {/* Hero */}
            <div className="api-hero">
                <div className="api-hero-badge">RESTful API v2.0</div>
                <h1>OnePass API 开发者文档</h1>
                <p className="api-subtitle">
                    一站式提供 Gemini 自动化验证、SheerID 零凭据学生/教师认证、ChatGPT Team 官方邀请及 Plus 自动充值接口。
                </p>
                <div className="api-base-url-bar">
                    <span className="base-url-label">Base URL:</span>
                    <code>{baseUrl}</code>
                    <button
                        className={`copy-chip-btn ${copyTip['base_url'] ? 'copied' : ''}`}
                        onClick={() => handleCopy(baseUrl, 'base_url')}
                        title="复制 Base URL"
                    >
                        {copyTip['base_url'] ? '✓ 已复制' : '复制'}
                    </button>
                    {baseUrl !== 'https://onepass.fun' && (
                        <button
                            className="toggle-env-btn"
                            onClick={() => setBaseUrl(baseUrl === DEFAULT_BASE_URL ? 'https://onepass.fun' : DEFAULT_BASE_URL)}
                        >
                            切换到 {baseUrl === DEFAULT_BASE_URL ? '生产域名 (onepass.fun)' : '当前服务地址'}
                        </button>
                    )}
                </div>
            </div>

            {/* Calling Flow */}
            <h3 className="api-section-title">对接与调用流程</h3>
            <div className="api-flow">
                <div className="flow-step">
                    <span className="step-num">1</span>
                    <span className="step-title">获取静态 Token</span>
                    <span className="step-label">请求头配置 Authorization</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">2</span>
                    <span className="step-title">查询商户积分</span>
                    <span className="step-label">GET /api/auth/me</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">3</span>
                    <span className="step-title">提交自动化任务</span>
                    <span className="step-label">POST /api/pixel/jobs</span>
                </div>
                <span className="flow-arrow">→</span>
                <div className="flow-step">
                    <span className="step-num">4</span>
                    <span className="step-title">轮询结果 / 回调</span>
                    <span className="step-label">GET /api/pixel/jobs/{'{id}'}</span>
                </div>
            </div>

            {/* Info Banner */}
            <div className="api-info-banner">
                💡 <strong>扣费与退款机制说明：</strong>
                任务提交时预扣相应积分。若任务执行失败、审核不通过或在排队阶段取消，系统将<strong>原路 100% 自动全额返还积分</strong>。针对已成功完成的同一账号或 SheerID 链接重复提交时，接口提供<strong>幂等直出保护，不产生二次扣费</strong>。
            </div>

            {/* Credits Table */}
            <div className="api-table-header-row">
                <h3 className="api-section-title" style={{ margin: 0 }}>服务积分消耗对照表</h3>
            </div>
            <table className="rate-limit-table">
                <thead>
                    <tr>
                        <th>业务服务名称</th>
                        <th>消耗积分</th>
                        <th>零凭据要求</th>
                        <th>服务说明与交付形式</th>
                    </tr>
                </thead>
                <tbody>
                    {CREDITS_TABLE.map((r, i) => (
                        <tr key={i}>
                            <td><strong>{r.service}</strong></td>
                            <td>
                                <code style={{ color: r.cost.startsWith('+') ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                                    {r.cost}
                                </code>
                            </td>
                            <td>
                                {r.zeroCred === '是' ? (
                                    <span className="badge-zerocred">✓ 零凭据</span>
                                ) : (
                                    <span className="badge-standard">需账号/密码</span>
                                )}
                            </td>
                            <td>{r.note}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Endpoint Controls */}
            <div className="api-endpoints-controls">
                <h3 className="api-section-title" style={{ margin: 0 }}>接口明细列表</h3>
                <div className="api-group-actions">
                    <button className="api-action-btn" onClick={expandAll}>展开全部</button>
                    <button className="api-action-btn" onClick={collapseAll}>折叠全部</button>
                </div>
            </div>

            {/* Endpoint Groups */}
            {ENDPOINTS.map((group) => (
                <div className="endpoint-group" key={group.group}>
                    <h4 className="api-group-title">{group.group}</h4>
                    {group.items.map((ep) => {
                        const key = ep.method + ep.path;
                        const isOpen = expanded[key];
                        return (
                            <div key={key} className="endpoint-wrapper">
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
                                                <h5>请求参数说明</h5>
                                                <table className="param-table">
                                                    <thead>
                                                        <tr>
                                                            <th>参数名称</th>
                                                            <th>位置 / 类型</th>
                                                            <th>必填</th>
                                                            <th>参数描述与取值</th>
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
                                                        <div className="api-block-header">
                                                            <h5>请求头示例 (Headers)</h5>
                                                            <button
                                                                className="api-copy-btn"
                                                                onClick={(e) => { e.stopPropagation(); handleCopy(headersText, `h_${key}`); }}
                                                            >
                                                                {copyTip[`h_${key}`] ? '✓ 已复制' : '复制'}
                                                            </button>
                                                        </div>
                                                        <div className="api-code-block">
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
                                                <div className="api-block-header">
                                                    <h5>请求体示例 (Body JSON)</h5>
                                                    <button
                                                        className="api-copy-btn"
                                                        onClick={(e) => { e.stopPropagation(); handleCopy(ep.requestBody, `b_${key}`); }}
                                                    >
                                                        {copyTip[`b_${key}`] ? '✓ 已复制' : '复制'}
                                                    </button>
                                                </div>
                                                <div className="api-code-block">
                                                    <span className="code-lang">JSON</span>
                                                    <pre>{ep.requestBody}</pre>
                                                </div>
                                            </>
                                        )}

                                        <div className="api-block-header">
                                            <h5>响应示例 (Response JSON)</h5>
                                            <button
                                                className="api-copy-btn"
                                                onClick={(e) => { e.stopPropagation(); handleCopy(ep.response, `r_${key}`); }}
                                            >
                                                {copyTip[`r_${key}`] ? '✓ 已复制' : '复制'}
                                            </button>
                                        </div>
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
            <h3 className="api-section-title">HTTP 状态码与异常响应参考</h3>
            <table className="error-table">
                <thead>
                    <tr>
                        <th>HTTP 状态码</th>
                        <th>说明与排查建议</th>
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
            <h3 className="api-section-title">接口鉴权与 Token 说明</h3>
            <div className="api-info-banner">
                所有需要认证的请求必须在 HTTP 报文头中携带 <code>Authorization: Bearer {'<token>'}</code>。<br />
                Token 可以联系系统管理员或在商户控制台获取专属的永久静态 API Token。该 Token 具备所属商户的所有调用权限，请妥善保管。
            </div>

            {/* Full Example with Tabs */}
            <div className="full-example">
                <div className="example-header-row">
                    <h3 className="api-section-title" style={{ margin: 0 }}>多语言完整集成示例</h3>
                    <div className="api-code-tabs">
                        <button
                            className={`api-tab-btn ${selectedTab === 'python' ? 'active' : ''}`}
                            onClick={() => setSelectedTab('python')}
                        >
                            Python 3
                        </button>
                        <button
                            className={`api-tab-btn ${selectedTab === 'curl' ? 'active' : ''}`}
                            onClick={() => setSelectedTab('curl')}
                        >
                            cURL (Bash)
                        </button>
                        <button
                            className={`api-tab-btn ${selectedTab === 'js' ? 'active' : ''}`}
                            onClick={() => setSelectedTab('js')}
                        >
                            Node.js / Fetch
                        </button>
                    </div>
                </div>

                <div className="api-code-block full-code-block">
                    <div className="api-code-block-top">
                        <span className="code-lang">{selectedTab.toUpperCase()}</span>
                        <button
                            className="api-copy-btn"
                            onClick={() => handleCopy(getFullExampleCode(), 'full_code')}
                        >
                            {copyTip['full_code'] ? '✓ 已复制完整代码' : '复制代码'}
                        </button>
                    </div>
                    <pre>{getFullExampleCode()}</pre>
                </div>
            </div>
        </div>
    );
}
