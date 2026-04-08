import readline from 'readline';
import { ensureBaseDirs, readJSON, writeJSON, BOTS_FILE } from './utils/storage.js';
import { registerUser, loginUser } from './utils/auth.js';
import { startUserbot, running } from './main.js';

ensureBaseDirs();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

function setBotState(username, patch = {}) {
  const bots = readJSON(BOTS_FILE, {});
  bots[username] = { ...(bots[username] || {}), ...patch };
  writeJSON(BOTS_FILE, bots);
}

async function dashboard(user) {
  console.log(`\nWelcome ${user.username} to Cypherus.`);
  while (true) {
    console.log('\n1) Connect via QR\n2) Connect via Pairing Code\n3) Start my bot\n4) Stop my bot\n5) Bot status\n0) Logout');
    const choice = (await ask('Select: ')).trim();

    if (choice === '1') {
      setBotState(user.username, { active: true, loginMethod: 'qr' });
      await startUserbot(user.username, { pairingCode: false });
      console.log('Bot start requested. Scan QR in terminal.');
    } else if (choice === '2') {
      const phone = (await ask('Phone with country code (e.g. 2348012345678): ')).trim();
      setBotState(user.username, { active: true, loginMethod: 'pairing', phone });
      await startUserbot(user.username, { pairingCode: true, phone });
      console.log('Pairing code requested (see terminal logs).');
    } else if (choice === '3') {
      setBotState(user.username, { active: true });
      if (!running.get(user.username)) await startUserbot(user.username);
      console.log('Bot started.');
    } else if (choice === '4') {
      setBotState(user.username, { active: false });
      const ref = running.get(user.username);
      if (ref) {
        await ref.sock.ws.close();
        running.delete(user.username);
      }
      console.log('Bot stopped.');
    } else if (choice === '5') {
      const bot = readJSON(BOTS_FILE, {})[user.username] || {};
      console.log(bot);
      console.log(running.get(user.username) ? 'Runtime: ONLINE' : 'Runtime: OFFLINE');
    } else if (choice === '0') {
      return;
    }
  }
}

async function main() {
  while (true) {
    console.log('\n=== Cypherus Frontend ===');
    console.log('1) Create account\n2) Login\n0) Exit');
    const choice = (await ask('Select: ')).trim();

    if (choice === '1') {
      const username = (await ask('Username: ')).trim();
      const password = (await ask('Password: ')).trim();
      const res = registerUser(username, password);
      console.log(res.ok ? 'Account created ✅' : `Error: ${res.error}`);
    } else if (choice === '2') {
      const username = (await ask('Username: ')).trim();
      const password = (await ask('Password: ')).trim();
      const res = loginUser(username, password);
      if (!res.ok) console.log(`Error: ${res.error}`);
      else await dashboard(res.user);
    } else if (choice === '0') {
      break;
    }
  }
  rl.close();
}

main();
