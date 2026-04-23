'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');
const qs = require('querystring');

function verifySlackSignature(signingSecret, requestBody, timestamp, slackSignature) {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;
  const sigBaseString = `v0:${timestamp}:${requestBody}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBaseString, 'utf8')
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(slackSignature, 'utf8')
    );
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const timestamp = event.headers['x-slack-request-timestamp'];
  const slackSignature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !slackSignature || !signingSecret) {
    return { statusCode: 400, body: 'Missing signature headers' };
  }

  if (!verifySlackSignature(signingSecret, event.body, timestamp, slackSignature)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const body = qs.parse(event.body);
  const { command, user_id, channel_id, response_url, text } = body;

  const siteUrl = (process.env.NETLIFY_SITE_URL || '').replace(/\/$/, '');
  const bgUrl = `${siteUrl}/.netlify/functions/process-task-background`;

  try {
    await fetch(bgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slash_command: { command, user_id, channel_id, response_url, text: text || '' },
      }),
    });
  } catch (err) {
    console.error('Failed to trigger background function:', err.message);
  }

  // Acknowledge immediately — background function posts the real response via response_url
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_type: 'ephemeral', text: 'Fetching your tasks...' }),
  };
};
