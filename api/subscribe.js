const https = require('https');
const crypto = require('crypto');

// Signal's Mailchimp audience — not a secret, it's already public in the
// site's embedded-form action URL.
const LIST_ID = '22ae2915e9';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey || !apiKey.includes('-')) {
    return res.status(500).json({ ok: false, error: 'Mailchimp is not configured' });
  }

  let email;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    email = ((body && body.email) || '').trim().toLowerCase();
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid request body' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email address' });
  }

  // Mailchimp API keys are formatted <key>-<datacenter>, e.g. abc123...-us11.
  const dc = apiKey.split('-').pop();
  const subscriberHash = crypto.createHash('md5').update(email).digest('hex');
  const payload = JSON.stringify({ email_address: email, status_if_new: 'pending' });

  const callMailchimp = () => new Promise((resolve, reject) => {
    const request = https.request({
      hostname: `${dc}.api.mailchimp.com`,
      path: `/3.0/lists/${LIST_ID}/members/${subscriberHash}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Basic ' + Buffer.from('anystring:' + apiKey).toString('base64')
      }
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, data }));
    });
    request.on('error', reject);
    request.write(payload);
    request.end();
  });

  try {
    const { status } = await callMailchimp();
    if (status >= 200 && status < 300) return res.status(200).json({ ok: true });
    return res.status(502).json({ ok: false, error: 'Mailchimp rejected the request' });
  } catch {
    return res.status(502).json({ ok: false, error: 'Could not reach Mailchimp' });
  }
};
