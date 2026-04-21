'use strict';

const { WebClient } = require('@slack/web-api');
const fetch = require('node-fetch');

function getClient() {
  return new WebClient(process.env.SLACK_BOT_TOKEN);
}

async function postMessage(channel, text, options = {}) {
  const client = getClient();
  return client.chat.postMessage({ channel, text, ...options });
}

async function postThreadReply(channel, threadTs, text, options = {}) {
  const client = getClient();
  return client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    ...options,
  });
}

async function getChannelHistory(channelId, limit = 100) {
  const client = getClient();
  const result = await client.conversations.history({ channel: channelId, limit });
  return result.messages || [];
}

async function downloadFile(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Failed to download file: ${response.status}`);
  const buffer = await response.buffer();
  return buffer;
}

async function getUserInfo(userId) {
  const client = getClient();
  const result = await client.users.info({ user: userId });
  return result.user;
}

async function joinChannel(channelId) {
  const client = getClient();
  try {
    await client.conversations.join({ channel: channelId });
  } catch (err) {
    // Already a member or can't join — ignore
  }
}

async function openDirectMessage(userId) {
  const client = getClient();
  const result = await client.conversations.open({ users: userId });
  return result.channel.id;
}

async function getUserIdByEmail(email) {
  const client = getClient();
  try {
    const result = await client.users.lookupByEmail({ email });
    return result.user ? result.user.id : null;
  } catch {
    return null;
  }
}

async function getChannelIdByName(channelName) {
  const client = getClient();
  const name = channelName.replace(/^#/, '');
  let cursor;
  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    });
    const match = (result.channels || []).find((c) => c.name === name);
    if (match) return match.id;
    cursor = result.response_metadata && result.response_metadata.next_cursor;
  } while (cursor);
  return null;
}

module.exports = {
  postMessage,
  postThreadReply,
  getChannelHistory,
  downloadFile,
  getUserInfo,
  joinChannel,
  getChannelIdByName,
  openDirectMessage,
  getUserIdByEmail,
};
