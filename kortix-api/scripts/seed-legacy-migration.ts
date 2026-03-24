#!/usr/bin/env bun
/**
 * Seed script for testing legacy file migration.
 *
 * What it does:
 *   1. Creates a legacy project + thread + messages in the DB
 *   2. Spins up a Daytona sandbox with the OLD suna snapshot
 *   3. Creates dummy files in /workspace/uploads/ on that sandbox
 *   4. Links the sandbox to the project via the resources table
 *
 * After running, go to the UI, find the legacy thread, and trigger migration.
 * The file transfer should pick up the dummy files and move them to the new sandbox.
 *
 * Usage:
 *   bun run scripts/seed-legacy-migration.ts --account-id <uuid>
 *
 * Requires:
 *   - DATABASE_URL (legacy suna DB with projects/threads/messages/resources tables)
 *   - DAYTONA_API_KEY, DAYTONA_SERVER_URL, DAYTONA_TARGET
 */

import postgres from 'postgres';
import { Daytona } from '@daytonaio/sdk';

// ── Config ──────────────────────────────────────────────────────────────────

const OLD_SUNA_SNAPSHOT = 'kortix/suna:0.1.3.30';

const DUMMY_FILES = [
  { path: '/workspace/uploads/report.pdf', content: 'fake-pdf-content-here' },
  { path: '/workspace/uploads/screenshot.png', content: 'fake-png-bytes-' + 'x'.repeat(1000) },
  { path: '/workspace/uploads/notes.txt', content: 'These are user notes from the old system.\nLine 2.\nLine 3.' },
  { path: '/workspace/uploads/data.csv', content: 'name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,SF' },
  { path: '/workspace/uploads/subdir/nested-file.md', content: '# Nested file\n\nThis tests recursive transfer.' },
];

// ── Args ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let accountId = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--account-id' && args[i + 1]) {
      accountId = args[i + 1];
      i++;
    }
  }

  if (!accountId) {
    console.error('Usage: bun run scripts/seed-legacy-migration.ts --account-id <uuid>');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  const daytonaKey = process.env.DAYTONA_API_KEY;
  const daytonaUrl = process.env.DAYTONA_SERVER_URL;
  const daytonaTarget = process.env.DAYTONA_TARGET;

  if (!dbUrl) { console.error('Missing DATABASE_URL'); process.exit(1); }
  if (!daytonaKey) { console.error('Missing DAYTONA_API_KEY'); process.exit(1); }

  return { accountId, dbUrl, daytonaKey, daytonaUrl, daytonaTarget };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { accountId, dbUrl, daytonaKey, daytonaUrl, daytonaTarget } = parseArgs();
  const sql = postgres(dbUrl, { max: 1 });

  console.log('=== Legacy Migration Seed Script ===\n');

  // 1. Create project
  console.log('1. Creating legacy project...');
  const projectId = crypto.randomUUID();
  await sql`
    INSERT INTO projects (project_id, name, description, account_id)
    VALUES (${projectId}, 'Legacy Test Project', 'Seeded for file migration testing', ${accountId})
  `;
  console.log(`   Project: ${projectId}`);

  // 2. Create thread
  console.log('2. Creating legacy thread...');
  const threadId = crypto.randomUUID();
  await sql`
    INSERT INTO threads (thread_id, account_id, project_id, name, user_message_count, total_message_count)
    VALUES (${threadId}, ${accountId}, ${projectId}, 'Legacy Chat with Files', 3, 5)
  `;
  console.log(`   Thread: ${threadId}`);

  // 3. Create messages
  console.log('3. Creating legacy messages...');
  const msgs = [
    {
      id: crypto.randomUUID(),
      type: 'user',
      is_llm: false,
      content: JSON.stringify({ role: 'user', content: 'Hey, can you create a report for me?' }),
    },
    {
      id: crypto.randomUUID(),
      type: 'assistant',
      is_llm: true,
      content: JSON.stringify({
        role: 'assistant',
        content: 'Sure! I\'ve created the report and uploaded it to your workspace.',
        tool_calls: [{
          id: 'call_001',
          type: 'function',
          function: { name: 'create_file', arguments: '{"file_path":"report.pdf"}' },
        }],
      }),
    },
    {
      id: crypto.randomUUID(),
      type: 'tool',
      is_llm: false,
      content: JSON.stringify({ role: 'tool', name: 'create_file', content: 'File created successfully', tool_call_id: 'call_001' }),
    },
    {
      id: crypto.randomUUID(),
      type: 'user',
      is_llm: false,
      content: JSON.stringify({ role: 'user', content: 'Great, also upload the screenshot and my notes.' }),
    },
    {
      id: crypto.randomUUID(),
      type: 'assistant',
      is_llm: true,
      content: JSON.stringify({ role: 'assistant', content: 'Done! All files are in your workspace uploads.' }),
    },
  ];

  for (const msg of msgs) {
    await sql`
      INSERT INTO messages (message_id, thread_id, type, is_llm_message, content, metadata)
      VALUES (${msg.id}, ${threadId}, ${msg.type}, ${msg.is_llm}, ${msg.content}, ${JSON.stringify({})})
    `;
  }
  console.log(`   Created ${msgs.length} messages`);

  // 4. Spin up Daytona sandbox with old snapshot
  console.log('4. Creating Daytona sandbox with old suna snapshot...');
  const daytona = new Daytona({
    apiKey: daytonaKey,
    apiUrl: daytonaUrl || undefined,
    target: daytonaTarget || undefined,
  });

  const sandbox = await daytona.create(
    {
      snapshot: OLD_SUNA_SNAPSHOT,
      envVars: {},
      autoStopInterval: 30,
      autoArchiveInterval: 60,
      public: false,
    },
    { timeout: 300 },
  );

  const sandboxId = sandbox.id;
  console.log(`   Sandbox: ${sandboxId} (state: ${sandbox.state})`);

  // 5. Create dummy files
  console.log('5. Creating dummy files in sandbox...');
  // Ensure directories exist
  await sandbox.process.executeCommand('mkdir -p /workspace/uploads/subdir');

  for (const file of DUMMY_FILES) {
    await sandbox.fs.uploadFile(Buffer.from(file.content), file.path);
    console.log(`   Created: ${file.path} (${file.content.length} bytes)`);
  }

  // Verify
  const verify = await sandbox.process.executeCommand('find /workspace/uploads -type f');
  console.log(`   Files on sandbox:\n${verify.result?.split('\n').map(l => `     ${l}`).join('\n')}`);

  // 6. Create resource + link to project
  console.log('6. Linking sandbox to project via resources table...');
  const password = crypto.randomUUID();
  const resourceId = crypto.randomUUID();

  await sql`
    INSERT INTO resources (id, account_id, type, external_id, status, config)
    VALUES (
      ${resourceId},
      ${accountId},
      'sandbox',
      ${sandboxId},
      'active',
      ${JSON.stringify({ pass: password })}
    )
  `;

  await sql`
    UPDATE projects SET sandbox_resource_id = ${resourceId}
    WHERE project_id = ${projectId}
  `;
  console.log(`   Resource: ${resourceId}`);

  // Done
  console.log('\n=== Seed Complete ===');
  console.log(`
  Project ID:    ${projectId}
  Thread ID:     ${threadId}
  Sandbox ID:    ${sandboxId}
  Resource ID:   ${resourceId}
  Account ID:    ${accountId}
  Snapshot:      ${OLD_SUNA_SNAPSHOT}
  Files:         ${DUMMY_FILES.length} dummy files in /workspace/uploads/

  Next steps:
    1. Go to the UI
    2. Find the legacy thread "${msgs[0].id}"
    3. Trigger migration
    4. Verify files appear in the new sandbox under /workspace/uploads/
  `);

  await sql.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
