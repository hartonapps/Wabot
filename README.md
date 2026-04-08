# Cypherus - Multi-user WhatsApp Userbot Platform

Cypherus is a multi-session WhatsApp userbot platform powered by **Baileys**.
Each registered user has their own WhatsApp Web session under `/sessions/<username>` and their own runtime config.

## Features

- Multi-user account system (register/login)
- Optional remembered frontend login on local device
- Multi-session WhatsApp connection (QR or pairing code)
- Prefix command system (`.`)
- Automation: autoreply, autoreact, antispam, auto-viewonce
- View-once extraction (`.vv`, `.vvsave`) and interception
- Media tools (`.s`, `.toimg`, `.kang`, `.save`)
- Free downloader/meta helpers (`.dl`, `.meta`)
- Free AI helpers without paid keys (`.gpt`, `.ask`, `.summarize`, `.translate`)
- Group admin tools
- Privacy tools (`.ghostmode`, `.antidelete`, `.antiedit`)
- Utility tools (`.qr`, `.short`, `.calc`)
- Direct message command with media support (`.msg`)
- Auto reconnect and per-user logs

## Project Structure

- `main.js` - core runner, loads active user sessions
- `frontend.js` - CLI frontend (create account/login/manage bot)
- `commands/index.js` - command and message handlers
- `utils/` - helpers
- `sessions/` - per-user auth/session data
- `logs/` - per-user activity logs
- `data/` - users/bots metadata

## Setup

```bash
npm install
node frontend.js
```

In frontend:
1. Create account
2. Login
3. Connect via QR or Pairing Code
4. Start your bot

Cypherus also remembers WhatsApp linked sessions in `/sessions/` and can optionally remember the last frontend account in `data/frontend_session.json`.
When QR login is started, QR is printed in terminal and also saved as image: `sessions/<username>/latest-qr.png`.

For direct core start (auto-load active bots):

```bash
node main.js
```

## Commands

Use prefix `.` (works for message text, replies, captions):

- Core: `.ping`, `.menu`, `.logout`, `.reset`
- Automation: `.autoreply on <text>`, `.autoreply off`, `.autoreact on 😀🔥`, `.autoreact off`, `.antispam on|off`, `.autoviewonce on|off`
- ViewOnce: `.vv`, `.vvsave`
- Media: reply with `.s`, `.toimg`, `.kang`, `.save`
- Download: `.dl <url>`, `.meta <url>`
- AI: `.gpt <text>`, `.ask <question>`, `.summarize <text>`, `.translate <text> to <lang>`
- Group: `.tagall`, `.kick @user`, `.promote @user`, `.demote @user`, `.pin`, `.unpin`
- Privacy: `.ghostmode on|off`, `.antidelete on|off`, `.antiedit on|off`
- Utility: `.qr <text>`, `.short <url>`, `.calc <expression>`
- Special: `.msg <number> <message>` or reply media + `.msg <number> <caption>`

## Termux Notes

- Uses pure Node.js + JS packages where possible.
- Avoids paid APIs and paid keys.
- If some public free endpoint is down/rate-limited, that command may temporarily fail.
- If you get repeated disconnect `code=405`, delete `sessions/<username>/auth` and reconnect.
