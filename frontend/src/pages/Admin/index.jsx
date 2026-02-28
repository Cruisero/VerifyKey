import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Admin.css';
import '../Verify/Verify.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// CDK Management Component
function CDKManagement({ token, cdkList, setCdkList, cdkStats, setCdkStats, cdkGenerating, setCdkGenerating, cdkGenQuota, setCdkGenQuota, cdkGenCount, setCdkGenCount, cdkGenNote, setCdkGenNote, cdkFilter, setCdkFilter, cdkNewCodes, setCdkNewCodes }) {
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const fetchCDKs = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/cdk/list`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                setCdkList(data.cdks || []);
                setCdkStats(data.stats || {});
            }
        } catch (e) { console.error('Failed to fetch CDKs:', e); }
    };

    useEffect(() => { fetchCDKs(); }, []);

    const handleGenerate = async () => {
        setCdkGenerating(true);
        try {
            const res = await fetch(`${API_BASE}/api/cdk/generate`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({ count: cdkGenCount, quota: cdkGenQuota, note: cdkGenNote })
            });
            if (res.ok) {
                const data = await res.json();
                setCdkNewCodes(data.codes || []);
                setCdkGenNote('');
                await fetchCDKs();
            } else {
                const err = await res.json();
                alert(err.detail || '生成失败');
            }
        } catch (e) { alert('生成失败: ' + e.message); }
        finally { setCdkGenerating(false); }
    };

    const handleDelete = async (code) => {
        if (!confirm(`确定删除 CDK: ${code}？`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/cdk/delete`, {
                method: 'POST', headers: authHeaders,
                body: JSON.stringify({ code })
            });
            if (res.ok) await fetchCDKs();
            else alert('删除失败');
        } catch (e) { alert('删除失败: ' + e.message); }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const copyAllNewCodes = () => {
        navigator.clipboard.writeText(cdkNewCodes.join('\n'));
    };

    const filteredList = cdkList.filter(c => {
        if (cdkFilter === 'unused') return c.status === 'unused';
        if (cdkFilter === 'active') return c.status === 'active';
        if (cdkFilter === 'used') return c.status === 'used';
        return true;
    });

    const quotaOptions = [1, 2, 5, 20, 100];

    return (
        <div className="tab-content">
            {/* CDK Stats */}
            <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                <div className="stat-card card primary">
                    <div className="stat-icon">🔑</div>
                    <div className="stat-info">
                        <span className="stat-value">{cdkStats.total || 0}</span>
                        <span className="stat-label">总数</span>
                    </div>
                </div>
                <div className="stat-card card success">
                    <div className="stat-icon">✨</div>
                    <div className="stat-info">
                        <span className="stat-value">{cdkStats.unused || 0}</span>
                        <span className="stat-label">未使用</span>
                    </div>
                </div>
                <div className="stat-card card info">
                    <div className="stat-icon">⚡</div>
                    <div className="stat-info">
                        <span className="stat-value">{cdkStats.totalRemaining || 0}</span>
                        <span className="stat-label">剩余总额度</span>
                    </div>
                </div>
                <div className="stat-card card warning">
                    <div className="stat-icon">📊</div>
                    <div className="stat-info">
                        <span className="stat-value">{cdkStats.totalUsed || 0}</span>
                        <span className="stat-label">已消耗</span>
                    </div>
                </div>
            </div>

            {/* Generate CDK */}
            <div className="card" style={{ padding: 'var(--spacing-lg)', marginBottom: 'var(--spacing-lg)' }}>
                <h3 style={{ marginBottom: 'var(--spacing-md)', fontSize: 'var(--text-lg)' }}>🎲 生成 CDK</h3>
                <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>面额</label>
                        <select className="input" value={cdkGenQuota} onChange={e => setCdkGenQuota(Number(e.target.value))} style={{ width: '120px' }}>
                            {quotaOptions.map(q => <option key={q} value={q}>{q} 次</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>数量</label>
                        <input className="input" type="number" min={1} max={100} value={cdkGenCount} onChange={e => setCdkGenCount(Number(e.target.value))} style={{ width: '80px' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: '150px' }}>
                        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>备注（可选）</label>
                        <input className="input" type="text" placeholder="例如：测试用" value={cdkGenNote} onChange={e => setCdkGenNote(e.target.value)} style={{ width: '100%' }} />
                    </div>
                    <button className="btn btn-primary" onClick={handleGenerate} disabled={cdkGenerating}>
                        {cdkGenerating ? '⏳ 生成中...' : `🎲 生成 ${cdkGenCount} 个`}
                    </button>
                </div>
            </div>

            {/* Newly Generated Codes */}
            {cdkNewCodes.length > 0 && (
                <div className="card" style={{ padding: 'var(--spacing-lg)', marginBottom: 'var(--spacing-lg)', border: '2px solid var(--color-success)', background: 'rgba(16, 185, 129, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)' }}>
                        <h3 style={{ fontSize: 'var(--text-base)', color: 'var(--color-success)' }}>✅ 新生成的 CDK</h3>
                        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                            <button className="btn btn-sm btn-secondary" onClick={copyAllNewCodes}>📋 复制全部</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setCdkNewCodes([])}>✕ 关闭</button>
                        </div>
                    </div>
                    <div style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 'var(--text-sm)', lineHeight: '1.8' }}>
                        {cdkNewCodes.map((code, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <span>{code}</span>
                                <button className="btn btn-sm btn-ghost" onClick={() => copyToClipboard(code)} style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}>📋</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Filter + CDK Table */}
            <div className="card" style={{ padding: 'var(--spacing-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                    <h3 style={{ fontSize: 'var(--text-lg)' }}>📋 CDK 列表 ({filteredList.length})</h3>
                    <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                        {['all', 'unused', 'active', 'used'].map(f => (
                            <button key={f} className={`btn btn-sm ${cdkFilter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCdkFilter(f)}>
                                {f === 'all' ? '全部' : f === 'unused' ? '未使用' : f === 'active' ? '使用中' : '已用完'}
                            </button>
                        ))}
                        <button className="btn btn-sm btn-secondary" onClick={fetchCDKs}>🔄</button>
                    </div>
                </div>
                <div className="users-table">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>CDK 代码</th>
                                <th>面额</th>
                                <th>使用情况</th>
                                <th>状态</th>
                                <th>备注</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredList.map(c => (
                                <tr key={c.code}>
                                    <td style={{ fontFamily: "'SF Mono', monospace", fontSize: 'var(--text-sm)' }}>{c.code}</td>
                                    <td>{c.quota} 次</td>
                                    <td>{c.used} / {c.quota}</td>
                                    <td>
                                        <span className={`badge badge-${c.status === 'unused' ? 'info' : c.status === 'active' ? 'success' : 'error'}`}>
                                            {c.status === 'unused' ? '未使用' : c.status === 'active' ? '使用中' : '已用完'}
                                        </span>
                                    </td>
                                    <td style={{ color: 'var(--text-muted)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.note || '-'}</td>
                                    <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{c.createdAt ? new Date(c.createdAt).toLocaleString() : '-'}</td>
                                    <td>
                                        <div className="action-btns">
                                            <button className="btn btn-sm btn-secondary" onClick={() => copyToClipboard(c.code)}>📋</button>
                                            <button className="btn btn-sm btn-outline" onClick={() => handleDelete(c.code)} style={{ color: 'var(--color-danger)' }}>🗑️</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredList.length === 0 && (
                                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 'var(--spacing-xl)', color: 'var(--text-muted)' }}>暂无 CDK 数据</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default function Admin() {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    const [config, setConfig] = useState(null);
    const [showSaveNotice, setShowSaveNotice] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);

    // Verification history state
    const [historyData, setHistoryData] = useState([]);
    const [historyStats, setHistoryStats] = useState({ pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
    const [hoveredStatusItem, setHoveredStatusItem] = useState(null);
    const [addCount, setAddCount] = useState(1);
    const [addingStatus, setAddingStatus] = useState(null);
    const [autoRules, setAutoRules] = useState([]);
    const [newRule, setNewRule] = useState({ intervalMinutes: 5, status: 'pass', durationHours: 0 });
    const [savingRule, setSavingRule] = useState(false);

    // CDK management state
    const [cdkList, setCdkList] = useState([]);
    const [cdkStats, setCdkStats] = useState({});
    const [cdkGenerating, setCdkGenerating] = useState(false);
    const [cdkGenQuota, setCdkGenQuota] = useState(5);
    const [cdkGenCount, setCdkGenCount] = useState(1);
    const [cdkGenNote, setCdkGenNote] = useState('');
    const [cdkFilter, setCdkFilter] = useState('all');
    const [cdkNewCodes, setCdkNewCodes] = useState([]);

    // Test document generation state
    const [testingDocument, setTestingDocument] = useState(false);
    const [testDocumentResult, setTestDocumentResult] = useState(null);

    // AI Generator form state
    const [aiProvider, setAiProvider] = useState('gemini');
    const [batchApiSettings, setBatchApiSettings] = useState({
        apiUrl: 'https://batch.1key.me/api/batch',
        apiKey: ''
    });
    const [getgemSettings, setGetgemSettings] = useState({
        apiUrl: 'https://getgem.cc',
        cdk: ''
    });
    const [getgemStatus, setGetgemStatus] = useState(null);
    const [getgemChecking, setGetgemChecking] = useState(false);
    const [geminiSettings, setGeminiSettings] = useState({
        apiKey: '',
        model: 'gemini-3-pro-image-preview',
        documentTypes: ['id_card', 'transcript', 'schedule']  // Default: generate all
    });
    const [puppeteerSettings, setPuppeteerSettings] = useState({
        template: 'student-id-generator.html',
        useGeminiPhoto: true,
        availableTemplates: []
    });
    const [sheeridSettings, setSheeridSettings] = useState({
        docTypes: ['class_schedule']  // Default: class_schedule, array for multi-select
    });
    const [lionpathSettings, setLionpathSettings] = useState({
        template: 'schedule.html',
        availableTemplates: []
    });
    const [vsidSettings, setVsidSettings] = useState({
        docTypes: ['student_id', 'schedule'],  // Default: student ID and schedule
        availableDocTypes: []
    });
    const [uiucSettings, setUiucSettings] = useState({
        templates: ['uiuc_id_card.html'],
        availableTemplates: []
    });
    const [onepasshtmlSettings, setOnepasshtmlSettings] = useState({
        templates: [],
        availableTemplates: []
    });
    const [proxySettings, setProxySettings] = useState({
        enabled: true,
        host: 'proxy.global.ip2up.com',
        port: '12348',
        user: '',
        password: ''
    });

    // Region mode state: 'global' (default) or 'us_only'
    const [regionMode, setRegionMode] = useState('global');

    // Maintenance mode state
    const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
    const [maintenanceMessage, setMaintenanceMessage] = useState('系统维护中，请稍后再试');
    const [maintenanceEstEnd, setMaintenanceEstEnd] = useState('');
    const [maintenanceSaving, setMaintenanceSaving] = useState(false);
    const [maintenanceSaved, setMaintenanceSaved] = useState(false);

    // Verification mode: 'api' (default) or 'browser' (Puppeteer) — only for non-telegram providers
    const [browserMode, setBrowserMode] = useState(false);

    // University source: 'sheerid_api' (dynamic) or 'custom_list' (local list)
    const [universitySource, setUniversitySource] = useState('sheerid_api');

    useEffect(() => {
        if (!loading && !user) {
            navigate('/');
        }
    }, [user, loading, navigate]);

    // Load configuration on mount
    useEffect(() => {
        fetchConfig();
    }, []);

    // Fetch verification history when tab is activated
    useEffect(() => {
        if (activeTab === 'verify-status') {
            (async () => {
                try {
                    const res = await fetch(`${API_BASE}/api/verify/history`);
                    if (res.ok) {
                        const data = await res.json();
                        setHistoryData(data.history || []);
                        setHistoryStats(data.stats || { pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
                    }
                    // Load auto-record rules
                    const arRes = await fetch(`${API_BASE}/api/verify/auto-record`);
                    if (arRes.ok) {
                        const arData = await arRes.json();
                        setAutoRules(arData.rules || []);
                    }
                } catch (e) {
                    console.warn('Failed to fetch verification history:', e);
                }
            })();
        }
    }, [activeTab]);

    // Fetch maintenance status when settings tab is activated
    useEffect(() => {
        if (activeTab === 'settings') {
            (async () => {
                try {
                    const res = await fetch(`${API_BASE}/api/maintenance`);
                    if (res.ok) {
                        const data = await res.json();
                        setMaintenanceEnabled(data.enabled);
                        setMaintenanceMessage(data.message || '系统维护中，请稍后再试');
                        setMaintenanceEstEnd(data.estimatedEnd || '');
                    }
                } catch (e) {
                    console.warn('Failed to fetch maintenance status:', e);
                }
            })();
        }
    }, [activeTab]);

    const handleSaveMaintenance = async () => {
        setMaintenanceSaving(true);
        setMaintenanceSaved(false);
        try {
            const token = user?.token || localStorage.getItem('verifykey-token');
            const res = await fetch(`${API_BASE}/api/maintenance`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    enabled: maintenanceEnabled,
                    message: maintenanceMessage,
                    estimatedEnd: maintenanceEstEnd || null
                })
            });
            if (res.ok) {
                setMaintenanceSaved(true);
                setTimeout(() => setMaintenanceSaved(false), 2000);
            } else {
                const err = await res.json();
                alert(err.error || '保存失败');
            }
        } catch (e) {
            alert('保存失败: ' + e.message);
        } finally {
            setMaintenanceSaving(false);
        }
    };

    const fetchConfig = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/config`);
            if (res.ok) {
                const data = await res.json();
                setConfig(data);
                setAiProvider(data.aiGenerator?.provider || 'gemini');
                if (data.aiGenerator?.batchApi) {
                    setBatchApiSettings(prev => ({
                        ...prev,
                        apiUrl: data.aiGenerator.batchApi.apiUrl || prev.apiUrl,
                        apiKey: data.aiGenerator.batchApi.apiKey?.includes('...')
                            ? ''
                            : (data.aiGenerator.batchApi.apiKey || '')
                    }));
                    if (data.aiGenerator.batchApi.apiKey?.includes('...')) {
                        setBatchApiSettings(prev => ({ ...prev, hasStoredKey: true }));
                    }
                }
                // Load GetGem settings
                if (data.aiGenerator?.getgem) {
                    setGetgemSettings(prev => ({
                        ...prev,
                        apiUrl: data.aiGenerator.getgem.apiUrl || prev.apiUrl,
                        cdk: data.aiGenerator.getgem.cdk?.includes('...')
                            ? ''
                            : (data.aiGenerator.getgem.cdk || '')
                    }));
                    if (data.aiGenerator.getgem.cdk?.includes('...')) {
                        setGetgemSettings(prev => ({ ...prev, hasStoredCdk: true }));
                    }
                }
                if (data.aiGenerator?.gemini) {
                    setGeminiSettings(prev => ({
                        ...prev,
                        apiKey: data.aiGenerator.gemini.apiKey?.includes('...')
                            ? ''
                            : (data.aiGenerator.gemini.apiKey || ''),
                        model: data.aiGenerator.gemini.model || prev.model,
                        documentTypes: data.aiGenerator.gemini.documentTypes || prev.documentTypes
                    }));
                    if (data.aiGenerator.gemini.apiKey?.includes('...')) {
                        setGeminiSettings(prev => ({ ...prev, hasStoredKey: true }));
                    }
                }
                if (data.aiGenerator?.puppeteer) {
                    setPuppeteerSettings(prev => ({
                        ...prev,
                        template: data.aiGenerator.puppeteer.template || prev.template,
                        useGeminiPhoto: data.aiGenerator.puppeteer.useGeminiPhoto !== false
                    }));
                }
                // Load SheerID settings
                if (data.aiGenerator?.sheerid) {
                    setSheeridSettings(prev => ({
                        ...prev,
                        docTypes: data.aiGenerator.sheerid.docTypes || prev.docTypes
                    }));
                }
                // Load proxy settings
                if (data.proxy) {
                    setProxySettings(prev => ({
                        ...prev,
                        enabled: data.proxy.enabled !== false,
                        host: data.proxy.host || prev.host,
                        port: data.proxy.port || prev.port,
                        user: data.proxy.user?.includes('...') ? '' : (data.proxy.user || ''),
                        password: data.proxy.password?.includes('...') ? '' : (data.proxy.password || ''),
                        hasStoredCredentials: data.proxy.user?.includes('...')
                    }));
                }
                // Load region mode setting
                if (data.aiGenerator?.regionMode) {
                    setRegionMode(data.aiGenerator.regionMode);
                }
                // Load university source setting
                if (data.aiGenerator?.universitySource) {
                    setUniversitySource(data.aiGenerator.universitySource);
                }
                // Load browser mode setting
                if (data.verification?.browserMode !== undefined) {
                    setBrowserMode(data.verification.browserMode);
                }
                // Load LionPATH settings
                if (data.aiGenerator?.lionpath) {
                    setLionpathSettings(prev => ({
                        ...prev,
                        template: data.aiGenerator.lionpath.template || prev.template,
                        templates: data.aiGenerator.lionpath.templates || (data.aiGenerator.lionpath.template ? [data.aiGenerator.lionpath.template] : [])
                    }));
                }
                // Load VSID settings
                if (data.aiGenerator?.vsid) {
                    setVsidSettings(prev => ({
                        ...prev,
                        docTypes: data.aiGenerator.vsid.docTypes || prev.docTypes
                    }));
                }
                // Load UIUC settings
                if (data.aiGenerator?.uiuc) {
                    setUiucSettings(prev => ({
                        ...prev,
                        templates: data.aiGenerator.uiuc.templates || prev.templates
                    }));
                }
                // Load OnepassHTML settings
                if (data.aiGenerator?.onepasshtml) {
                    setOnepasshtmlSettings(prev => ({
                        ...prev,
                        templates: data.aiGenerator.onepasshtml.templates || prev.templates
                    }));
                }
            }

            // Fetch available templates
            const templatesRes = await fetch(`${API_BASE}/api/templates`);
            if (templatesRes.ok) {
                const templatesData = await templatesRes.json();
                setPuppeteerSettings(prev => ({
                    ...prev,
                    availableTemplates: templatesData.templates || []
                }));
            }

            // Fetch LionPATH templates
            const lionpathTemplatesRes = await fetch(`${API_BASE}/api/lionpath-templates`);
            if (lionpathTemplatesRes.ok) {
                const lionpathTemplatesData = await lionpathTemplatesRes.json();
                setLionpathSettings(prev => ({
                    ...prev,
                    availableTemplates: lionpathTemplatesData.templates || []
                }));
            }

            // Fetch VSID document types
            const vsidDocTypesRes = await fetch(`${API_BASE}/api/vsid-doctypes`);
            if (vsidDocTypesRes.ok) {
                const vsidDocTypesData = await vsidDocTypesRes.json();
                setVsidSettings(prev => ({
                    ...prev,
                    availableDocTypes: vsidDocTypesData.docTypes || []
                }));
            }

            // Fetch UIUC templates
            const uiucTemplatesRes = await fetch(`${API_BASE}/api/uiuc-templates`);
            if (uiucTemplatesRes.ok) {
                const uiucTemplatesData = await uiucTemplatesRes.json();
                setUiucSettings(prev => ({
                    ...prev,
                    availableTemplates: uiucTemplatesData.templates || []
                }));
            }

            // Fetch OnepassHTML templates
            const onepasshtmlTemplatesRes = await fetch(`${API_BASE}/api/onepasshtml-templates`);
            if (onepasshtmlTemplatesRes.ok) {
                const onepasshtmlTemplatesData = await onepasshtmlTemplatesRes.json();
                setOnepasshtmlSettings(prev => ({
                    ...prev,
                    availableTemplates: onepasshtmlTemplatesData.templates || []
                }));
            }
        } catch (error) {
            console.error('Failed to load config:', error);
        }
    };

    const handleSaveAiConfig = async () => {
        setSaving(true);
        try {
            const updates = {
                aiGenerator: {
                    provider: aiProvider,
                    regionMode: regionMode,
                    universitySource: universitySource,
                    batchApi: {
                        enabled: aiProvider === 'batch_api',
                        apiUrl: batchApiSettings.apiUrl,
                        apiKey: batchApiSettings.apiKey || undefined
                    },
                    getgem: {
                        enabled: aiProvider === 'getgem',
                        apiUrl: getgemSettings.apiUrl,
                        cdk: getgemSettings.cdk || undefined
                    },
                    gemini: {
                        enabled: aiProvider === 'gemini' || aiProvider === 'puppeteer',
                        apiKey: geminiSettings.apiKey || undefined,
                        model: geminiSettings.model,
                        documentTypes: geminiSettings.documentTypes
                    },
                    puppeteer: {
                        enabled: aiProvider === 'puppeteer',
                        template: puppeteerSettings.template,
                        useGeminiPhoto: puppeteerSettings.useGeminiPhoto
                    },
                    sheerid: {
                        enabled: aiProvider === 'sheerid',
                        docTypes: sheeridSettings.docTypes || ['class_schedule']
                    },
                    lionpath: {
                        enabled: aiProvider === 'lionpath',
                        template: lionpathSettings.template,
                        templates: lionpathSettings.templates || (lionpathSettings.template ? [lionpathSettings.template] : [])
                    },
                    vsid: {
                        enabled: aiProvider === 'vsid',
                        docTypes: vsidSettings.docTypes || ['student_id', 'schedule']
                    },
                    uiuc: {
                        enabled: aiProvider === 'uiuc',
                        templates: uiucSettings.templates || ['uiuc_id_card.html']
                    },
                    onepasshtml: {
                        enabled: aiProvider === 'onepasshtml',
                        templates: onepasshtmlSettings.templates || []
                    },
                    svgFallback: { enabled: true }
                },
                proxy: {
                    enabled: proxySettings.enabled,
                    host: proxySettings.host,
                    port: proxySettings.port,
                    user: proxySettings.user || undefined,
                    password: proxySettings.password || undefined
                },
                verification: {
                    browserMode: browserMode,
                    telegram: {
                        enabled: config?.verification?.telegram?.enabled || false,
                        apiId: config?.verification?.telegram?.apiId,
                        apiHash: config?.verification?.telegram?.apiHash,
                        botUsername: config?.verification?.telegram?.botUsername
                    }
                }
            };

            const res = await fetch(`${API_BASE}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (res.ok) {
                setShowSaveNotice(true);
                setTimeout(() => setShowSaveNotice(false), 2000);
                fetchConfig();
            }
        } catch (error) {
            console.error('Failed to save config:', error);
        }
        setSaving(false);
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);

        try {
            const body = {
                provider: aiProvider,
                apiUrl: aiProvider === 'batch_api' ? batchApiSettings.apiUrl : undefined,
                apiKey: aiProvider === 'batch_api' ? batchApiSettings.apiKey : geminiSettings.apiKey,
                model: geminiSettings.model
            };

            const res = await fetch(`${API_BASE}/api/config/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            setTestResult(data);
        } catch (error) {
            setTestResult({ success: false, message: error.message });
        }
        setTesting(false);
    };

    const handleTestDocument = async () => {
        setTestingDocument(true);
        setTestDocumentResult(null);

        try {
            // Build config based on selected provider
            const testConfig = {
                provider: aiProvider
            };

            if (aiProvider === 'puppeteer') {
                testConfig.template = puppeteerSettings.template;
                testConfig.useGeminiPhoto = puppeteerSettings.useGeminiPhoto;
                if (puppeteerSettings.useGeminiPhoto && geminiSettings.apiKey) {
                    testConfig.geminiApiKey = geminiSettings.apiKey;
                }
            } else if (aiProvider === 'gemini') {
                testConfig.geminiApiKey = geminiSettings.apiKey;
                testConfig.geminiModel = geminiSettings.model;
            } else if (aiProvider === 'batch_api') {
                testConfig.batchApiUrl = batchApiSettings.apiUrl;
                testConfig.batchApiKey = batchApiSettings.apiKey;
            }

            const res = await fetch(`${API_BASE}/api/config/test-document`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testConfig)
            });

            const data = await res.json();
            setTestDocumentResult(data);
        } catch (error) {
            setTestDocumentResult({ success: false, message: error.message });
        }
        setTestingDocument(false);
    };

    // 模拟数据
    const stats = {
        totalUsers: 1247,
        activeUsers: 892,
        totalVerifications: 34582,
        successRate: 98.7,
        revenue: 12580,
        pendingWithdrawals: 3
    };

    const users = [
        { id: 1, username: 'user1', email: 'user1@example.com', credits: 150, status: 'active', joined: '2026-01-15' },
        { id: 2, username: 'user2', email: 'user2@example.com', credits: 45, status: 'active', joined: '2026-01-18' },
        { id: 3, username: 'user3', email: 'user3@example.com', credits: 0, status: 'suspended', joined: '2026-01-20' },
        { id: 4, username: 'user4', email: 'user4@example.com', credits: 320, status: 'active', joined: '2026-01-22' },
    ];

    const tabs = [
        { id: 'overview', label: '概览', icon: '📊' },
        { id: 'cdk', label: 'CDK 管理', icon: '🔑' },
        { id: 'users', label: '用户管理', icon: '👥' },
        { id: 'ai-generator', label: 'AI 文档生成', icon: '🤖' },
        { id: 'verify-status', label: '验证状态', icon: '📋' },
        { id: 'settings', label: '系统设置', icon: '⚙️' },
    ];

    if (loading || !user) return null;

    return (
        <div className="admin-page">
            <div className="container">
                {/* Header */}
                <div className="admin-header">
                    <h1 className="page-title">⚙️ 管理后台</h1>
                    <p className="page-desc">管理用户、配置系统和查看统计数据</p>
                </div>

                {/* Tabs */}
                <div className="admin-tabs">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <span className="tab-icon">{tab.icon}</span>
                            <span className="tab-label">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Overview Tab */}
                {activeTab === 'overview' && (
                    <div className="tab-content">
                        <div className="stats-grid">
                            <div className="stat-card card">
                                <div className="stat-icon">👥</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.totalUsers}</span>
                                    <span className="stat-label">总用户数</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">✅</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.activeUsers}</span>
                                    <span className="stat-label">活跃用户</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">⚡</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.totalVerifications.toLocaleString()}</span>
                                    <span className="stat-label">总验证次数</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">📈</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.successRate}%</span>
                                    <span className="stat-label">成功率</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">💰</div>
                                <div className="stat-info">
                                    <span className="stat-value">¥{stats.revenue.toLocaleString()}</span>
                                    <span className="stat-label">总收入</span>
                                </div>
                            </div>
                            <div className="stat-card card">
                                <div className="stat-icon">📋</div>
                                <div className="stat-info">
                                    <span className="stat-value">{stats.pendingWithdrawals}</span>
                                    <span className="stat-label">待处理提现</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* CDK Management Tab */}
                {activeTab === 'cdk' && (
                    <CDKManagement
                        token={user?.token || localStorage.getItem('verifykey-token')}
                        cdkList={cdkList}
                        setCdkList={setCdkList}
                        cdkStats={cdkStats}
                        setCdkStats={setCdkStats}
                        cdkGenerating={cdkGenerating}
                        setCdkGenerating={setCdkGenerating}
                        cdkGenQuota={cdkGenQuota}
                        setCdkGenQuota={setCdkGenQuota}
                        cdkGenCount={cdkGenCount}
                        setCdkGenCount={setCdkGenCount}
                        cdkGenNote={cdkGenNote}
                        setCdkGenNote={setCdkGenNote}
                        cdkFilter={cdkFilter}
                        setCdkFilter={setCdkFilter}
                        cdkNewCodes={cdkNewCodes}
                        setCdkNewCodes={setCdkNewCodes}
                    />
                )}

                {/* Users Tab */}
                {activeTab === 'users' && (
                    <div className="tab-content">
                        <div className="users-table card">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>用户名</th>
                                        <th>邮箱</th>
                                        <th>积分</th>
                                        <th>状态</th>
                                        <th>注册时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.id}>
                                            <td>{u.id}</td>
                                            <td>{u.username}</td>
                                            <td>{u.email}</td>
                                            <td>{u.credits}</td>
                                            <td>
                                                <span className={`badge badge-${u.status === 'active' ? 'success' : 'error'}`}>
                                                    {u.status === 'active' ? '正常' : '禁用'}
                                                </span>
                                            </td>
                                            <td>{u.joined}</td>
                                            <td>
                                                <div className="action-btns">
                                                    <button className="btn btn-sm btn-secondary">编辑</button>
                                                    <button className="btn btn-sm btn-outline">禁用</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* AI Generator Tab */}
                {activeTab === 'ai-generator' && (
                    <div className="tab-content">
                        <div className="settings-section card">
                            <h3>🤖 AI 文档生成器配置</h3>
                            <p className="settings-desc">
                                选择用于生成验证文档（学生证、成绩单）的 AI 提供商。
                            </p>

                            {/* Provider Selection */}
                            <div className="provider-cards">
                                <div
                                    className={`provider-card ${aiProvider === 'getgem' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('getgem')}
                                >
                                    <div className="provider-icon">💎</div>
                                    <div className="provider-info">
                                        <h4>GetGem API</h4>
                                        <p>使用 GetGem.cc 第三方验证 API</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-success">推荐</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'batch_api' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('batch_api')}
                                >
                                    <div className="provider-icon">🔗</div>
                                    <div className="provider-info">
                                        <h4>batch.1key.me API</h4>
                                        <p>使用第三方批量验证 API</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-warning">需配置</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'gemini' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('gemini')}
                                >
                                    <div className="provider-icon">✨</div>
                                    <div className="provider-info">
                                        <h4>Gemini API</h4>
                                        <p>直接调用 Google Gemini API</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-warning">需配置</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'puppeteer' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('puppeteer')}
                                >
                                    <div className="provider-icon">🎨</div>
                                    <div className="provider-info">
                                        <h4>Puppeteer HTML 模板</h4>
                                        <p>使用 Puppeteer 渲染 HTML 模板生成高质量证件</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-success">推荐</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'lionpath' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('lionpath')}
                                >
                                    <div className="provider-icon">🦁</div>
                                    <div className="provider-info">
                                        <h4>LionPATH 课程表</h4>
                                        <p>Penn State 学生门户截图，备选验证方式</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-info">备选</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'sheerid' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('sheerid')}
                                >
                                    <div className="provider-icon">📚</div>
                                    <div className="provider-info">
                                        <h4>SheerID Generator</h4>
                                        <p>通用文档生成：课程表/成绩单/学生证</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-warning">通用</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'vsid' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('vsid')}
                                >
                                    <div className="provider-icon">🎓</div>
                                    <div className="provider-info">
                                        <h4>VSID Generator</h4>
                                        <p>国际学生证生成：支持5种文档类型</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-success">新</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'uiuc' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('uiuc')}
                                >
                                    <div className="provider-icon">🏛️</div>
                                    <div className="provider-info">
                                        <h4>UIUC i-card</h4>
                                        <p>伊利诺伊大学厄巴纳-香槟分校学生证</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-info">专属</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'onepasshtml' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('onepasshtml')}
                                >
                                    <div className="provider-icon">📝</div>
                                    <div className="provider-info">
                                        <h4>OnepassHTML 固定模板</h4>
                                        <p>固定学校 HTML 模板，仅修改学生信息</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-success">新</span>
                                    </div>
                                </div>

                                <div
                                    className={`provider-card ${aiProvider === 'telegram' ? 'active' : ''}`}
                                    onClick={() => setAiProvider('telegram')}
                                >
                                    <div className="provider-icon">📨</div>
                                    <div className="provider-info">
                                        <h4>Telegram Userbot</h4>
                                        <p>调用外部 SheerID Bot 自动验证</p>
                                    </div>
                                    <div className="provider-status">
                                        <span className="badge badge-warning">需配置</span>
                                    </div>
                                </div>
                            </div>

                            {/* GetGem.cc API Settings */}
                            {aiProvider === 'getgem' && (
                                <div className="provider-settings">
                                    <h4>💎 GetGem API 配置</h4>
                                    <div className="settings-form">
                                        <div className="getgem-info" style={{
                                            background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>GetGem.cc</strong> 是第三方学生身份验证 API 服务。
                                                提交 verificationId 后自动完成验证流程，支持批量处理和状态轮询。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">API URL</label>
                                            <input
                                                type="text"
                                                className="input"
                                                value={getgemSettings.apiUrl}
                                                onChange={(e) => setGetgemSettings(s => ({ ...s, apiUrl: e.target.value }))}
                                                placeholder="https://getgem.cc"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">GetGem CDK</label>
                                            <input
                                                type="password"
                                                className="input"
                                                value={getgemSettings.cdk}
                                                onChange={(e) => setGetgemSettings(s => ({ ...s, cdk: e.target.value, hasStoredCdk: false }))}
                                                placeholder={getgemSettings.hasStoredCdk ? "••••••••••（已保存，留空保持不变）" : "CDK-XXXXXXXXXXXXXXXX"}
                                            />
                                            {getgemSettings.hasStoredCdk && (
                                                <p className="input-hint"><span className="key-stored">✓ CDK 已保存</span></p>
                                            )}
                                            <p className="input-hint">
                                                从 <a href="https://getgem.cc" target="_blank" rel="noreferrer">getgem.cc</a> 获取 CDK 激活码
                                            </p>
                                        </div>
                                        <div style={{ marginTop: '12px' }}>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                disabled={getgemChecking}
                                                onClick={async () => {
                                                    setGetgemChecking(true);
                                                    setGetgemStatus(null);
                                                    try {
                                                        const res = await fetch(`${API_BASE}/api/getgem/status`);
                                                        const data = await res.json();
                                                        setGetgemStatus(data);
                                                    } catch (e) {
                                                        setGetgemStatus({ error: e.message });
                                                    }
                                                    setGetgemChecking(false);
                                                }}
                                            >
                                                {getgemChecking ? '⏳ 检查中...' : '🔍 检查 GetGem 状态'}
                                            </button>
                                            {getgemStatus && (
                                                <div style={{
                                                    marginTop: '12px',
                                                    padding: '12px 16px',
                                                    borderRadius: '8px',
                                                    background: getgemStatus.connected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                    border: `1px solid ${getgemStatus.connected ? '#10B981' : '#EF4444'}`,
                                                    fontSize: '13px'
                                                }}>
                                                    <div>{getgemStatus.connected ? '✅ API 连接正常' : '❌ API 连接失败'}</div>
                                                    {getgemStatus.cdkBalance && (
                                                        <div style={{ marginTop: '6px' }}>
                                                            💎 CDK 余额: <strong>{getgemStatus.cdkBalance.remaining_uses}</strong> / {getgemStatus.cdkBalance.total_uses}
                                                        </div>
                                                    )}
                                                    {getgemStatus.health && (
                                                        <div style={{ marginTop: '6px' }}>
                                                            🏭 活跃任务: {getgemStatus.health.activeJobs || 0} · 可用槽位: {getgemStatus.health.availableSlots || 'N/A'}
                                                        </div>
                                                    )}
                                                    {getgemStatus.error && (
                                                        <div style={{ marginTop: '6px', color: '#EF4444' }}>错误: {getgemStatus.error}</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* batch.1key.me API Settings */}
                            {aiProvider === 'batch_api' && (
                                <div className="provider-settings">
                                    <h4>batch.1key.me API 配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">API URL</label>
                                            <input
                                                type="text"
                                                className="input"
                                                value={batchApiSettings.apiUrl}
                                                onChange={(e) => setBatchApiSettings(s => ({ ...s, apiUrl: e.target.value }))}
                                                placeholder="https://batch.1key.me/api/batch"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">API Key</label>
                                            <input
                                                type="password"
                                                className="input"
                                                value={batchApiSettings.apiKey}
                                                onChange={(e) => setBatchApiSettings(s => ({ ...s, apiKey: e.target.value, hasStoredKey: false }))}
                                                placeholder={batchApiSettings.hasStoredKey ? "••••••••••（已保存，留空保持不变）" : "输入 batch.1key.me API Key"}
                                            />
                                            {batchApiSettings.hasStoredKey && (
                                                <p className="input-hint"><span className="key-stored">✓ API Key 已保存</span></p>
                                            )}
                                            <p className="input-hint">
                                                从 <a href="https://batch.1key.me" target="_blank" rel="noreferrer">batch.1key.me</a> 获取 API Key
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Gemini API Settings */}
                            {aiProvider === 'gemini' && (
                                <div className="provider-settings">
                                    <h4>Gemini API 配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">API Key</label>
                                            <input
                                                type="password"
                                                className="input"
                                                value={geminiSettings.apiKey}
                                                onChange={(e) => setGeminiSettings(s => ({ ...s, apiKey: e.target.value, hasStoredKey: false }))}
                                                placeholder={geminiSettings.hasStoredKey ? "••••••••••（已保存，留空保持不变）" : "AIzaSy..."}
                                            />
                                            <p className="input-hint">
                                                {geminiSettings.hasStoredKey && <span className="key-stored">✓ API Key 已保存 · </span>}
                                                从 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> 获取
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">模型</label>
                                            <select
                                                className="input"
                                                value={geminiSettings.model}
                                                onChange={(e) => setGeminiSettings(s => ({ ...s, model: e.target.value }))}
                                            >
                                                <optgroup label="🖼️ 图像生成模型">
                                                    <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview (推荐)</option>
                                                    <option value="gemini-2.0-flash-exp-image-generation">gemini-2.0-flash-exp-image-generation</option>
                                                    <option value="imagen-4.0-generate-001">imagen-4.0-generate-001</option>
                                                </optgroup>
                                            </select>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">生成文档类型</label>
                                            <div className="checkbox-group">
                                                <label className="checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={geminiSettings.documentTypes?.includes('id_card')}
                                                        onChange={(e) => {
                                                            const types = geminiSettings.documentTypes || [];
                                                            if (e.target.checked) {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: [...types, 'id_card'] }));
                                                            } else {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: types.filter(t => t !== 'id_card') }));
                                                            }
                                                        }}
                                                    />
                                                    <span>🪪 学生证</span>
                                                </label>
                                                <label className="checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={geminiSettings.documentTypes?.includes('transcript')}
                                                        onChange={(e) => {
                                                            const types = geminiSettings.documentTypes || [];
                                                            if (e.target.checked) {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: [...types, 'transcript'] }));
                                                            } else {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: types.filter(t => t !== 'transcript') }));
                                                            }
                                                        }}
                                                    />
                                                    <span>📜 成绩单</span>
                                                </label>
                                                <label className="checkbox-label">
                                                    <input
                                                        type="checkbox"
                                                        checked={geminiSettings.documentTypes?.includes('schedule')}
                                                        onChange={(e) => {
                                                            const types = geminiSettings.documentTypes || [];
                                                            if (e.target.checked) {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: [...types, 'schedule'] }));
                                                            } else {
                                                                setGeminiSettings(s => ({ ...s, documentTypes: types.filter(t => t !== 'schedule') }));
                                                            }
                                                        }}
                                                    />
                                                    <span>📅 课程表</span>
                                                </label>
                                            </div>
                                            <p className="input-hint">选择要自动生成的证明文件类型，至少选择一项</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Puppeteer HTML Template Settings */}
                            {aiProvider === 'puppeteer' && (
                                <div className="provider-settings">
                                    <h4>🎨 Puppeteer HTML 模板配置</h4>
                                    <div className="settings-form">
                                        <div className="input-group">
                                            <label className="input-label">选择 HTML 模板</label>
                                            <select
                                                className="input"
                                                value={puppeteerSettings.template}
                                                onChange={(e) => setPuppeteerSettings(s => ({ ...s, template: e.target.value }))}
                                            >
                                                {puppeteerSettings.availableTemplates.length > 0 ? (
                                                    puppeteerSettings.availableTemplates.map(tpl => (
                                                        <option key={tpl.filename} value={tpl.filename}>
                                                            {tpl.name} ({tpl.filename})
                                                        </option>
                                                    ))
                                                ) : (
                                                    <option value="student-id-generator.html">student-id-generator.html (默认)</option>
                                                )}
                                            </select>
                                            <p className="input-hint">
                                                模板文件位于 <code>VerifyKey/templates/</code> 目录
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">
                                                <input
                                                    type="checkbox"
                                                    checked={puppeteerSettings.useGeminiPhoto}
                                                    onChange={(e) => setPuppeteerSettings(s => ({ ...s, useGeminiPhoto: e.target.checked }))}
                                                    style={{ marginRight: '8px' }}
                                                />
                                                使用 Gemini AI 生成学生证件照
                                            </label>
                                            <p className="input-hint">
                                                启用后将使用 Gemini AI 自动生成逼真的学生头像（使用上方 Gemini 配置中的 API Key）
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* LionPATH Settings */}
                            {aiProvider === 'lionpath' && (
                                <div className="provider-settings">
                                    <h4>🦁 LionPATH 配置</h4>
                                    <div className="settings-form">
                                        <div className="lionpath-info" style={{
                                            background: 'linear-gradient(135deg, #1E407C 0%, #96BEE6 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>Penn State LionPATH</strong> 是宾州州立大学的学生门户系统。
                                                此模式生成模拟的课程表截图，作为验证的备选文档类型。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">选择 HTML 模板 (支持多选)</label>
                                            <div className="template-cards" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {(lionpathSettings.availableTemplates.length > 0 ? lionpathSettings.availableTemplates : [
                                                    { filename: "schedule.html", label: "经典风格 (Student Center)" },
                                                    { filename: "schedule_modern.html", label: "现代风格 (卡片式)" },
                                                    { filename: "schedule_calendar.html", label: "日历视图 (周课表)" },
                                                    { filename: "enrollment_verification.html", label: "注册验证" },
                                                    { filename: "schedule_browser.html", label: "浏览器截图 (SheerID推荐)" },
                                                    { filename: "psu_id_card.html", label: "PSU学生证 (ID Card)" }
                                                ]).map(tpl => {
                                                    const currentTemplates = lionpathSettings.templates || (lionpathSettings.template ? [lionpathSettings.template] : []);
                                                    const isSelected = currentTemplates.includes(tpl.filename);

                                                    return (
                                                        <label key={tpl.filename} className={`template-card ${isSelected ? 'selected' : ''}`} style={{
                                                            display: 'flex', alignItems: 'center', padding: '10px 14px',
                                                            borderRadius: '6px', cursor: 'pointer',
                                                            background: isSelected ? 'rgba(30, 64, 124, 0.1)' : '#f8f9fa',
                                                            border: isSelected ? '1px solid #1E407C' : '1px solid #eee',
                                                            transition: 'all 0.2s'
                                                        }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={(e) => {
                                                                    const checked = e.target.checked;
                                                                    const current = lionpathSettings.templates || (lionpathSettings.template ? [lionpathSettings.template] : []);
                                                                    let next;
                                                                    if (checked) {
                                                                        next = [...current, tpl.filename];
                                                                    } else {
                                                                        next = current.filter(t => t !== tpl.filename);
                                                                    }
                                                                    setLionpathSettings(s => ({
                                                                        ...s,
                                                                        templates: next,
                                                                        template: next[0] || '' // Fallback for legacy
                                                                    }));
                                                                }}
                                                                style={{ marginRight: '10px' }}
                                                            />
                                                            <div>
                                                                <div style={{ fontWeight: 500, fontSize: '14px', color: '#333' }}>{tpl.label || tpl.filename}</div>
                                                                <div style={{ fontSize: '12px', color: '#666' }}>{tpl.filename}</div>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                            <p className="input-hint" style={{ marginTop: '5px' }}>
                                                💡 推荐同时选择 "Browser Screenshot" (课程表) 和 "PSU ID Card" (学生证) 以提高通过率。
                                            </p>
                                        </div>
                                        <p className="input-hint" style={{ marginTop: '12px' }}>
                                            此模式将自动生成：
                                            <br />• 🎓 随机 PSU 学号 (9位)
                                            <br />• 📧 PSU 格式邮箱
                                            <br />• 📚 随机课程表 (4-5门课程)
                                            <br />• 📅 当前学期信息
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* SheerID Generator Settings */}
                            {aiProvider === 'sheerid' && (
                                <div className="provider-settings">
                                    <h4>📚 SheerID Generator 配置</h4>
                                    <div className="settings-form">
                                        <div className="sheerid-info" style={{
                                            background: 'linear-gradient(135deg, #4299E1 0%, #805AD5 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>SheerID Generator</strong> 使用 Pillow 生成通用学术文档，
                                                支持任意大学，适用于不需要特定大学样式的验证场景。
                                            </p>
                                        </div>

                                        <div className="input-group">
                                            <label className="input-label">文档类型（可多选）</label>
                                            <div className="document-type-checkboxes" style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '10px',
                                                marginTop: '8px'
                                            }}>
                                                {[
                                                    { value: 'class_schedule', label: '📅 课程表 (Class Schedule)' },
                                                    { value: 'transcript', label: '📝 成绩单 (Transcript)' },
                                                    { value: 'id_card', label: '🪪 学生证 (ID Card)' }
                                                ].map(docType => (
                                                    <label key={docType.value} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        cursor: 'pointer',
                                                        padding: '8px 12px',
                                                        background: (sheeridSettings?.docTypes || ['class_schedule']).includes(docType.value)
                                                            ? 'linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%)'
                                                            : 'rgba(0,0,0,0.03)',
                                                        borderRadius: '8px',
                                                        border: (sheeridSettings?.docTypes || ['class_schedule']).includes(docType.value)
                                                            ? '1px solid #667eea'
                                                            : '1px solid transparent',
                                                        transition: 'all 0.2s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(sheeridSettings?.docTypes || ['class_schedule']).includes(docType.value)}
                                                            onChange={(e) => {
                                                                const currentTypes = sheeridSettings?.docTypes || ['class_schedule'];
                                                                let newTypes;
                                                                if (e.target.checked) {
                                                                    newTypes = [...currentTypes, docType.value];
                                                                } else {
                                                                    newTypes = currentTypes.filter(t => t !== docType.value);
                                                                    if (newTypes.length === 0) newTypes = ['class_schedule']; // At least one
                                                                }
                                                                setSheeridSettings(s => ({ ...s, docTypes: newTypes }));
                                                            }}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>{docType.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                            <p className="input-hint">
                                                选择一个或多个文档类型，系统将随机选择其中一种生成
                                            </p>
                                        </div>

                                        <p className="input-hint" style={{ marginTop: '16px' }}>
                                            ✨ 此模式将自动生成：
                                            <br />• 📛 随机学生姓名 (Faker 美国)
                                            <br />• 🆔 8位随机学号
                                            <br />• 🎂 大学生年龄的随机生日 (2000-2006)
                                            <br />• 📚 随机课程/成绩数据
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* VSID Generator Settings */}
                            {aiProvider === 'vsid' && (
                                <div className="provider-settings">
                                    <h4>🎓 VSID Generator 配置</h4>
                                    <div className="settings-form">
                                        <div className="vsid-info" style={{
                                            background: 'linear-gradient(135deg, #10B981 0%, #3B82F6 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>VSID Generator</strong> 使用 Headless Browser 自动化生成多种学术文档，
                                                支持学生证、在读证明、课程表、录取通知书和成绩单。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">选择文档类型 (可多选)</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                                {(vsidSettings.availableDocTypes.length > 0 ? vsidSettings.availableDocTypes : [
                                                    { value: 'student_id', label: '🪪 学生证 (Student ID)' },
                                                    { value: 'enrollment', label: '📜 在读证明 (Enrollment Certificate)' },
                                                    { value: 'schedule', label: '📅 课程表 (Course Schedule)' },
                                                    { value: 'admission', label: '📬 录取通知书 (Admission Letter)' },
                                                    { value: 'transcript', label: '📊 成绩单 (Transcript)' }
                                                ]).map(docType => (
                                                    <label key={docType.value} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 14px',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        background: (vsidSettings?.docTypes || ['student_id', 'schedule']).includes(docType.value)
                                                            ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-secondary)',
                                                        border: (vsidSettings?.docTypes || ['student_id', 'schedule']).includes(docType.value)
                                                            ? '1px solid #10B981'
                                                            : '1px solid transparent',
                                                        transition: 'all 0.2s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(vsidSettings?.docTypes || ['student_id', 'schedule']).includes(docType.value)}
                                                            onChange={(e) => {
                                                                const currentTypes = vsidSettings?.docTypes || ['student_id', 'schedule'];
                                                                let newTypes;
                                                                if (e.target.checked) {
                                                                    newTypes = [...currentTypes, docType.value];
                                                                } else {
                                                                    newTypes = currentTypes.filter(t => t !== docType.value);
                                                                    if (newTypes.length === 0) newTypes = ['student_id']; // At least one
                                                                }
                                                                setVsidSettings(s => ({ ...s, docTypes: newTypes }));
                                                            }}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>{docType.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                            <p className="input-hint">
                                                💡 推荐同时选择 "学生证" 和 "课程表" 以提高验证通过率
                                            </p>
                                        </div>

                                        <p className="input-hint" style={{ marginTop: '16px' }}>
                                            ✨ 此模式将自动生成：
                                            <br />• 📛 基于姓名的学生信息
                                            <br />• 🆔 随机学号
                                            <br />• 🎓 随机专业和学位
                                            <br />• 📅 合理的入学和毕业日期
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* UIUC i-card Settings */}
                            {aiProvider === 'uiuc' && (
                                <div className="provider-settings">
                                    <h4>🏛️ UIUC i-card 配置</h4>
                                    <div className="settings-form">
                                        <div className="uiuc-info" style={{
                                            background: 'linear-gradient(135deg, #E84A27 0%, #13294B 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>UIUC i-card Generator</strong> 专门用于生成伊利诺伊大学厄巴纳-香槟分校 (UIUC) 学生证。
                                                自动生成照片、姓名、UIU号、Library号、Card号及过期日期。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">选择模板 (可多选)</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                                {(uiucSettings.availableTemplates.length > 0 ? uiucSettings.availableTemplates : [
                                                    { filename: 'uiuc_id_card.html', label: 'UIUC i-card 学生证' }
                                                ]).map(template => (
                                                    <label key={template.filename} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 14px',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        background: (uiucSettings?.templates || ['uiuc_id_card.html']).includes(template.filename)
                                                            ? 'rgba(232, 74, 39, 0.1)' : 'var(--bg-secondary)',
                                                        border: (uiucSettings?.templates || ['uiuc_id_card.html']).includes(template.filename)
                                                            ? '1px solid #E84A27'
                                                            : '1px solid transparent',
                                                        transition: 'all 0.2s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(uiucSettings?.templates || ['uiuc_id_card.html']).includes(template.filename)}
                                                            onChange={(e) => {
                                                                const currentTemplates = uiucSettings?.templates || ['uiuc_id_card.html'];
                                                                let newTemplates;
                                                                if (e.target.checked) {
                                                                    newTemplates = [...currentTemplates, template.filename];
                                                                } else {
                                                                    newTemplates = currentTemplates.filter(t => t !== template.filename);
                                                                    if (newTemplates.length === 0) newTemplates = ['uiuc_id_card.html'];
                                                                }
                                                                setUiucSettings(s => ({ ...s, templates: newTemplates }));
                                                            }}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>🪪 {template.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{
                                            marginTop: '16px',
                                            padding: '12px 16px',
                                            background: 'var(--bg-secondary)',
                                            borderRadius: '8px',
                                            fontSize: '13px'
                                        }}>
                                            <strong>📋 生成的字段:</strong>
                                            <ul style={{ margin: '8px 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                                                <li><strong>UIU:</strong> 76 + 5位随机数字</li>
                                                <li><strong>Library:</strong> 2 + 13位随机数字</li>
                                                <li><strong>Card:</strong> 563665 + 10位随机数字</li>
                                                <li><strong>Card Expires:</strong> 2027年随机日期</li>
                                                <li><strong>Photo:</strong> Gemini AI 生成</li>
                                            </ul>
                                        </div>

                                        <p className="input-hint" style={{ marginTop: '16px' }}>
                                            ⚠️ 此模式自动使用 University of Illinois Urbana-Champaign 作为学校
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* OnepassHTML Fixed Template Settings */}
                            {aiProvider === 'onepasshtml' && (
                                <div className="provider-settings">
                                    <h4>📝 OnepassHTML 固定模板配置</h4>
                                    <div className="settings-form">
                                        <div className="onepasshtml-info" style={{
                                            background: 'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>OnepassHTML 固定模板</strong> 使用预设的 HTML 模板为特定学校生成文档，
                                                每个模板对应一所固定学校，仅动态填充学生个人信息。
                                            </p>
                                        </div>
                                        <div className="input-group">
                                            <label className="input-label">选择模板 (可多选)</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                                {(onepasshtmlSettings.availableTemplates.length > 0 ? onepasshtmlSettings.availableTemplates : [
                                                    { filename: 'rit-demand-letter.html', label: 'RIT Demand Letter (催缴通知)' }
                                                ]).map(template => (
                                                    <label key={template.filename} style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 14px',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        background: (onepasshtmlSettings?.templates || []).includes(template.filename)
                                                            ? 'rgba(245, 158, 11, 0.1)' : 'var(--bg-secondary)',
                                                        border: (onepasshtmlSettings?.templates || []).includes(template.filename)
                                                            ? '1px solid #F59E0B'
                                                            : '1px solid transparent',
                                                        transition: 'all 0.2s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={(onepasshtmlSettings?.templates || []).includes(template.filename)}
                                                            onChange={(e) => {
                                                                const currentTemplates = onepasshtmlSettings?.templates || [];
                                                                let newTemplates;
                                                                if (e.target.checked) {
                                                                    newTemplates = [...currentTemplates, template.filename];
                                                                } else {
                                                                    newTemplates = currentTemplates.filter(t => t !== template.filename);
                                                                }
                                                                setOnepasshtmlSettings(s => ({ ...s, templates: newTemplates }));
                                                            }}
                                                            style={{ width: '16px', height: '16px' }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>📄 {template.label}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{
                                            marginTop: '16px',
                                            padding: '12px 16px',
                                            background: 'var(--bg-secondary)',
                                            borderRadius: '8px',
                                            fontSize: '13px'
                                        }}>
                                            <strong>📋 特点说明:</strong>
                                            <ul style={{ margin: '8px 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                                                <li><strong>固定学校:</strong> 每个模板对应特定学校，无需选择大学</li>
                                                <li><strong>动态信息:</strong> 学生姓名、学号、费用等自动随机生成</li>
                                                <li><strong>高质量:</strong> Puppeteer 渲染 + 截图，还原真实文档效果</li>
                                            </ul>
                                        </div>

                                        <p className="input-hint" style={{ marginTop: '16px' }}>
                                            ⚠️ 此模式使用模板中预设的学校信息，不会随机选择大学
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Telegram Userbot Settings */}
                            {aiProvider === 'telegram' && (
                                <div className="provider-settings">
                                    <h4>📨 Telegram Userbot 配置</h4>
                                    <div className="settings-form">
                                        <div className="telegram-info" style={{
                                            background: 'linear-gradient(135deg, #0088cc 0%, #005fa3 100%)',
                                            color: 'white',
                                            padding: '16px 20px',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <p style={{ margin: 0, fontSize: '14px' }}>
                                                <strong>Telegram Userbot</strong> 通过 Telegram 用户账号自动调用外部 SheerID Bot，
                                                将验证链接发送给 Bot 并获取验证结果。
                                            </p>
                                        </div>

                                        <div className="input-group">
                                            <label className="input-label">
                                                <input
                                                    type="checkbox"
                                                    checked={config?.verification?.telegram?.enabled || false}
                                                    onChange={(e) => {
                                                        setConfig(prev => ({
                                                            ...prev,
                                                            verification: {
                                                                ...prev.verification || {},
                                                                telegram: {
                                                                    ...prev.verification?.telegram || {},
                                                                    enabled: e.target.checked
                                                                }
                                                            }
                                                        }));
                                                    }}
                                                    style={{ marginRight: '8px' }}
                                                />
                                                启用 Telegram Userbot
                                            </label>
                                        </div>

                                        {config?.verification?.telegram?.enabled && (
                                            <>
                                                <div className="input-group">
                                                    <label className="input-label">API ID (from my.telegram.org)</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        value={config?.verification?.telegram?.apiId || ''}
                                                        onChange={(e) => {
                                                            setConfig(prev => ({
                                                                ...prev,
                                                                verification: {
                                                                    ...prev.verification || {},
                                                                    telegram: {
                                                                        ...prev.verification?.telegram || {},
                                                                        apiId: e.target.value
                                                                    }
                                                                }
                                                            }));
                                                        }}
                                                        placeholder="12345678"
                                                    />
                                                </div>

                                                <div className="input-group">
                                                    <label className="input-label">API Hash</label>
                                                    <input
                                                        type="password"
                                                        className="input"
                                                        value={config?.verification?.telegram?.apiHash || ''}
                                                        onChange={(e) => {
                                                            setConfig(prev => ({
                                                                ...prev,
                                                                verification: {
                                                                    ...prev.verification || {},
                                                                    telegram: {
                                                                        ...prev.verification?.telegram || {},
                                                                        apiHash: e.target.value
                                                                    }
                                                                }
                                                            }));
                                                        }}
                                                        placeholder="abcdef123456..."
                                                    />
                                                </div>

                                                <div className="input-group">
                                                    <label className="input-label">Target Bot</label>
                                                    <select
                                                        className="input"
                                                        value={config?.verification?.telegram?.botUsername || '@SheerID_Bot'}
                                                        onChange={(e) => {
                                                            setConfig(prev => ({
                                                                ...prev,
                                                                verification: {
                                                                    ...prev.verification || {},
                                                                    telegram: {
                                                                        ...prev.verification?.telegram || {},
                                                                        botUsername: e.target.value
                                                                    }
                                                                }
                                                            }));
                                                        }}
                                                        style={{ cursor: 'pointer' }}
                                                    >
                                                        <option value="@SheerID_Verification_bot">@SheerID_Verification_bot</option>
                                                        <option value="@SheerID_Gemini_2026_Bot">@SheerID_Gemini_2026_Bot</option>
                                                    </select>
                                                    <p className="input-hint">
                                                        {(config?.verification?.telegram?.botUsername || '@SheerID_Verification_bot') === '@SheerID_Verification_bot'
                                                            ? '当前: SheerID_Verification_bot'
                                                            : '当前: SheerID_Gemini_2026_Bot'
                                                        }
                                                        {' · 切换后需点击保存并重启生效'}
                                                    </p>
                                                </div>

                                                <div style={{
                                                    marginTop: '16px',
                                                    padding: '12px 16px',
                                                    background: 'var(--bg-secondary)',
                                                    borderRadius: '8px',
                                                    fontSize: '13px'
                                                }}>
                                                    <strong>ℹ️ 使用说明:</strong>
                                                    <ul style={{ margin: '8px 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                                                        <li>需要在 <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a> 获取 API ID 和 API Hash</li>
                                                        <li>首次启用后，需在服务器日志中输入 Telegram 登录验证码</li>
                                                        <li>Userbot 会自动将验证链接发送给目标 Bot 并解析结果</li>
                                                    </ul>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Region Mode Settings - Always visible */}
                            <div className="provider-settings region-settings" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                                <h4>🌍 验证地区配置</h4>
                                <p className="settings-desc" style={{ marginBottom: '16px' }}>
                                    选择生成验证文档时使用的学校地区范围
                                </p>
                                <div className="settings-form">
                                    <div className="input-group">
                                        <label className="input-label">地区模式</label>
                                        <select
                                            className="input"
                                            value={regionMode}
                                            onChange={(e) => setRegionMode(e.target.value)}
                                        >
                                            <option value="us_only">🇺🇸 仅美国学校 (US Only)</option>
                                            <option value="global">🌏 全球学校 (Global)</option>
                                        </select>
                                        <p className="input-hint">
                                            {regionMode === 'us_only'
                                                ? '仅使用美国学校生成验证文档，更稳定的验证通过率'
                                                : '随机选择全球学校生成验证文档，包括美国、欧洲、亚洲等地区'}
                                        </p>
                                    </div>
                                    <div className="input-group" style={{ marginTop: '16px' }}>
                                        <label className="input-label">学校来源</label>
                                        <select
                                            className="input"
                                            value={universitySource}
                                            onChange={(e) => setUniversitySource(e.target.value)}
                                        >
                                            <option value="sheerid_api">🔗 SheerID API 动态获取</option>
                                            <option value="custom_list">📋 自定义名单 (本地列表)</option>
                                        </select>
                                        <p className="input-hint">
                                            {universitySource === 'sheerid_api'
                                                ? '从 SheerID API 实时获取学校列表，确保 ID 准确匹配'
                                                : '使用预设的高成功率学校名单 (来自 ThanhNguyxn)，不依赖 API'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Proxy Settings - Always visible */}
                            <div className="provider-settings proxy-settings" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
                                <h4>🌐 住宅代理配置 (Residential Proxy)</h4>
                                <p className="settings-desc" style={{ marginBottom: '16px' }}>
                                    配置住宅代理可有效防止 SheerID 的 IP 风控检测 (fraudRulesReject)
                                </p>
                                <div className="settings-form">
                                    <div className="input-group">
                                        <label className="input-label">
                                            <input
                                                type="checkbox"
                                                checked={proxySettings.enabled}
                                                onChange={(e) => setProxySettings(s => ({ ...s, enabled: e.target.checked }))}
                                                style={{ marginRight: '8px' }}
                                            />
                                            启用代理
                                        </label>
                                    </div>
                                    {proxySettings.enabled && (
                                        <>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px' }}>
                                                <div className="input-group">
                                                    <label className="input-label">代理主机 (Host)</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        value={proxySettings.host}
                                                        onChange={(e) => setProxySettings(s => ({ ...s, host: e.target.value }))}
                                                        placeholder="proxy.global.ip2up.com"
                                                    />
                                                </div>
                                                <div className="input-group">
                                                    <label className="input-label">端口 (Port)</label>
                                                    <input
                                                        type="text"
                                                        className="input"
                                                        value={proxySettings.port}
                                                        onChange={(e) => setProxySettings(s => ({ ...s, port: e.target.value }))}
                                                        placeholder="12348"
                                                    />
                                                </div>
                                            </div>
                                            <div className="input-group">
                                                <label className="input-label">用户名 (Username)</label>
                                                <input
                                                    type="text"
                                                    className="input"
                                                    value={proxySettings.user}
                                                    onChange={(e) => setProxySettings(s => ({ ...s, user: e.target.value, hasStoredCredentials: false }))}
                                                    placeholder={proxySettings.hasStoredCredentials ? "••••••••••（已保存，留空保持不变）" : "hW32EF_200_0_0_..."}
                                                />
                                                <p className="input-hint">
                                                    ip2up 格式: <code>[account]_[country]_[province]_[city]_[session]_[sessionTime]_[flag]</code>
                                                </p>
                                            </div>
                                            <div className="input-group">
                                                <label className="input-label">密码 (Password)</label>
                                                <input
                                                    type="password"
                                                    className="input"
                                                    value={proxySettings.password}
                                                    onChange={(e) => setProxySettings(s => ({ ...s, password: e.target.value, hasStoredCredentials: false }))}
                                                    placeholder={proxySettings.hasStoredCredentials ? "••••••••••（已保存，留空保持不变）" : ""}
                                                />
                                                {proxySettings.hasStoredCredentials && (
                                                    <p className="input-hint">
                                                        <span className="key-stored">✓ 代理凭据已保存</span>
                                                    </p>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Test & Save Buttons */}
                            <div className="settings-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleTestConnection}
                                    disabled={testing}
                                >
                                    {testing ? '测试中...' : '🔌 测试连接'}
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleTestDocument}
                                    disabled={testingDocument}
                                >
                                    {testingDocument ? '生成中...' : '🖼️ 测试文档生成'}
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSaveAiConfig}
                                    disabled={saving}
                                >
                                    {saving ? '保存中...' : '💾 保存配置'}
                                </button>
                                {showSaveNotice && (
                                    <span className="save-notice">✓ 已保存</span>
                                )}
                            </div>

                            {/* Test Result */}
                            {testResult && (
                                <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                                    <span className="test-icon">{testResult.success ? '✅' : '❌'}</span>
                                    <span className="test-message">{testResult.message}</span>
                                </div>
                            )}

                            {/* Test Document Result */}
                            {testDocumentResult && (
                                <div className="test-document-result">
                                    <h4>📄 文档生成测试结果</h4>
                                    {testDocumentResult.success ? (
                                        <div className="test-document-content">
                                            {/* Display all generated documents */}
                                            <div className="test-document-images" style={{
                                                display: 'grid',
                                                gridTemplateColumns: testDocumentResult.images?.length > 1 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr',
                                                gap: '16px',
                                                marginBottom: '20px'
                                            }}>
                                                {(testDocumentResult.images || [{ image: testDocumentResult.image, filename: testDocumentResult.filename, type: 'document' }]).map((doc, idx) => (
                                                    <div key={idx} className="test-document-image" style={{
                                                        background: '#f8f9fa',
                                                        borderRadius: '12px',
                                                        padding: '12px',
                                                        textAlign: 'center'
                                                    }}>
                                                        <div style={{
                                                            fontSize: '12px',
                                                            color: '#667eea',
                                                            fontWeight: 600,
                                                            marginBottom: '8px',
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {doc.type === 'id_card' ? '🪪 学生卡' :
                                                                doc.type === 'transcript' ? '📜 成绩单' :
                                                                    doc.type === 'class_schedule' ? '📅 课程表' :
                                                                        doc.type === 'schedule' ? '📅 课程表' : '📄 文档'}
                                                        </div>
                                                        {(doc.filename?.endsWith('.pdf') || doc.image?.startsWith('data:application/pdf')) ? (
                                                            <div>
                                                                <embed
                                                                    src={doc.image}
                                                                    type="application/pdf"
                                                                    style={{
                                                                        width: '100%',
                                                                        height: '400px',
                                                                        borderRadius: '8px',
                                                                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                                                    }}
                                                                />
                                                                <a
                                                                    href={doc.image}
                                                                    download={doc.filename || 'document.pdf'}
                                                                    style={{
                                                                        display: 'inline-block',
                                                                        marginTop: '8px',
                                                                        padding: '6px 16px',
                                                                        background: '#667eea',
                                                                        color: '#fff',
                                                                        borderRadius: '6px',
                                                                        fontSize: '12px',
                                                                        textDecoration: 'none',
                                                                        fontWeight: 600
                                                                    }}
                                                                >📥 下载 PDF</a>
                                                            </div>
                                                        ) : (
                                                            <img
                                                                src={doc.image}
                                                                alt={doc.type || 'Generated Document'}
                                                                style={{
                                                                    maxWidth: '100%',
                                                                    maxHeight: '300px',
                                                                    borderRadius: '8px',
                                                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                                                }}
                                                            />
                                                        )}
                                                        <p className="filename" style={{
                                                            marginTop: '8px',
                                                            fontSize: '12px',
                                                            color: '#666'
                                                        }}>{doc.filename}</p>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Form data */}
                                            <div className="test-document-form-data" style={{
                                                background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)',
                                                borderRadius: '8px',
                                                padding: '12px 16px'
                                            }}>
                                                <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#667eea' }}>
                                                    📝 表单数据 (将提交到 SheerID)
                                                </h5>
                                                <table className="form-data-table" style={{ width: '100%', fontSize: '13px' }}>
                                                    <tbody>
                                                        {Object.entries(testDocumentResult.formData || {})
                                                            .filter(([key]) => ['firstName', 'lastName', 'university', 'birthDate', 'dob', 'email', 'studentId'].includes(key))
                                                            .map(([key, value]) => (
                                                                <tr key={key}>
                                                                    <td style={{ padding: '4px 8px', color: '#666', fontWeight: 500, width: '120px' }}>{key}</td>
                                                                    <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{value}</td>
                                                                </tr>
                                                            ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="test-result error">
                                            <span className="test-icon">❌</span>
                                            <span className="test-message">{testDocumentResult.message}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Info Card */}
                        <div className="settings-section card">
                            <h3>💡 说明</h3>
                            <div className="info-content">
                                <p><strong>🎨 Puppeteer HTML 模板（推荐）：</strong>使用 Puppeteer 渲染自定义 HTML 模板生成高质量学生证图片，支持 Gemini AI 生成逼真的学生证件照，效果最佳。</p>
                                <p><strong>Gemini 官方 API：</strong>直接调用 Google Gemini API 生成学生证图像，需要有效的 API Key。</p>
                                <p><strong>batch.1key.me API：</strong>使用第三方批量验证 API，需要配置 API Key。</p>
                                <p className="info-warning">⚠️ 如果 AI 生成失败，系统会自动回退到备用生成方式。</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Verify Status Tab */}
                {activeTab === 'verify-status' && (
                    <div className="tab-content">
                        {/* Live Grid Preview */}
                        <div className="settings-section card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h3 style={{ margin: 0 }}>📋 实时验证状态</h3>
                                <div style={{ display: 'flex', gap: '14px', fontSize: '13px' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                                        {historyStats.pass} Pass
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }}></span>
                                        {historyStats.failed} Failed
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }}></span>
                                        {historyStats.cancel} Cancel
                                    </span>
                                </div>
                            </div>
                            <div className="status-grid-container">
                                <div className="status-grid three-rows">
                                    {historyData.slice(-60).map((item) => (
                                        <div
                                            key={item.id}
                                            className={`status-block ${item.status}`}
                                            onMouseEnter={() => setHoveredStatusItem(item)}
                                            onMouseLeave={() => setHoveredStatusItem(null)}
                                        >
                                            {hoveredStatusItem?.id === item.id && (
                                                <div className="status-tooltip">
                                                    <span className="tooltip-status">
                                                        {item.status === 'pass' ? '✓ Pass' :
                                                            item.status === 'failed' ? '✕ Failed' :
                                                                item.status === 'processing' ? '⏳ Processing' : '◷ Cancel'}
                                                    </span>
                                                    <span className="tooltip-time">{item.timestamp?.split('T')[1]?.slice(0, 8) || ''}</span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {historyData.length === 0 && (
                                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', padding: '20px 0' }}>暂无验证记录</p>
                            )}
                        </div>

                        {/* Controls */}
                        <div className="settings-section card">
                            <h3>➕ 添加记录</h3>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' }}>
                                <input
                                    type="number"
                                    min="1"
                                    max="50"
                                    value={addCount}
                                    onChange={(e) => setAddCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                                    className="input"
                                    style={{ width: '70px', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>条</span>
                                {[
                                    { status: 'pass', label: '✅ Pass', color: '#10b981' },
                                    { status: 'failed', label: '❌ Failed', color: '#ef4444' },
                                    { status: 'cancel', label: '◷ Cancel', color: '#94a3b8' },
                                ].map(item => (
                                    <button
                                        key={item.status}
                                        disabled={addingStatus !== null}
                                        className="btn btn-sm"
                                        style={{
                                            background: addingStatus === item.status ? '#999' : item.color,
                                            color: '#fff',
                                            border: 'none',
                                            padding: '6px 14px',
                                            borderRadius: '6px',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            cursor: addingStatus !== null ? 'not-allowed' : 'pointer',
                                            opacity: addingStatus !== null && addingStatus !== item.status ? 0.5 : 1
                                        }}
                                        onClick={async () => {
                                            if (addingStatus !== null) return;
                                            setAddingStatus(item.status);
                                            try {
                                                const res = await fetch(`${API_BASE}/api/verify/history`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ status: item.status, count: addCount })
                                                });
                                                if (res.ok) {
                                                    const data = await res.json();
                                                    // Re-fetch to get accurate grid
                                                    const hRes = await fetch(`${API_BASE}/api/verify/history`);
                                                    if (hRes.ok) {
                                                        const hData = await hRes.json();
                                                        setHistoryData(hData.history || []);
                                                        setHistoryStats(hData.stats || { pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
                                                    }
                                                }
                                            } catch (e) {
                                                alert('添加失败: ' + e.message);
                                            } finally {
                                                setAddingStatus(null);
                                            }
                                        }}
                                    >
                                        {addingStatus === item.status ? '...' : item.label}
                                    </button>
                                ))}
                            </div>

                            {/* Clear All */}
                            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border, #e2ddd8)' }}>
                                <button
                                    className="btn btn-sm"
                                    disabled={addingStatus !== null}
                                    style={{
                                        background: 'transparent',
                                        color: '#ef4444',
                                        border: '1px solid #ef4444',
                                        padding: '6px 16px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                    onClick={async () => {
                                        if (!confirm('确定要清空所有验证状态记录吗？此操作不可撤销。')) return;
                                        try {
                                            const res = await fetch(`${API_BASE}/api/verify/history`, { method: 'DELETE' });
                                            if (res.ok) {
                                                const data = await res.json();
                                                setHistoryData([]);
                                                setHistoryStats({ pass: 0, failed: 0, processing: 0, cancel: 0, total: 0 });
                                            }
                                        } catch (e) {
                                            alert('清空失败: ' + e.message);
                                        }
                                    }}
                                >
                                    🗑️ 清空所有记录
                                </button>
                                <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    共 {historyStats.total || 0} 条记录
                                </span>
                            </div>
                        </div>

                        {/* Auto Record Rules */}
                        <div className="settings-section card">
                            <h3>⏱️ 自动添加记录</h3>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 16px' }}>
                                配置自动添加规则，规则持久化保存，重启后自动恢复
                            </p>

                            {/* Existing rules list */}
                            {autoRules.length > 0 && (
                                <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {autoRules.map(rule => (
                                        <div key={rule.id} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '10px 14px',
                                            background: rule.enabled ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-secondary)',
                                            border: `1px solid ${rule.enabled ? 'rgba(16, 185, 129, 0.25)' : 'var(--border-primary)'}`,
                                            borderRadius: '8px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{
                                                    width: 8, height: 8, borderRadius: '50%',
                                                    background: rule.running ? '#10b981' : '#94a3b8',
                                                    display: 'inline-block'
                                                }}></span>
                                                <span style={{ fontSize: '13px', fontWeight: 500 }}>
                                                    每 {rule.intervalMinutes || Math.round((rule.intervalSeconds || 60) / 60)} 分钟 → {rule.status === 'pass' ? '✅ Pass' : rule.status === 'failed' ? '❌ Failed' : '◷ Cancel'}
                                                </span>
                                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                                    {rule.running ? '运行中' : '已停止'}
                                                    {rule.durationHours > 0 && (
                                                        rule.running && rule.remainingHours != null
                                                            ? ` · 剩余 ${rule.remainingHours}h`
                                                            : ` · 时效 ${rule.durationHours}h`
                                                    )}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    className="btn btn-sm"
                                                    style={{
                                                        background: rule.enabled ? '#f59e0b' : '#10b981',
                                                        color: '#fff',
                                                        border: 'none',
                                                        padding: '4px 12px',
                                                        borderRadius: '5px',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                    onClick={async () => {
                                                        try {
                                                            const res = await fetch(`${API_BASE}/api/verify/auto-record/${rule.id}`, {
                                                                method: 'PUT',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ enabled: !rule.enabled })
                                                            });
                                                            if (res.ok) {
                                                                const listRes = await fetch(`${API_BASE}/api/verify/auto-record`);
                                                                if (listRes.ok) setAutoRules((await listRes.json()).rules || []);
                                                            }
                                                        } catch (e) { alert(e.message); }
                                                    }}
                                                >
                                                    {rule.enabled ? '⏸ 停止' : '▶ 启动'}
                                                </button>
                                                <button
                                                    className="btn btn-sm"
                                                    style={{
                                                        background: 'transparent',
                                                        color: '#ef4444',
                                                        border: '1px solid #ef4444',
                                                        padding: '4px 10px',
                                                        borderRadius: '5px',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                    onClick={async () => {
                                                        if (!confirm('删除此规则？')) return;
                                                        try {
                                                            await fetch(`${API_BASE}/api/verify/auto-record/${rule.id}`, { method: 'DELETE' });
                                                            const listRes = await fetch(`${API_BASE}/api/verify/auto-record`);
                                                            if (listRes.ok) setAutoRules((await listRes.json()).rules || []);
                                                        } catch (e) { alert(e.message); }
                                                    }}
                                                >
                                                    🗑
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add new rule */}
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', paddingTop: autoRules.length > 0 ? '12px' : 0, borderTop: autoRules.length > 0 ? '1px solid var(--border-primary)' : 'none' }}>
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>新规则：每</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="60"
                                    value={newRule.intervalMinutes}
                                    onChange={(e) => setNewRule(prev => ({ ...prev, intervalMinutes: Math.max(1, parseInt(e.target.value) || 5) }))}
                                    className="input"
                                    style={{ width: '65px', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>分钟 添加</span>
                                <select
                                    className="input"
                                    value={newRule.status}
                                    onChange={(e) => setNewRule(prev => ({ ...prev, status: e.target.value }))}
                                    style={{ width: '110px', cursor: 'pointer' }}
                                >
                                    <option value="pass">✅ Pass</option>
                                    <option value="failed">❌ Failed</option>
                                    <option value="cancel">◷ Cancel</option>
                                </select>
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>时效</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="72"
                                    step="1"
                                    value={newRule.durationHours}
                                    onChange={(e) => setNewRule(prev => ({ ...prev, durationHours: Math.max(0, parseFloat(e.target.value) || 0) }))}
                                    className="input"
                                    style={{ width: '65px', textAlign: 'center' }}
                                />
                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>小时</span>
                                <button
                                    className="btn btn-sm"
                                    disabled={savingRule}
                                    style={{
                                        background: '#10b981',
                                        color: '#fff',
                                        border: 'none',
                                        padding: '6px 16px',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                    onClick={async () => {
                                        setSavingRule(true);
                                        try {
                                            const res = await fetch(`${API_BASE}/api/verify/auto-record`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify(newRule)
                                            });
                                            if (res.ok) {
                                                const listRes = await fetch(`${API_BASE}/api/verify/auto-record`);
                                                if (listRes.ok) setAutoRules((await listRes.json()).rules || []);
                                            }
                                        } catch (e) {
                                            alert('添加失败: ' + e.message);
                                        } finally {
                                            setSavingRule(false);
                                        }
                                    }}
                                >
                                    {savingRule ? '...' : '➕ 添加规则'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <div className="tab-content">

                        {/* Browser Mode - only shown when provider is not telegram */}
                        {aiProvider !== 'telegram' && (
                            <div className="settings-section card">
                                <h3>⚡ 验证模式</h3>
                                <p className="settings-desc">
                                    选择验证请求的发送方式。API 模式速度快，浏览器模式使用 Chromium 模拟真实浏览器，更不容易被检测。
                                </p>
                                <div className="settings-form">
                                    <div className="mode-selector" style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                                        <div
                                            onClick={() => setBrowserMode(false)}
                                            style={{
                                                flex: 1, padding: '16px', borderRadius: '12px', cursor: 'pointer',
                                                border: !browserMode ? '2px solid #7c5cfc' : '2px solid #e2e8f0',
                                                background: !browserMode ? 'linear-gradient(135deg, #f0ecff 0%, #e8e0ff 100%)' : '#f8fafc',
                                                transition: 'all 0.2s ease'
                                            }}
                                        >
                                            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚡</div>
                                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>API 模式</div>
                                            <div style={{ fontSize: '12px', color: '#64748b' }}>标准 HTTP 请求，速度快</div>
                                        </div>
                                        <div
                                            onClick={() => setBrowserMode(true)}
                                            style={{
                                                flex: 1, padding: '16px', borderRadius: '12px', cursor: 'pointer',
                                                border: browserMode ? '2px solid #7c5cfc' : '2px solid #e2e8f0',
                                                background: browserMode ? 'linear-gradient(135deg, #f0ecff 0%, #e8e0ff 100%)' : '#f8fafc',
                                                transition: 'all 0.2s ease'
                                            }}
                                        >
                                            <div style={{ fontSize: '24px', marginBottom: '8px' }}>🌐</div>
                                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>浏览器模式</div>
                                            <div style={{ fontSize: '12px', color: '#64748b' }}>Chromium 模拟真实浏览器</div>
                                        </div>
                                    </div>
                                    <button className="btn btn-primary" onClick={handleSaveAiConfig} disabled={saving}>
                                        {saving ? '保存中...' : '保存'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {aiProvider === 'telegram' && (
                            <div className="settings-section card">
                                <h3>🤖 Telegram Bot 验证</h3>
                                <p className="settings-desc">
                                    当前使用 Telegram Bot 进行验证，无需选择验证模式。链接将直接发送给 @SheerID_Verification_bot 处理。
                                </p>
                            </div>
                        )}

                        {/* Maintenance Mode Card */}
                        <div className="settings-section card" style={{
                            border: maintenanceEnabled ? '2px solid #ef4444' : '2px solid transparent',
                            transition: 'all 0.3s ease',
                            overflow: 'hidden',
                            padding: 0
                        }}>
                            {/* Status Banner */}
                            <div style={{
                                padding: '14px 20px',
                                background: maintenanceEnabled
                                    ? 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)'
                                    : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                                borderBottom: '1px solid',
                                borderColor: maintenanceEnabled ? '#fecaca' : '#bbf7d0',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                transition: 'all 0.3s ease'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{
                                        width: '10px', height: '10px', borderRadius: '50%',
                                        background: maintenanceEnabled ? '#ef4444' : '#22c55e',
                                        boxShadow: maintenanceEnabled ? '0 0 8px rgba(239,68,68,0.5)' : '0 0 8px rgba(34,197,94,0.5)',
                                        animation: maintenanceEnabled ? 'pulse 2s infinite' : 'none'
                                    }} />
                                    <span style={{
                                        fontSize: '14px', fontWeight: 600,
                                        color: maintenanceEnabled ? '#dc2626' : '#16a34a'
                                    }}>
                                        {maintenanceEnabled ? '维护模式已开启' : '网站运行正常'}
                                    </span>
                                </div>
                                {/* Toggle Switch */}
                                <div
                                    onClick={() => setMaintenanceEnabled(!maintenanceEnabled)}
                                    style={{
                                        width: '52px', height: '28px', borderRadius: '14px', cursor: 'pointer',
                                        background: maintenanceEnabled ? 'linear-gradient(135deg, #ef4444, #dc2626)' : '#d1d5db',
                                        position: 'relative', transition: 'all 0.3s ease',
                                        boxShadow: maintenanceEnabled ? '0 0 12px rgba(239,68,68,0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.1)',
                                        flexShrink: 0
                                    }}
                                >
                                    <div style={{
                                        width: '22px', height: '22px', borderRadius: '50%',
                                        background: '#fff', position: 'absolute', top: '3px',
                                        left: maintenanceEnabled ? '27px' : '3px',
                                        transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                                    }} />
                                </div>
                            </div>

                            {/* Card Body */}
                            <div style={{ padding: '20px 20px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                    <span style={{ fontSize: '20px' }}>🚧</span>
                                    <h3 style={{ margin: 0, fontSize: '16px' }}>维护模式设置</h3>
                                </div>

                                {/* Form Fields */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {/* Message Field */}
                                    <div>
                                        <label style={{
                                            display: 'block', fontSize: '13px', fontWeight: 500,
                                            color: 'var(--text-secondary, #64748b)', marginBottom: '6px'
                                        }}>
                                            📝 维护公告内容
                                        </label>
                                        <textarea
                                            className="input textarea"
                                            placeholder="输入将向用户显示的维护公告..."
                                            rows={3}
                                            value={maintenanceMessage}
                                            onChange={(e) => setMaintenanceMessage(e.target.value)}
                                            style={{
                                                resize: 'vertical', minHeight: '72px',
                                                fontSize: '14px', lineHeight: '1.5',
                                                width: '100%', boxSizing: 'border-box'
                                            }}
                                        />
                                    </div>

                                    {/* Estimated End Time */}
                                    <div>
                                        <label style={{
                                            display: 'block', fontSize: '13px', fontWeight: 500,
                                            color: 'var(--text-secondary, #64748b)', marginBottom: '6px'
                                        }}>
                                            🕐 预计恢复时间 <span style={{ fontWeight: 400, color: '#94a3b8' }}>（可选）</span>
                                        </label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <input
                                                type="datetime-local"
                                                className="input"
                                                value={maintenanceEstEnd ? maintenanceEstEnd.slice(0, 16) : ''}
                                                onChange={(e) => setMaintenanceEstEnd(e.target.value ? new Date(e.target.value).toISOString() : '')}
                                                style={{ flex: 1, fontSize: '14px' }}
                                            />
                                            {maintenanceEstEnd && (
                                                <button
                                                    onClick={() => setMaintenanceEstEnd('')}
                                                    style={{
                                                        background: 'none', border: 'none', cursor: 'pointer',
                                                        color: '#94a3b8', fontSize: '18px', padding: '4px',
                                                        lineHeight: 1
                                                    }}
                                                    title="清除时间"
                                                >✕</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Action Bar */}
                            <div style={{
                                display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px',
                                padding: '16px 20px',
                                marginTop: '20px',
                                borderTop: '1px solid var(--border-color, #e2e8f0)',
                                background: 'var(--bg-secondary, #f8fafc)'
                            }}>
                                {maintenanceSaved && (
                                    <span style={{
                                        color: '#10b981', fontSize: '13px', fontWeight: 500,
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        animation: 'fadeIn 0.3s ease'
                                    }}>
                                        <span>✓</span> 已保存
                                    </span>
                                )}
                                <button
                                    onClick={handleSaveMaintenance}
                                    disabled={maintenanceSaving}
                                    style={{
                                        padding: '8px 24px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        cursor: maintenanceSaving ? 'not-allowed' : 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        color: '#fff',
                                        background: maintenanceEnabled
                                            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                                            : 'linear-gradient(135deg, #7c5cfc, #6d4fe8)',
                                        boxShadow: maintenanceEnabled
                                            ? '0 2px 8px rgba(239,68,68,0.3)'
                                            : '0 2px 8px rgba(124,92,252,0.3)',
                                        transition: 'all 0.2s ease',
                                        opacity: maintenanceSaving ? 0.7 : 1,
                                        display: 'flex', alignItems: 'center', gap: '6px'
                                    }}
                                >
                                    {maintenanceSaving ? (
                                        <><span className="loading-spinner small" /> 保存中...</>
                                    ) : maintenanceEnabled ? (
                                        '保存并启用维护'
                                    ) : (
                                        '保存设置'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}

