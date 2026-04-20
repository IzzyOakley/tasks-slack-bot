'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');

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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const timestamp = event.headers['x-slack-request-timestamp'];
  const slackSignature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !slackSignature || !signingSecret) {
    return { statusCode: 400, body: 'Missing signature headers' };
  }

  if (!verifySlackSignature(signingSecret, event.body, timestamp, slackSignature)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Slack URL verification challenge
  if (payload.type === 'url_verification') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: payload.challenge }),
    };
  }

  // Fire and forget — do NOT await
  fetch(`${process.env.NETLIFY_SITE_URL}/.netlify/functions/process-task-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: event.body,
  }).catch((err) => console.error('Failed to trigger background function:', err));

  return { statusCode: 200, body: '' };
};
