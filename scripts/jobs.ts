import { db } from '../src/lib/db';
import { runJobs } from '../src/lib/notifications';
try {
  console.log(await runJobs());
} catch {
  console.error('Job processing failed. Check database and email configuration.');
  process.exitCode = 1;
} finally { await db().end(); }
