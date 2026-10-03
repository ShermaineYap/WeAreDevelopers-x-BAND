import { createApp } from './app';
import { DEFAULT_PORT, LISTEN_HOST } from './constants';

const port = Number(process.env.PORT) || DEFAULT_PORT;

createApp().listen(port, LISTEN_HOST, () => {
  console.log(`tablekeeper listening on ${LISTEN_HOST}:${port}`);
});
