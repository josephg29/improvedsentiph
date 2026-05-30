# Inter-Agent Messaging

`sentiph` has a simple local channel system for messages between agents.

## What channels are

Channels are in-memory queues keyed by target agent ID. Sending a message does not create a persistent notification record.

Use them for short coordination:

- ask for review
- report completion
- hand off a finding
- point another agent to a file or risk

It is for short-lived coordination, not durable state.

## Delivery model

When a message is sent, `sentiph`:

1. verifies the target agent record exists
2. appends the message to that agent's in-memory queue
3. marks it as undelivered
4. injects pending messages into the target PTY when the target session is idle

Delivered messages are written into the agent input as lines like:

```text
[Channel message from <from-terminal-id>]: <content>
```

If the target agent is not running, the message waits in memory until that session exists and becomes idle. If the API restarts first, the message is lost.

## CLI usage

Send a message:

```bash
sentiph channel send <terminal-id> "Need review on the parser change"
```

When one terminal is messaging another, pass the sender explicitly:

```bash
sentiph channel send <target-terminal-id> "DONE: parser change is ready" --from <sender-terminal-id>
```

If `--from` is omitted, the CLI uses `SENTIPH_SESSION_ID` when it is available.

List messages:

```bash
sentiph channel list <agent-id>
```

## API usage

- `POST /api/channels/:terminalId/messages`
- `GET /api/channels/:terminalId/messages`

## Current behavior

- messages are stored in memory
- messages do not persist across API restarts
- delivery state is tracked by the API
- idle and stop hook events can trigger delivery
- listing messages shows queued and delivered messages for the current API process

## Practical rule

If a message needs to survive, write it into a file in the workspace. Use the channel for short-lived coordination only.
