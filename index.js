```js
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActivityType
} = require("discord.js");

const util = require("minecraft-server-util");
const fs = require("fs");
const path = require("path");

// ---------- Configuration ----------
const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID || "1495435234823372810";
const HOST = process.env.MC_HOST || "2xrduel.qzz.io";

const PORT = readIntegerEnv("MC_PORT", 13214, 1, 65535);
const UPDATE_INTERVAL_MS = readIntegerEnv("UPDATE_INTERVAL_MS", 15000, 5000);
const STATUS_TIMEOUT_MS = readIntegerEnv("STATUS_TIMEOUT_MS", 5000, 1000);

const DATA_FILE = path.resolve(process.env.DATA_FILE || "./message.json");

// ---------- Validation ----------
if (!TOKEN) {
    console.error("FATAL: Missing Discord Bot Token (TOKEN env variable)");
    process.exit(1);
}

if (!CHANNEL_ID) {
    console.error("FATAL: Missing Discord channel ID (CHANNEL_ID env variable)");
    process.exit(1);
}

// ---------- Global State ----------
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

let statusMessage = null;
let targetChannel = null;
let isUpdating = false;
let lastPresenceText = null;
let scheduler = null;

// ---------- Helpers ----------
function readIntegerEnv(name, defaultValue, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
    const rawValue = process.env[name];

    if (!rawValue) return defaultValue;

    const parsed = Number.parseInt(rawValue, 10);

    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        console.warn(`Invalid ${name}=${rawValue}; using default ${defaultValue}`);
        return defaultValue;
    }

    return parsed;
}

function truncateForEmbed(value, maxLength = 1024) {
    const normalized = String(value || "Unknown").trim() || "Unknown";

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 1)}…`;
}

// ---------- Persistent Message ID ----------
function saveMessageId(id) {
    try {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify({ messageId: id }, null, 2)
        );
    } catch (err) {
        console.error(`Failed to save message ID: ${err.message}`);
    }
}

function loadMessageId() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            return null;
        }

        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

        return data.messageId || null;
    } catch (err) {
        console.error(`Failed to load message ID: ${err.message}`);
        return null;
    }
}

// ---------- Presence ----------
async function updatePresence(playersOnline, playersMax, isOffline = false) {
    const presenceText = isOffline
        ? "Server Offline"
        : `${playersOnline}/${playersMax} Players`;

    if (lastPresenceText !== presenceText) {
        await client.user.setActivity(presenceText, {
            type: ActivityType.Watching
        });

        lastPresenceText = presenceText;
    }
}

// ---------- Main Status Update ----------
async function updateStatus() {
    if (isUpdating) {
        console.log("Skipping update – previous run still in progress");
        return;
    }

    isUpdating = true;

    try {
        // Fetch channel
        if (!targetChannel) {
            targetChannel = await client.channels.fetch(CHANNEL_ID);

            if (!targetChannel) {
                throw new Error(`Channel ${CHANNEL_ID} not found`);
            }
        }

        // Fetch Minecraft server status
        let serverInfo;

        try {
            serverInfo = await util.status(HOST, PORT, {
                timeout: STATUS_TIMEOUT_MS
            });
        } catch (mcError) {
            console.log(`Server offline: ${mcError.message}`);

            await sendOfflineEmbed();
            await updatePresence(0, 0, true);

            return;
        }

        const playersOnline = serverInfo.players?.online ?? 0;
        const playersMax = serverInfo.players?.max ?? 0;

        const version = truncateForEmbed(
            serverInfo.version?.name,
            256
        );

        const ping = Number.isFinite(serverInfo.roundTripLatency)
            ? `${serverInfo.roundTripLatency}ms`
            : "Unknown";

        const motd = truncateForEmbed(
            serverInfo.motd?.clean || "No MOTD"
        );

        const embed = new EmbedBuilder()
            .setTitle("🟢 Server ONLINE")
            .addFields(
                {
                    name: "🌐 IP",
                    value: truncateForEmbed(`${HOST}:${PORT}`, 256),
                    inline: true
                },
                {
                    name: "👥 Players",
                    value: `${playersOnline}/${playersMax}`,
                    inline: true
                },
                {
                    name: "📡 Ping",
                    value: ping,
                    inline: true
                },
                {
                    name: "⚙ Version",
                    value: version,
                    inline: true
                },
                {
                    name: "📝 MOTD",
                    value: motd
                }
            )
            .setColor("Green")
            .setFooter({
                text: `Updates every ${Math.round(UPDATE_INTERVAL_MS / 1000)}s`
            })
            .setTimestamp();

        await sendOrEditMessage(embed);

        await updatePresence(playersOnline, playersMax);

    } catch (err) {
        console.error(`Unexpected error in updateStatus: ${err.message}`);

        try {
            const errorEmbed = new EmbedBuilder()
                .setTitle("⚠️ Status Update Failed")
                .setDescription(
                    "An internal error occurred while fetching server status."
                )
                .setColor("Yellow")
                .setTimestamp();

            await sendOrEditMessage(errorEmbed);

        } catch (fallbackErr) {
            console.error(`Failed to send error embed: ${fallbackErr.message}`);
        }

    } finally {
        isUpdating = false;
    }
}

// ---------- Send/Edit Message ----------
async function sendOrEditMessage(embed) {
    if (!targetChannel) return;

    if (!statusMessage) {
        const savedId = loadMessageId();

        if (savedId) {
            try {
                statusMessage = await targetChannel.messages.fetch(savedId);

            } catch (fetchErr) {
                console.log(`Saved message not found, creating new one`);
                statusMessage = null;
            }
        }
    }

    if (!statusMessage) {
        statusMessage = await targetChannel.send({
            embeds: [embed]
        });

        saveMessageId(statusMessage.id);

        return;
    }

    try {
        await statusMessage.edit({
            embeds: [embed]
        });

    } catch (editErr) {
        console.warn(`Failed to edit message, sending new one`);

        statusMessage = await targetChannel.send({
            embeds: [embed]
        });

        saveMessageId(statusMessage.id);
    }
}

// ---------- Offline Embed ----------
async function sendOfflineEmbed() {
    if (!targetChannel) return;

    const embed = new EmbedBuilder()
        .setTitle("🔴 Server OFFLINE")
        .addFields(
            {
                name: "🌐 IP",
                value: truncateForEmbed(`${HOST}:${PORT}`, 256),
                inline: true
            },
            {
                name: "👥 Players",
                value: "0/0",
                inline: true
            }
        )
        .setColor("Red")
        .setTimestamp();

    await sendOrEditMessage(embed);
}

// ---------- Scheduler ----------
function startScheduler() {
    if (scheduler) {
        clearInterval(scheduler);
    }

    scheduler = setInterval(() => {
        updateStatus().catch(err => {
            console.error(`Scheduler error: ${err.message}`);
        });

    }, UPDATE_INTERVAL_MS);
}

// ---------- Shutdown ----------
async function shutdown(signal) {
    console.log(`Received ${signal}, shutting down`);

    if (scheduler) {
        clearInterval(scheduler);
    }

    client.destroy();

    process.exit(0);
}

// ---------- Discord Events ----------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`Monitoring server ${HOST}:${PORT}`);

    await updateStatus();

    startScheduler();
});

client.on("error", err => {
    console.error(`Discord client error: ${err.message}`);
});

client.on("warn", message => {
    console.warn(`Discord warning: ${message}`);
});

// ---------- Process Events ----------
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---------- Start Bot ----------
client.login(TOKEN).catch(err => {
    console.error(`Failed to login: ${err.message}`);
    process.exit(1);
});
```
