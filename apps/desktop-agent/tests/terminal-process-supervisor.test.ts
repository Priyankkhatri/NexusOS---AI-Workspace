import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessSupervisor } from '../src/runtimes/terminal/process-supervisor.js';

describe('Process Supervisor — Sanitization, Ownership, & Execution', () => {
  const supervisor = new ProcessSupervisor();

  it('sanitizes environment variables and filters out sensitive key patterns', () => {
    const rawEnv = {
      SAFE_VAR: 'hello',
      MY_SECRET: 'supersecret',
      API_TOKEN: 'token123',
      USER_PASSWORD: 'password123',
      AWS_ACCESS_KEY: 'key123',
    };

    const sanitized = supervisor.sanitizeEnvironment(rawEnv);

    assert.equal(sanitized.SAFE_VAR, 'hello');
    assert.equal(sanitized.MY_SECRET, undefined);
    assert.equal(sanitized.API_TOKEN, undefined);
    assert.equal(sanitized.USER_PASSWORD, undefined);
    assert.equal(sanitized.AWS_ACCESS_KEY, undefined);
  });

  it('executes a safe command and captures stdout output', async () => {
    const outcome = await supervisor.executeSupervisedProcess({
      command: 'node',
      args: ['-e', 'console.log("nexusos_terminal_test")'],
      cwd: process.cwd(),
    });

    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.timedOut, false);
    assert.ok(outcome.stdout.includes('nexusos_terminal_test'));
    assert.ok(outcome.processToken.startsWith('proc_'));
  });

  it('enforces output size byte limits and sets truncated flag', async () => {
    const outcome = await supervisor.executeSupervisedProcess(
      {
        command: 'node',
        args: ['-e', 'console.log("A".repeat(2000))'],
        cwd: process.cwd(),
        maxOutputSizeBytes: 500,
      },
      { maxOutputSizeBytes: 500 },
    );

    assert.equal(outcome.truncated, true);
    assert.ok(outcome.stdout.length <= 500);
  });

  it('enforces process execution timeouts safely', async () => {
    const outcome = await supervisor.executeSupervisedProcess({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      cwd: process.cwd(),
      timeoutMs: 150,
    });

    assert.equal(outcome.timedOut, true);
    assert.notEqual(outcome.exitCode, 0);
  });

  it('allows explicit kill by processToken', async () => {
    const execPromise = supervisor.executeSupervisedProcess({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    // Wait brief moment for process to register
    await new Promise((r) => setTimeout(r, 100));

    const activeList = supervisor.listProcesses();
    assert.ok(activeList.length > 0);

    const token = activeList[0]!.processToken;
    const killed = supervisor.killProcess(token);
    assert.equal(killed, true);

    const outcome = await execPromise;
    assert.ok(outcome.durationMs < 4000);
  });
});
