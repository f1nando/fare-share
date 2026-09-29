import { makePasswordHash } from '../server/adminAuth.js';

const password = process.argv[2];
if (!password) throw new Error('Usage: npm run admin:hash-password -- <password>');
console.log(makePasswordHash(password));
