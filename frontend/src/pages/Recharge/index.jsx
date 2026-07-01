import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';
import { useLang } from '../../stores/LanguageContext';
import './Recharge.css';

export default function Recharge() {
    const { lang, t } = useLang();
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

        alert(t('rechargeSuccessAlert').replace('{quota}', selectedPlan.quota));
        navigate('/verify');
    };

    if (loading || !user) return null;

    return (
        <div className="recharge-page">
            <div className="container">
                {/* Header */}
                <div className="page-header">
                    <h1 className="page-title">{t('rechargeQuotaTitle')}</h1>
                    <p className="page-desc">{t('rechargeQuotaDesc')}</p>
                    <div className="current-balance">
                        <span className="balance-label">{t('currentBalanceLabel')}</span>
                        <span className="balance-value">
                            <span className="balance-icon">🎫</span>
                            {user.credits} {t('timesUnit')}
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
                                <span className="popular-badge">{t('mostPopular')}</span>
                            )}
                            <div className="plan-credits">
                                <span className="credits-value">{plan.quota}</span>
                                <span className="credits-label">{t('timesUnit')}</span>
                            </div>
                            <div className="plan-price">
                                <span className="price-currency">¥</span>
                                <span className="price-value">{plan.price}</span>
                            </div>
                            <button
                                className="btn btn-primary plan-btn"
                                onClick={() => handleSelectPlan(plan)}
                            >
                                {t('buyNowBtn')}
                            </button>
                        </div>
                    ))}
                </div>

                {/* Features */}
                <div className="features-section">
                    <h3>{t('whyChooseRechargeTitle')}</h3>
                    <div className="features-list">
                        <div className="feature-item">
                            <span className="feature-icon">⚡</span>
                            <span>{t('featureInstantTitle')}</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">🔒</span>
                            <span>{t('featureSecureTitle')}</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">🎁</span>
                            <span>{t('featureDiscountTitle')}</span>
                        </div>
                        <div className="feature-item">
                            <span className="feature-icon">💬</span>
                            <span>{t('featureCsTitle')}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Payment Modal */}
            {showModal && selectedPlan && (
                <div className="modal-overlay" onClick={() => !isProcessing && setShowModal(false)}>
                    <div className="modal card payment-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{t('confirmOrderTitle')}</h2>
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
                                    <span>{lang === 'zh' ? '购买配额' : 'Purchase Quota'}</span>
                                    <span>{selectedPlan.quota} {t('timesUnit')}</span>
                                </div>
                                <div className="summary-row total">
                                    <span>{t('payableAmount')}</span>
                                    <span className="total-price">¥{selectedPlan.price}</span>
                                </div>
                            </div>
                            <div className="payment-methods">
                                <h4>{t('selectPaymentMethod')}</h4>
                                <div className="methods-list">
                                    <button
                                        className="method-btn"
                                        onClick={() => handlePayment('alipay')}
                                        disabled={isProcessing}
                                    >
                                        <span className="method-icon">💙</span>
                                        <span>{t('alipay')}</span>
                                    </button>
                                    <button
                                        className="method-btn"
                                        onClick={() => handlePayment('wechat')}
                                        disabled={isProcessing}
                                    >
                                        <span className="method-icon">💚</span>
                                        <span>{t('wechatPay')}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        {isProcessing && (
                            <div className="processing-overlay">
                                <div className="processing-spinner"></div>
                                <span>{t('processingPayment')}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
