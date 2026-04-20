'use strict';

const { WebClient } = require('@slack/web-api');

// In-memory cache for the duration of a function invocation
const userCache = new Map();

function getSlackClient() {
  return new WebClient(process.env.SLACK_BOT_TOKEN);
}

async function resolveUserEmail(slackUserId) {
  if (userCache.has(slackUserId)) return userCache.get(slackUserId);

  const client = getSlackClient();
  try {
    const result = await client.users.info({ user: slackUserId });
    const email = result.user && result.user.profile && result.user.profile.email;
    if (email) {
      userCache.set(slackUserId, email);
      return email;
    }
    // Fallback: no email found (guest accounts, etc.)
    return null;
  } catch (err) {
    console.error(`Failed to resolve email for user ${slackUserId}:`, err.message);
    return null;
  }
}

async function resolveUserByDisplayName(displayName) {
  const client = getSlackClient();
  try {
    const result = await client.users.list();
    const members = result.members || [];
    const lower = displayName.toLowerCase();
    const match = members.find((m) => {
      if (m.is_bot || m.deleted) return false;
      const realName = (m.real_name || '').toLowerCase();
      const name = (m.name || '').toLowerCase();
      const displayNameField = (m.profile && m.profile.display_name || '').toLowerCase();
      return realName.includes(lower) || name.includes(lower) || displayNameField.includes(lower);
    });
    if (match) {
      const email = match.profile && match.profile.email;
      if (email) {
        userCache.set(match.id, email);
        return { userId: match.id, email };
      }
    }
    return null;
  } catch (err) {
    console.error(`Failed to look up user by display name "${displayName}":`, err.message);
    return null;
  }
}

async function resolveUserByEmail(email) {
  const client = getSlackClient();
  try {
    const result = await client.users.lookupByEmail({ email });
    if (result.user) {
      userCache.set(result.user.id, email);
      return { userId: result.user.id, email };
    }
    return null;
  } catch (err) {
    console.error(`Failed to look up user by email "${email}":`, err.message);
    return null;
  }
}

module.exports = { resolveUserEmail, resolveUserByDisplayName, resolveUserByEmail };
