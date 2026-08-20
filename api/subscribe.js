const https = require('https');
const crypto = require('crypto');

// Signal's Mailchimp audience — not a secret, it's already public in the
// site's embedded-form action URL.
const LIST_ID = '22ae2915e9';
const ALLOWED_TAGS = ['Homepage', 'Landing'];

function mailchimpRequest(dc, apiKey, path, method, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const headers = { 'Authorization': 'Basic ' + Buffer.from('anystring:' + apiKey).toString('base64') };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const request = https.request({ hostname: `${dc}.api.mailchimp.com`, path, method, headers }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, data }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'bad_request' });
  }

  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey || !apiKey.includes('-')) {
    return res.status(500).json({ ok: false, code: 'not_configured' });
  }

  let email, source;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    email = ((body && body.email) || '').trim().toLowerCase();
    source = ALLOWED_TAGS.includes(body && body.source) ? body.source : null;
  } catch {
    return res.status(400).json({ ok: false, code: 'bad_request' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, code: 'bad_request' });
  }

  // Mailchimp API keys are formatted <key>-<datacenter>, e.g. abc123...-us11.
  const dc = apiKey.split('-').pop();
  const subscriberHash = crypto.createHash('md5').update(email).digest('hex');

  let subscribeResult;
  try {
    subscribeResult = await mailchimpRequest(
      dc, apiKey, `/3.0/lists/${LIST_ID}/members/${subscriberHash}`, 'PUT',
      { email_address: email, status_if_new: 'pending' }
    );
  } catch {
    return res.status(502).json({ ok: false, code: 'unreachable' });
  }

  if (subscribeResult.status < 200 || subscribeResult.status >= 300) {
    return res.status(502).json({ ok: false, code: 'mailchimp_error' });
  }

  if (source) {
    try {
      await mailchimpRequest(
        dc, apiKey, `/3.0/lists/${LIST_ID}/members/${subscriberHash}/tags`, 'POST',
        { tags: [{ name: source, status: 'active' }] }
      );
    } catch (err) {
      console.error('Signal newsletter: tag request failed', err);
    }
  }

  return res.status(200).json({ ok: true });
};
