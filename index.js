import { startApplication } from './src/main.js';

startApplication().catch((error) => {
  console.error('[fatal] Failed to start ThePurge', error);
  process.exit(1);
});
