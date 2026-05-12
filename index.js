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

let statusMessage = null;       // Discord message object
let targetChannel = null;       // Cached channel to avoid repeated fetches
let isUpdating = false;         // Prevents overlapping updates
let lastPresenceText = null;    // For presence update optimisation
let scheduler = null;           // Periodic update timer

// ---------- Configuration Helpers ----------
function readIntegerEnv(name, defaultValue, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
    const rawValue = process.env[name];
    if (!rawValue) return defaultValue;

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        console.warn(
            `Invalid ${name}=${rawValue}; using default ${defaultValue}. Expected an integer between ${min} and ${max}.`
        );
        return defaultValue;
    }

    return parsed;
}

function truncateForEmbed(value, maxLength = 1024) {
    const normalized = String(value || "Unknown").trim() || "Unknown";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
}

// ---------- Persistent Message ID Helpers ----------
function saveMessageId(id) {
    try {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify({ messageId: id }, null, 2));
    } catch (err) {
        console.error(`Failed to save message ID: ${err.message}`);
    }
}

function loadMessageId() {
    try {
        if (!fs.existsSync(DATA_FILE)) return null;
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        return data.messageId || null;
    } catch (err) {
        console.error(`Failed to load message ID: ${err.message}`);
        return null;
    }
}

// ---------- Presence Update (only when needed) ----------
async function updatePresence(playersOnline, playersMax, isOffline = false) {
    const presenceText = isOffline ? "Server Offline" : `${playersOnline}/${playersMax} Players`;

    if (lastPresenceText !== presenceText) {
        await client.user.setActivity(presenceText, { type: ActivityType.Watching });
        lastPresenceText = presenceText;
    }
}

// ---------- Main Update Function (with concurrency guard) ----------
async function updateStatus() {
    // Prevent overlapping runs if the previous update took longer than interval
    if (isUpdating) {
        console.log("Skipping update – previous run still in progress");
        return;
    }
    isUpdating = true;

    try {
        // Ensure we have the channel reference
        if (!targetChannel) {
            targetChannel = await client.channels.fetch(CHANNEL_ID);
            if (!targetChannel) {
                throw new Error(`Channel ${CHANNEL_ID} not found or inaccessible`);
            }
        }

        // ---- Try to fetch Minecraft server status ----
        let serverInfo;
        try {
            serverInfo = await util.status(HOST, PORT, { timeout: STATUS_TIMEOUT_MS });
        } catch (mcError) {
            // Server offline or unreachable
            console.log(`Server offline: ${mcError.message}`);
            await sendOfflineEmbed();
            await updatePresence(0, 0, true);
            return;
        }

        // ---- Server is online ----
        const playersOnline = serverInfo.players?.online ?? 0;
        const playersMax = serverInfo.players?.max ?? 0;
        const version = truncateForEmbed(serverInfo.version?.name, 256);
        const ping = Number.isFinite(serverInfo.roundTripLatency) ? `${serverInfo.roundTripLatency}ms` : "Unknown";
        const motd = truncateForEmbed(serverInfo.motd?.clean || "No MOTD");

        const embed = new EmbedBuilder()
            .setTitle("🟢 Server ONLINE")
            .addFields(
                { name: "🌐 IP", value: truncateForEmbed(`${HOST}:${PORT}`, 256), inline: true },
                { name: "👥 Players", value: `${playersOnline}/${playersMax}`, inline: true },
                { name: "📡 Ping", value: ping, inline: true },
                { name: "⚙ Version", value: version, inline: true },
                { name: "📝 MOTD", value: motd }
            )
            .setColor("Green")
            .setFooter({ text: `Updates every ${Math.round(UPDATE_INTERVAL_MS / 1000)}s` })
            .setTimestamp();

        await sendOrEditMessage(embed);
        await updatePresence(playersOnline, playersMax);

    } catch (err) {
        // Catch any unexpected errors (e.g. Discord API failures)
        console.error(`Unexpected error in updateStatus: ${err.message}`);
        // Optionally send an error embed to the channel
        try {
            const errorEmbed = new EmbedBuilder()
                .setTitle("⚠️ Status Update Failed")
                .setDescription("An internal error occurred while fetching server status. Check the bot logs for details.")
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

// Helper: Send a new message or edit existing one
async function sendOrEditMessage(embed) {
    if (!targetChannel) return;

    // Try to restore message from saved ID if we don't have it in memory
    if (!statusMessage) {
        const savedId = loadMessageId();
        if (savedId) {
            try {
                statusMessage = await targetChannel.messages.fetch(savedId);
            } catch (fetchErr) {
                console.log(`Saved message ${savedId} no longer exists – will create new`);
                statusMessage = null;
            }
        }
    }

    if (!statusMessage) {
        // Create new message
        statusMessage = await targetChannel.send({ embeds: [embed] });
        saveMessageId(statusMessage.id);
        return;
    }

    try {
        // Edit existing message
        await statusMessage.edit({ embeds: [embed] });
    } catch (editErr) {
        console.warn(`Failed to edit status message (${editErr.message}); creating a replacement message.`);
        statusMessage = await targetChannel.send({ embeds: [embed] });
        saveMessageId(statusMessage.id);
    }
}

// Helper: Offline embed (reused from original, but with safer channel handling)
async function sendOfflineEmbed() {
    if (!targetChannel) return;

    const embed = new EmbedBuilder()
        .setTitle("🔴 Server OFFLINE")
        .addFields(
            { name: "🌐 IP", value: truncateForEmbed(`${HOST}:${PORT}`, 256), inline: true },
            { name: "👥 Players", value: "0/0", inline: true }
        )
        .setColor("Red")
        .setFooter({ text: `Last checked at ${new Date().toISOString()}` })
        .setTimestamp();

    await sendOrEditMessage(embed);
}

// ---------- Scheduled updates (non-overlapping) ----------
function startScheduler() {
    if (scheduler) clearInterval(scheduler);

    scheduler = setInterval(() => {
        updateStatus().catch(err => console.error(`Scheduler iteration error: ${err.message}`));
    }, UPDATE_INTERVAL_MS);
}

async function shutdown(signal) {
    console.log(`Received ${signal}; shutting down Discord client.`);
    if (scheduler) clearInterval(scheduler);
    client.destroy();
    process.exit(0);
}

// ---------- Bot Event Handlers ----------
client.once("ready", async () => {
    console.log(`✅ Bot logged in as ${client.user.tag} (ID: ${client.user.id})`);
    console.log(`Monitoring Minecraft server: ${HOST}:${PORT}`);
    console.log(`Update interval: ${UPDATE_INTERVAL_MS}ms`);
    console.log(`Status timeout: ${STATUS_TIMEOUT_MS}ms`);

    // Perform initial update
    await updateStatus();

    // Start periodic updates
    startScheduler();
});

client.on("error", (err) => {
    console.error(`Discord client error: ${err.message}`);
});

client.on("warn", (message) => {
    console.warn(`Discord client warning: ${message}`);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---------- Startup ----------
client.login(TOKEN).catch(err => {
    console.error(`Failed to login: ${err.message}`);
    process.exit(1);
});
