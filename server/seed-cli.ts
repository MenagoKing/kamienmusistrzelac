// npm run seed            seeds an empty database
// npm run seed -- --reset wipes everything and seeds the sample data again
import { ensureSeeded, reseed } from './seed.ts';

if (process.argv.includes('--reset')) {
  reseed();
  console.log('Database reset to the sample data.');
} else {
  ensureSeeded();
  console.log('Database ready.');
}
