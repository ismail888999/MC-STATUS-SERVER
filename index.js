const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActivityType
} = require("discord.js");
const util = require("minecraft-server-util");
const fs = require("fs");

// ---------- Configuration ----------
const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID || "1495435234823372810";
const HOST = process.env.MC_HOST || "2xrduel.qzz.io";
const PORT = parseInt(process.env.MC_PORT) || 13214;
const UPDATE_INTERVAL_MS = parseInt(process.env.UPDATE_INTERVAL_MS) || 15000;
const DATA_FILE = "./message.json";

// ---------- Validation ----------
if (!TOKEN) {
    console.error("FATAL: Missing Discord Bot Token (TOKEN env variable)");
    process.exit(1);
}

// ---------- Global State ----------
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

let statusMessage = null;       // Discord message object
let targetChannel = null;       // Cached channel to avoid repeated fetches
let isUpdating = false;         // Prevents overlapping updates
let lastPlayerCount = null;     // For presence update optimisation

// ---------- Persistent Message ID Helpers ----------
function saveMessageId(id) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ messageId: id }));
    } catch (err) {
        console.error(`Failed to save message ID: ${err.message}`);
    }
}

function loadMessageId() {
    try {
        if (!fs.existsSync(DATA_FILE)) return null;
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        return data.messageId || null;
    } catch (err) {
        console.error(`Failed to load message ID: ${err.message}`);
        return null;
    }
}

// ---------- Presence Update (only when needed) ----------
async function updatePresence(playersOnline, playersMax, isOffline = false) {
    if (isOffline) {
        if (lastPlayerCount !== "offline") {
            await client.user.setActivity("Server Offline", { type: ActivityType.Watching });
            lastPlayerCount = "offline";
        }
        return;
    }

    const presenceText = `${playersOnline}/${playersMax} Players`;
    if (lastPlayerCount !== presenceText) {
        await client.user.setActivity(presenceText, { type: ActivityType.Watching });
        lastPlayerCount = presenceText;
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
            serverInfo = await util.status(HOST, PORT, { timeout: 5000 });
        } catch (mcError) {
            // Server offline or unreachable
            console.log(`Server offline: ${mcError.message}`);
            await sendOfflineEmbed();
            await updatePresence(0, 0, true);
            return;
        }

        // ---- Server is online ----
        const playersOnline = serverInfo.players.online;
        const playersMax = serverInfo.players.max;
        const version = serverInfo.version.name;
        const ping = serverInfo.roundTripLatency;
        const motd = serverInfo.motd.clean || "No MOTD";

        const embed = new EmbedBuilder()
            .setTitle("🟢 Server ONLINE")
            .addFields(
                { name: "🌐 IP", value: HOST, inline: true },
                { name: "👥 Players", value: `${playersOnline}/${playersMax}`, inline: true },
                { name: "📡 Ping", value: `${ping}ms`, inline: true },
                { name: "⚙ Version", value: version, inline: true },
                { name: "📝 MOTD", value: motd }
            )
            .setColor("Green")
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
                .setDescription("An internal error occurred while fetching server status.")
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
    } else {
        // Edit existing message
        await statusMessage.edit({ embeds: [embed] });
    }
}

// Helper: Offline embed (reused from original, but with safer channel handling)
async function sendOfflineEmbed() {
    if (!targetChannel) return;

    const embed = new EmbedBuilder()
        .setTitle("🔴 Server OFFLINE")
        .addFields(
            { name: "🌐 IP", value: HOST, inline: true },
            { name: "👥 Players", value: "0/0", inline: true }
        )
        .setColor("Red")
        .setTimestamp();

    await sendOrEditMessage(embed);
}

// ---------- Scheduled updates (non-overlapping) ----------
function startScheduler() {
    setInterval(() => {
        updateStatus().catch(err => console.error(`Scheduler iteration error: ${err.message}`));
    }, UPDATE_INTERVAL_MS);
}

// ---------- Bot Event Handlers ----------
client.once("ready", async () => {
    console.log(`✅ Bot logged in as ${client.user.tag} (ID: ${client.user.id})`);
    console.log(`Monitoring Minecraft server: ${HOST}:${PORT}`);
    console.log(`Update interval: ${UPDATE_INTERVAL_MS}ms`);

    // Perform initial update
    await updateStatus();

    // Start periodic updates
    startScheduler();
});

client.on("error", (err) => {
    console.error(`Discord client error: ${err.message}`);
});

client.on("disconnect", (event) => {
    console.warn(`Bot disconnected, code: ${event.code}, reason: ${event.reason}`);
});

// ---------- Startup ----------
client.login(TOKEN).catch(err => {
    console.error(`Failed to login: ${err.message}`);
    process.exit(1);
});
