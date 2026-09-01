import 'dotenv/config';
import { createServer } from 'node:http';
import { makeMysqlStore } from './db/mysql.js';
import { createApp } from './app.js';
import { SummaryScheduler } from './scheduler/index.js';

const store = await makeMysqlStore(process.env.DATABASE_URL);
const scheduler = new SummaryScheduler({ store, env: process.env });
const app = createApp({ store, env: process.env, scheduler });
const server = createServer(app);
const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`MailDM listening on port ${port}`));
const shutdown = () => { server.close(async () => { await store.close(); process.exit(0); }); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
