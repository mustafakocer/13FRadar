// @ts-check
import axios from 'axios';

// Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email).
// No SDK dependency; RESEND_API_KEY and ALERTS_FROM come from the environment.
export const resendConfigured = () => Boolean(process.env.RESEND_API_KEY);

/**
 * @param {{ to: string, subject: string, html: string, text: string }} msg
 * @returns {Promise<{ id: string }>}
 */
export async function sendEmail(msg) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY missing');
  const from = process.env.ALERTS_FROM || '13F Radar <alerts@13fradar.com>';
  const r = await axios.post(
    'https://api.resend.com/emails',
    { from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text },
    { timeout: 15000, headers: { Authorization: `Bearer ${key}` }, validateStatus: () => true }
  );
  if (r.status >= 300) throw new Error(`Resend ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return { id: r.data?.id || '' };
}
