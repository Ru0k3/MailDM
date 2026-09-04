export const DISCORD_CONTENT_CHUNK_SIZE = 1900;

export function splitDiscordContent(content) {
  const text = String(content);
  if (text.length <= DISCORD_CONTENT_CHUNK_SIZE) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > DISCORD_CONTENT_CHUNK_SIZE) {
    const boundary = remaining.slice(0, DISCORD_CONTENT_CHUNK_SIZE + 1).lastIndexOf('\n\n');
    const splitAt = boundary > 0 ? boundary : DISCORD_CONTENT_CHUNK_SIZE;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
    if (remaining.startsWith('\n\n')) remaining = remaining.slice(2);
  }
  if (remaining || !chunks.length) chunks.push(remaining);
  return chunks;
}

export async function deliverDiscordDM({ discordUserId, content, env = process.env, fetchImpl = fetch }) {
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' };
  const channelResponse = await fetchImpl('https://discord.com/api/v10/users/@me/channels', { method: 'POST', headers, body: JSON.stringify({ recipient_id: discordUserId }) });
  if (!channelResponse.ok) throw Object.assign(new Error(`Discord DM channel creation failed: ${channelResponse.status}`), { code: 'DISCORD_DM_FAILURE' });
  const channel = await channelResponse.json();
  const chunks = splitDiscordContent(content);
  for (const chunk of chunks) {
    const response = await fetchImpl(`https://discord.com/api/v10/channels/${channel.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: chunk }) });
    if (!response.ok) throw Object.assign(new Error(`Discord DM delivery failed: ${response.status}`), { code: 'DISCORD_DM_FAILURE' });
  }
}

export async function sendDiscordWebhookFollowUp({ applicationId, interactionToken, data, fetchImpl = fetch }) {
  const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`;
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error(`Discord interaction webhook follow-up failed: ${response.status}`);
}
