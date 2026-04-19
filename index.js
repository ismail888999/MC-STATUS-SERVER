const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const util = require('minecraft-server-util');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = "1495435234823372810";
const HOST = "2xrduel.qzz.io";
const PORT = 13214;

let statusMessage = null;

client.once('ready', async () => {
    console.log(`✅ Bot ready: ${client.user.tag}`);

    const channel = await client.channels.fetch(CHANNEL_ID);

    setInterval(async () => {
        try {
            const res = await util.status(HOST, PORT, { timeout: 5000 });

            const playersOnline = res.players?.online ?? 0;
            const playersMax = res.players?.max ?? 0;

            const embed = new EmbedBuilder()
                .setTitle(playersMax === 0 ? "🔴 Server OFFLINE" : "🟢 Server ONLINE")
                .setDescription(`🌐 IP: ${HOST}\n👥 Players: ${playersOnline}/${playersMax}`)
                .setColor(playersMax === 0 ? "Red" : "Green");

            if (!statusMessage) {
                statusMessage = await channel.send({ embeds: [embed] });
            } else {
                await statusMessage.edit({ embeds: [embed] });
            }

        } catch (err) {
            const embed = new EmbedBuilder()
                .setTitle("🔴 Server OFFLINE")
                .setDescription(`🌐 IP: ${HOST}\n👥 Players: 0/0`)
                .setColor("Red");

            if (!statusMessage) {
                statusMessage = await channel.send({ embeds: [embed] });
            } else {
                await statusMessage.edit({ embeds: [embed] });
            }
        }
    }, 15000);
});

client.login(TOKEN);