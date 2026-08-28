import 'dotenv/config';
import { createServer } from 'node:http';
import { openDatabase, makeStore } from './db/index.js';
import { createApp } from './app.js';
import { SummaryScheduler } from './scheduler/index.js';

const db = openDatabase(process.env.DATABASE_PATH);
const store = makeStore(db);
const scheduler = new SummaryScheduler({ store, env: process.env });
const app = createApp({ store, env: process.env, scheduler });
const server = createServer(app);
const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`MailDM listening on port ${port}`));
const shutdown = () => { server.close(() => { store.close(); process.exit(0); }); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
