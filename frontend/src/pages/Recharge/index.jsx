import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import './Recharge.css';

export default function Recharge() {
    const { user, loading, updateCredits } = useAuth();
    const navigate = useNavigate();
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    const plans = [
        { id: 1, quota: 1, price: 3 },
        { id: 2, quota: 5, price: 13, popular: true },
        { id: 3, quota: 20, price: 40 },
        { id: 4, quota: 100, price: 150 },
    ];

    const handleSelectPlan = (plan) => {
        setSelectedPlan(plan);
        setShowModal(true);
    };

    const handlePayment = async (method) => {
        setIsProcessing(true);

        // 模拟支付流程
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 支付成功，增加配额
        updateCredits(selectedPlan.quota);

        setIsProcessing(false);
        setShowModal(false);
        setSelectedPlan(null);

        alert(`充值成功！已获得 ${selectedPlan.quota} 次配额`);
        navigate('/verify');
    };

    if (loading || !user) return null;

    return (
        <div className="recharge-page">
            <div className="container">
                {/* Header */}
                <div className="page-header">
                    <h1 className="page-title">💰 充值配额</h1>
                    <p className="page-desc">选择适合您的套餐，获取验证配额</p>
                    <div className="current-balance">
                        <span className="balance-label">当前余额</span>
                        <span className="balance-value">
                            <span className="balance-icon">🎫</span>
                            {user.credits} 次
                        </span>
                    </div>
                </div>

                {/* Plans Grid */}
                <div className="plans-grid">
                    {plans.map(plan => (
                        <div
                            key={plan.id}
                            className={`plan-card card ${plan.popular ? 'popular' : ''}`}
                        >
                            {plan.popular && (
                                <span className="popular-badge">🔥 最受欢迎</span>
                            )}
                            <div className="plan-credits">
                                <span className="credits-value">{plan.quota}</span>
                                <span className="credits-label">次</span>
                            </div>
                            <div className="plan-price">
                                <span className="price-currency">¥</span>
                                <span className="price-value">{plan.price}</span>
                            </div>
                            <button
                                className="btn btn-primary plan-btn"
                                onClick={() => handleSelectPlan(plan)}
                            >
                                立即购买
                            </button>
                        </div>
                    ))}
                </div>

                {/* Features */}
                <div className="features-section">
                    <h3>为什么选择我们的充值服务？</h3>
                    <div className="features-list">
                        <div className="feature-item">
                            <span className="feature-icon">⚡</span>
                            <span>即时到账</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">🔒</span>
                            <span>安全支付</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">🎁</span>
                            <span>买多更优惠</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">💬</span>
                            <span>7×24 客服支持</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Payment Modal */}
            {showModal && selectedPlan && (
                <div className="modal-overlay" onClick={() => !isProcessing && setShowModal(false)}>
                    <div className="modal card payment-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>确认订单</h2>
                            <button
                                className="modal-close"
                                onClick={() => !isProcessing && setShowModal(false)}
                                disabled={isProcessing}
                            >
                                ×
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="payment-summary">
                                <div className="summary-row">
                                    <span>购买配额</span>
                                    <span>{selectedPlan.quota} 次</span>
                                </div>
                                <div className="summary-row total">
                                    <span>应付金额</span>
                                    <span className="total-price">¥{selectedPlan.price}</span>
                                </div>
                            </div>
                            <div className="payment-methods">
                                <h4>选择支付方式</h4>
                                <div className="methods-list">
                                    <button
                                        className="method-btn"
                                        onClick={() => handlePayment('alipay')}
                                        disabled={isProcessing}
                                    >
                                        <span className="method-icon">💙</span>
                                        <span>支付宝</span>
                                    </button>
                                    <button
                                        className="method-btn"
                                        onClick={() => handlePayment('wechat')}
                                        disabled={isProcessing}
                                    >
                                        <span className="method-icon">�</span>
                                        <span>微信支付</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        {isProcessing && (
                            <div className="processing-overlay">
                                <div className="processing-spinner"></div>
                                <span>正在处理支付...</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
