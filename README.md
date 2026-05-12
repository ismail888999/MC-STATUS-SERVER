# MC Status Server

A Discord bot that posts and updates a single embed with the status of a Minecraft server.

## Configuration

Set these environment variables before starting the bot:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TOKEN` | Yes | - | Discord bot token. |
| `CHANNEL_ID` | No | `1495435234823372810` | Discord channel where the status embed is posted. |
| `MC_HOST` | No | `2xrduel.qzz.io` | Minecraft server hostname. |
| `MC_PORT` | No | `13214` | Minecraft server port. |
| `UPDATE_INTERVAL_MS` | No | `15000` | Delay between status checks. Minimum accepted value is 5000. |
| `STATUS_TIMEOUT_MS` | No | `5000` | Minecraft status request timeout. Minimum accepted value is 1000. |
| `DATA_FILE` | No | `./message.json` | File used to remember the Discord message ID between restarts. |

## Usage

```bash
npm install
TOKEN="your-discord-bot-token" CHANNEL_ID="your-channel-id" npm start
```

## Checks

```bash
npm test
```
