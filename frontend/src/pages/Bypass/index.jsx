import { useState, useRef, useEffect } from 'react';
import './Bypass.css';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3002' : '');

function Bypass() {
    const [link, setLink] = useState('');
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState([]);
    const [result, setResult] = useState(null);
    const logRef = useRef(null);

    // Auto-scroll logs
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs]);

    const handleBypass = async () => {
        if (!link.trim() || running) return;

        setRunning(true);
        setLogs([]);
        setResult(null);

        try {
            const response = await fetch(`${API_BASE}/api/bypass`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ link: link.trim() }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                setLogs([{ time: new Date().toLocaleTimeString(), level: 'error', message: err.detail || `HTTP ${response.status}` }]);
                setRunning(false);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.done !== undefined) {
                                setResult(data);
                            } else if (data.message) {
                                setLogs(prev => [...prev, data]);
                            }
                        } catch { }
                    }
                }
            }
        } catch (e) {
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), level: 'error', message: `连接错误: ${e.message}` }]);
        }

        setRunning(false);
    };

    const getLogColor = (level) => {
        switch (level) {
            case 'error': return '#ff6b6b';
            case 'warn': return '#ffd93d';
            case 'success': return '#51cf66';
            default: return '#dee2e6';
        }
    };

    return (
        <div className="bypass-page">
            <div className="bypass-container">
                {/* Header */}
                <div className="bypass-header">
                    <div className="bypass-logo">
                        <span className="bypass-icon">🔓</span>
                        <h1>
                            Bypass<span className="bypass-pro">Pro</span>
                        </h1>
                    </div>
                    <p className="bypass-subtitle">SheerID Link Reset Tool</p>
                </div>

                {/* Main Card */}
                <div className="bypass-card">
                    {/* Input Section */}
                    <div className="bypass-section">
                        <label className="bypass-label">VERIFICATION TARGET</label>
                        <div className="bypass-input-wrap">
                            <span className="bypass-input-icon">🔗</span>
                            <input
                                type="text"
                                className="bypass-input"
                                placeholder="https://services.sheerid.com/verify/...?verificationId=..."
                                value={link}
                                onChange={(e) => setLink(e.target.value)}
                                disabled={running}
                                onKeyDown={(e) => e.key === 'Enter' && handleBypass()}
                            />
                        </div>
                    </div>

                    {/* Action Button */}
                    <button
                        className={`bypass-btn ${running ? 'bypass-btn-running' : ''}`}
                        onClick={handleBypass}
                        disabled={running || !link.trim()}
                    >
                        {running ? (
                            <>
                                <span className="bypass-spinner"></span>
                                执行中...
                            </>
                        ) : (
                            <>
                                <span>⚡</span> 开始 Bypass
                            </>
                        )}
                    </button>

                    {/* Result */}
                    {result && (
                        <div className={`bypass-result ${result.success ? 'bypass-result-success' : 'bypass-result-error'}`}>
                            <span className="bypass-result-icon">{result.success ? '✅' : '❌'}</span>
                            <span>
                                {result.success
                                    ? `Bypass 完成! ${result.uploads !== undefined ? `成功上传 ${result.uploads} 次` : '链接已是成功状态'}`
                                    : `Bypass 失败: ${result.error || '未知错误'}`}
                            </span>
                        </div>
                    )}
                </div>

                {/* Log Terminal */}
                <div className="bypass-terminal">
                    <div className="bypass-terminal-header">
                        <div className="bypass-terminal-dots">
                            <span className="dot red"></span>
                            <span className="dot yellow"></span>
                            <span className="dot green"></span>
                        </div>
                        <span className="bypass-terminal-title">System Logs (Live Stream)</span>
                    </div>
                    <div className="bypass-terminal-body" ref={logRef}>
                        {logs.length === 0 ? (
                            <div className="bypass-terminal-empty">等待操作...</div>
                        ) : (
                            logs.map((log, i) => (
                                <div key={i} className="bypass-log-line" style={{ color: getLogColor(log.level) }}>
                                    <span className="bypass-log-time">[{log.time}]</span>
                                    {log.level === 'success' && <span className="bypass-log-badge">✅</span>}
                                    {log.level === 'error' && <span className="bypass-log-badge">❌</span>}
                                    {log.level === 'warn' && <span className="bypass-log-badge">⚠️</span>}
                                    <span className="bypass-log-msg">{log.message}</span>
                                </div>
                            ))
                        )}
                        {running && <span className="bypass-cursor">▋</span>}
                    </div>
                </div>

                {/* Footer */}
                <div className="bypass-footer">
                    Powered by <span className="bypass-footer-link">OnePASS</span>
                </div>
            </div>
        </div>
    );
}

export default Bypass;
