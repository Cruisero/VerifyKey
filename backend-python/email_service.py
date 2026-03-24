"""
Email Service for OnePASS
Handles SMTP email sending for password reset and notifications
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def get_email_config():
    """Get email configuration from config.json"""
    import config_manager
    config = config_manager.get_config()
    return config.get("email", {})


def _connect_smtp(cfg):
    """Connect to SMTP server with automatic SSL/STARTTLS detection"""
    host = cfg["smtpHost"]
    port = int(cfg.get("smtpPort", 465))
    user = cfg["smtpUser"]
    password = cfg.get("smtpPassword", "")
    use_ssl = cfg.get("useSsl", True)

    errors = []

    # Strategy 1: SSL direct (typical for port 465)
    if use_ssl:
        try:
            server = smtplib.SMTP_SSL(host, port, timeout=10)
            server.login(user, password)
            return server
        except Exception as e:
            errors.append(f"SSL: {e}")

    # Strategy 2: STARTTLS (typical for port 587)
    try:
        server = smtplib.SMTP(host, port, timeout=10)
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(user, password)
        return server
    except Exception as e:
        errors.append(f"STARTTLS: {e}")

    # Strategy 3: If SSL was not tried, try it now
    if not use_ssl:
        try:
            server = smtplib.SMTP_SSL(host, port, timeout=10)
            server.login(user, password)
            return server
        except Exception as e:
            errors.append(f"SSL fallback: {e}")

    raise Exception(" | ".join(errors))


def test_email_connection():
    """Test SMTP connection with stored config"""
    cfg = get_email_config()
    if not cfg.get("smtpHost") or not cfg.get("smtpUser"):
        return {"success": False, "message": "邮箱未配置"}

    try:
        server = _connect_smtp(cfg)
        server.quit()
        return {"success": True, "message": "连接成功！邮箱配置正确"}
    except smtplib.SMTPAuthenticationError:
        return {"success": False, "message": "认证失败，请检查用户名和密码/授权码"}
    except Exception as e:
        return {"success": False, "message": f"连接失败: {str(e)}"}


def send_email(to_email: str, subject: str, html_content: str) -> bool:
    """Send an email using configured SMTP"""
    cfg = get_email_config()
    if not cfg.get("smtpHost") or not cfg.get("smtpUser"):
        print("[Email] Email not configured, skipping send")
        return False

    try:
        sender_name = cfg.get("senderName", "OnePASS")
        user = cfg["smtpUser"]

        msg = MIMEMultipart("alternative")
        msg["From"] = f"{sender_name} <{user}>"
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        server = _connect_smtp(cfg)
        server.sendmail(user, to_email, msg.as_string())
        server.quit()
        print(f"[Email] Sent to {to_email}: {subject}")
        return True
    except Exception as e:
        print(f"[Email] Failed to send to {to_email}: {e}")
        return False


def send_reset_email(to_email: str, reset_link: str) -> bool:
    """Send password reset email with a styled HTML template"""
    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
        <tr><td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;">
            <!-- Header -->
            <tr><td style="background:linear-gradient(135deg,#7c5cfc,#6366f1);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;letter-spacing:1px;">OnePASS</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">密码重置</p>
            </td></tr>
            <!-- Body -->
            <tr><td style="padding:36px 40px;">
              <p style="margin:0 0 16px;font-size:16px;color:#1a1a2e;line-height:1.6;">您好，</p>
              <p style="margin:0 0 24px;font-size:15px;color:#4a4a68;line-height:1.7;">
                我们收到了您的密码重置请求。请点击下方按钮设置新密码：
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td align="center" style="padding:8px 0 24px;">
                  <a href="{reset_link}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#7c5cfc,#6366f1);color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(124,92,252,0.35);">
                    重置密码
                  </a>
                </td></tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;line-height:1.6;">
                此链接将在 <strong>1 小时</strong>后失效。如果您没有发起此请求，请忽略此邮件。
              </p>
              <hr style="border:none;border-top:1px solid #f0f0f5;margin:24px 0;" />
              <p style="margin:0;font-size:12px;color:#c0c0d0;line-height:1.5;">
                如果按钮无法点击，请复制以下链接到浏览器打开：<br/>
                <a href="{reset_link}" style="color:#7c5cfc;word-break:break-all;">{reset_link}</a>
              </p>
            </td></tr>
            <!-- Footer -->
            <tr><td style="padding:20px 40px;background:#fafafa;text-align:center;border-top:1px solid #f0f0f5;">
              <p style="margin:0;font-size:12px;color:#b0b0c0;">© OnePASS · 此邮件由系统自动发送，请勿回复</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
    """
    return send_email(to_email, "OnePASS - 重置您的密码", html)


def get_alert_config():
    """Get alert notification configuration from config.json"""
    import config_manager
    config = config_manager.get_config()
    return config.get("alertConfig", {"enabled": False, "email": "", "cooldownMinutes": 60})


def send_alert_email(to_email: str, alerts: list) -> bool:
    """Send system alert email with list of service issues.
    
    alerts: list of dicts like [{"service": "KPixel", "status": "离线", "reason": "无法连接 API"}]
    """
    if not alerts:
        return False

    from datetime import datetime
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    rows_html = ""
    for a in alerts:
        rows_html += f"""
        <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #f0f0f5;font-weight:600;color:#1a1a2e;">{a['service']}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #f0f0f5;">
                <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;
                    background:#fef2f2;color:#dc2626;">⚠ {a['status']}</span>
            </td>
            <td style="padding:10px 14px;border-bottom:1px solid #f0f0f5;color:#64748b;font-size:13px;">{a['reason']}</td>
        </tr>"""

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;">
            <!-- Header -->
            <tr><td style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:1px;">🚨 OnePASS 系统警报</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">{now}</p>
            </td></tr>
            <!-- Body -->
            <tr><td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;color:#1a1a2e;line-height:1.6;">
                以下服务检测到异常，请及时处理：
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f5;border-radius:10px;overflow:hidden;font-size:14px;">
                <thead>
                    <tr style="background:#f8fafc;">
                        <th style="padding:10px 14px;text-align:left;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;">服务</th>
                        <th style="padding:10px 14px;text-align:left;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;">状态</th>
                        <th style="padding:10px 14px;text-align:left;color:#64748b;font-weight:600;font-size:12px;text-transform:uppercase;">详情</th>
                    </tr>
                </thead>
                <tbody>{rows_html}</tbody>
              </table>
              <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">
                此警报邮件由 OnePASS 系统自动发送。同一问题在冷却期内不会重复通知。
              </p>
            </td></tr>
            <!-- Footer -->
            <tr><td style="padding:16px 32px;background:#fafafa;text-align:center;border-top:1px solid #f0f0f5;">
              <p style="margin:0;font-size:12px;color:#b0b0c0;">© OnePASS · 系统监控警报 · 请勿回复</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
    """

    subject = f"🚨 OnePASS 警报: {len(alerts)} 个服务异常"
    return send_email(to_email, subject, html)
