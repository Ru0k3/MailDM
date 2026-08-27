export async function deliverDiscordDM({ discordUserId, content, env = process.env, fetchImpl = fetch }) {
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' };
  const channelResponse = await fetchImpl('https://discord.com/api/v10/users/@me/channels', { method: 'POST', headers, body: JSON.stringify({ recipient_id: discordUserId }) });
  if (!channelResponse.ok) throw Object.assign(new Error(`Discord DM channel creation failed: ${channelResponse.status}`), { code: 'DISCORD_DM_FAILURE' });
  const channel = await channelResponse.json();
  const chunks = String(content).match(/[\s\S]{1,1900}/g) ?? [''];
  for (const chunk of chunks) {
    const response = await fetchImpl(`https://discord.com/api/v10/channels/${channel.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: chunk }) });
    if (!response.ok) throw Object.assign(new Error(`Discord DM delivery failed: ${response.status}`), { code: 'DISCORD_DM_FAILURE' });
  }
}
