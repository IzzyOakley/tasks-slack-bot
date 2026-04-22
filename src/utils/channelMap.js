'use strict';

const { WebClient } = require('@slack/web-api');

function getClient() {
  return new WebClient(process.env.SLACK_BOT_TOKEN);
}

// Returns all channels the bot is a member of that match [firstname]-tasks
async function getPersonalTaskChannels() {
  const client = getClient();
  const channels = [];
  let cursor;

  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    });

    for (const ch of result.channels || []) {
      if (ch.is_member && /^[a-z]+-tasks$/.test(ch.name)) {
        channels.push({
          id: ch.id,
          name: ch.name,
          ownerFirstName: ch.name.replace(/-tasks$/, ''),
        });
      }
    }

    cursor = result.response_metadata && result.response_metadata.next_cursor;
  } while (cursor);

  return channels;
}

// Extract first name from channel name e.g. "dan-tasks" -> "dan"
function getChannelOwnerName(channelName) {
  const match = (channelName || '').match(/^([a-z]+)-tasks$/);
  return match ? match[1] : null;
}

function isPersonalTaskChannel(channelName) {
  return /^[a-z]+-tasks$/.test(channelName || '');
}

module.exports = { getPersonalTaskChannels, getChannelOwnerName, isPersonalTaskChannel };
