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
    console.log('SLACK-EVENTS: rejected non-POST');
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const timestamp = event.headers['x-slack-request-timestamp'];
  const slackSignature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !slackSignature || !signingSecret) {
    console.log('SLACK-EVENTS: missing headers', { timestamp: !!timestamp, slackSignature: !!slackSignature, signingSecret: !!signingSecret });
    return { statusCode: 400, body: 'Missing signature headers' };
  }

  const valid = verifySlackSignature(signingSecret, event.body, timestamp, slackSignature);
  console.log('SLACK-EVENTS: signature valid:', valid, '| timestamp age (s):', Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));

  if (!valid) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    console.log('SLACK-EVENTS: JSON parse failed');
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  console.log('SLACK-EVENTS: payload type:', payload.type, '| event type:', payload.event && payload.event.type);

  // Slack URL verification challenge
  if (payload.type === 'url_verification') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: payload.challenge }),
    };
  }

  // Await the fetch — background functions return 202 immediately so this
  // resolves in milliseconds, well within Slack's 3-second window.
  // Fire-and-forget was unreliable: the process terminated before the TCP
  // connection was established, causing intermittent missed events.
  const siteUrl = (process.env.NETLIFY_SITE_URL || '').replace(/\/$/, '');
  const bgUrl = `${siteUrl}/.netlify/functions/process-task-background`;
  console.log('SLACK-EVENTS: triggering background function:', bgUrl);
  try {
    await fetch(bgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body,
    });
  } catch (err) {
    console.error('Failed to trigger background function:', err);
  }

  return { statusCode: 200, body: '' };
};
