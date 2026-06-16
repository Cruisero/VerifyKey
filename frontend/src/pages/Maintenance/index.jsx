import { useLang } from '../../stores/LanguageContext';
import './Maintenance.css';

export default function Maintenance({ message, estimatedEnd }) {
    const { t } = useLang();

    const formatEndTime = (isoString) => {
        if (!isoString) return null;
        try {
            const date = new Date(isoString);
            return date.toLocaleString();
        } catch {
            return null;
        }
    };

    const endTimeStr = formatEndTime(estimatedEnd);

    return (
        <div className="maintenance-page">
            <div className="maintenance-bg">
                <div className="maintenance-orb orb-1"></div>
                <div className="maintenance-orb orb-2"></div>
                <div className="maintenance-orb orb-3"></div>
            </div>

            <div className="maintenance-container">
                <div className="maintenance-icon-wrap">
                    <div className="maintenance-gear gear-large">⚙️</div>
                    <div className="maintenance-gear gear-small">🔧</div>
                </div>

                <h1 className="maintenance-title">
                    {t('underMaintenance')}
                </h1>

                <p className="maintenance-message">
                    {message || t('maintenanceMsg')}
                </p>

                {endTimeStr && (
                    <div className="maintenance-eta">
                        <span className="maintenance-eta-icon">🕐</span>
                        <span>{t('etaLabel').replace('{time}', endTimeStr)}</span>
                    </div>
                )}

                <div className="maintenance-dots">
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
                </div>

                <p className="maintenance-sub">
                    {t('maintenanceSub')}
                </p>
            </div>
        </div>
    );
}
