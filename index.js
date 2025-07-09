require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMembers,
  ],
});

const SYNCED_BANS = new Set();
const recentBans = {};
const recentUnbans = {};
const MASS_THRESHOLD = 3;
const WINDOW = 5000;

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

function trackAndDetectMass(obj, guildId, userId) {
  const now = Date.now();
  if (!obj[guildId]) obj[guildId] = [];

  obj[guildId].push({ userId, time: now });
  obj[guildId] = obj[guildId].filter(entry => now - entry.time < WINDOW);

  if (obj[guildId].length >= MASS_THRESHOLD) {
    const users = obj[guildId].map(e => e.userId);
    obj[guildId] = [];
    return users;
  }
  return null;
}

async function fetchUserTags(userIds) {
  const tags = [];
  for (let i = 0; i < Math.min(userIds.length, 5); i++) {
    try {
      const user = await client.users.fetch(userIds[i]);
      tags.push(`${user.username} (\`${user.id}\`)`);
    } catch {
      tags.push(`Unknown User (\`${userIds[i]}\`)`);
    }
  }
  return tags;
}

async function sendMassWebhook(guild, userIds, action) {
  const webhookUrl = process.env.WEBHOOK_OUTPUT;
  if (!webhookUrl) return;

  const userTags = await fetchUserTags(userIds);
  let descriptionUsers = userTags.join('\n');
  const extraCount = userIds.length - userTags.length;
  if (extraCount > 0) descriptionUsers += `\n+ ${extraCount} more`;

  const title = action === 'ban' ? '🚨 Mass Ban Sync Triggered' : '♻️ Mass Unban Sync Triggered';
  const color = action === 'ban' ? 0xff0000 : 0x00cc99;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Site-89 Ban-Sync Bot',
      embeds: [
        {
          title,
          color,
          description: [
            `🌐 **Origin Server:** ${guild.name}`,
            `👤 **Users:**`,
            descriptionUsers || 'N/A',
          ].join('\n'),
          footer: {
            text: `Site-89 Ban-Sync Bot • ${new Date().toLocaleString()}`,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}

async function sendSyncWebhook(user, guild, successGuilds, failedGuilds, type = 'ban') {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return;

  const successText = successGuilds.length > 0 ? successGuilds.map(g => `• ${g}`).join('\n') : 'N/A';
  const failedText = failedGuilds.length > 0 ? failedGuilds.map(g => `• ${g}`).join('\n') : 'N/A';

  const title = type === 'ban' ? '🔨 Ban Sync Result:' : '♻️ Unban Sync Result:';
  const color = type === 'ban' ? 0xff0000 : 0x00cc99;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Site-89 Ban-Sync Bot',
      embeds: [
        {
          title,
          color,
          description: [
            `👤 **User:** ${user.username} (\`${user.id}\`)`,
            `🌐 **Origin Server:** ${guild.name}`,
          ].join('\n'),
          fields: [
            {
              name: `✅ Successfully ${type === 'ban' ? 'Banned' : 'Unbanned'} In`,
              value: successText,
            },
            {
              name: `❌ Failed To ${type === 'ban' ? 'Ban' : 'Unban'} In`,
              value: failedText,
            },
          ],
          footer: {
            text: `Site-89 Ban-Sync Bot • ${new Date().toLocaleString()}`,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}

client.on('guildBanAdd', async (ban) => {
  const { user, guild } = ban;
  const key = `${user.id}-${guild.id}`;

  const massUsers = trackAndDetectMass(recentBans, guild.id, user.id);
  if (massUsers) {
    console.log(`🚨 Mass ban detected in ${guild.name}`);
    for (const userId of massUsers) {
      for (const g of client.guilds.cache.values()) {
        if (g.id === guild.id) continue;
        try {
          const bans = await g.bans.fetch();
          if (bans.has(userId)) continue;
          await g.members.ban(userId, { reason: `Mass ban synced from ${guild.name}` });
        } catch {}
      }
    }
    await sendMassWebhook(guild, massUsers, 'ban');
    return;
  }

  if (SYNCED_BANS.has(key)) return;
  SYNCED_BANS.add(key);

  console.log(`🔨 ${user.username} banned in ${guild.name}, syncing...`);

  const successGuilds = [];
  const failedGuilds = [];

  for (const g of client.guilds.cache.values()) {
    if (g.id === guild.id) continue;
    try {
      const bans = await g.bans.fetch();
      if (bans.has(user.id)) continue;
      await g.members.ban(user, { reason: `Ban sync from ${guild.name}` });
      successGuilds.push(g.name);
    } catch {
      failedGuilds.push(g.name);
    }
  }

  await sendSyncWebhook(user, guild, successGuilds, failedGuilds, 'ban');
  setTimeout(() => SYNCED_BANS.delete(key), 10_000);
});

client.on('guildBanRemove', async (ban) => {
  const { user, guild } = ban;
  const key = `unban-${user.id}-${guild.id}`;

  const massUsers = trackAndDetectMass(recentUnbans, guild.id, user.id);
  if (massUsers) {
    console.log(`🚨 Mass unban detected in ${guild.name}`);
    for (const userId of massUsers) {
      for (const g of client.guilds.cache.values()) {
        if (g.id === guild.id) continue;
        try {
          await g.members.unban(userId, `Mass unban synced from ${guild.name}`);
        } catch {}
      }
    }
    await sendMassWebhook(guild, massUsers, 'unban');
    return;
  }

  if (SYNCED_BANS.has(key)) return;
  SYNCED_BANS.add(key);

  console.log(`🔄 ${user.username} unbanned in ${guild.name}, syncing...`);

  const successGuilds = [];
  const failedGuilds = [];

  for (const g of client.guilds.cache.values()) {
    if (g.id === guild.id) continue;
    try {
      const bans = await g.bans.fetch();
      if (!bans.has(user.id)) continue;
      await g.members.unban(user, { reason: `Unban sync from ${guild.name}` });
      successGuilds.push(g.name);
    } catch {
      failedGuilds.push(g.name);
    }
  }

  await sendSyncWebhook(user, guild, successGuilds, failedGuilds, 'unban');
  setTimeout(() => SYNCED_BANS.delete(key), 10_000);
});

client.login(process.env.TOKEN);