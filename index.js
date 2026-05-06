const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActivityType
} = require("discord.js");

const util = require("minecraft-server-util");
const fs = require("fs");

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = "1495435234823372810";
const HOST = "2xrduel.qzz.io";
const PORT = 13214;

const DATA_FILE = "./message.json";

let statusMessage = null;

function saveMessageId(id) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ messageId: id }));
}

function loadMessageId() {
    if (!fs.existsSync(DATA_FILE)) return null;
    return JSON.parse(fs.readFileSync(DATA_FILE)).messageId;
}

async function updateStatus() {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);

        const res = await util.status(HOST, PORT, {
            timeout: 5000
        });

        const playersOnline = res.players.online;
        const playersMax = res.players.max;
        const version = res.version.name;
        const ping = res.roundTripLatency;
        const motd = res.motd.clean;

        const embed = new EmbedBuilder()
            .setTitle("🟢 Server ONLINE")
            .addFields(
                { name: "🌐 IP", value: HOST, inline: true },
                { name: "👥 Players", value: `${playersOnline}/${playersMax}`, inline: true },
                { name: "📡 Ping", value: `${ping}ms`, inline: true },
                { name: "⚙ Version", value: version, inline: true },
                { name: "📝 MOTD", value: motd || "No MOTD" }
            )
            .setColor("Green")
            .setTimestamp();

        if (!statusMessage) {
            const savedId = loadMessageId();

            if (savedId) {
                try {
                    statusMessage = await channel.messages.fetch(savedId);
                } catch {
                    statusMessage = null;
                }
            }
        }

        if (!statusMessage) {
            statusMessage = await channel.send({
                embeds: [embed]
            });
            saveMessageId(statusMessage.id);
        } else {
            await statusMessage.edit({
                embeds: [embed]
            });
        }

        client.user.setActivity(
            `${playersOnline}/${playersMax} Players`,
            { type: ActivityType.Watching }
        );

    } catch (err) {
        const channel = await client.channels.fetch(CHANNEL_ID);

        const embed = new EmbedBuilder()
            .setTitle("🔴 Server OFFLINE")
            .setDescription(`🌐 ${HOST}\n👥 0/0`)
            .setColor("Red")
            .setTimestamp();

        if (!statusMessage) {
            statusMessage = await channel.send({
                embeds: [embed]
            });
            saveMessageId(statusMessage.id);
        } else {
            await statusMessage.edit({
                embeds: [embed]
            });
        }

        client.user.setActivity(
            "Server Offline",
            { type: ActivityType.Watching }
        );
    }
}

client.once("clientReady", async () => {
    console.log(`✅ Bot ready: ${client.user.tag}`);

    await updateStatus();

    setInterval(updateStatus, 15000);
});

client.login(TOKEN);
