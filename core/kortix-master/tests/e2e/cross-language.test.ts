import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { spawn } from "child_process";
import { promisify } from "util";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { cleanupRuntimeFixture, createRuntimeFixture, startDummyOpenCode, startKortixMaster, type RuntimeFixture } from "./helpers";

const execAsync = promisify(spawn);

describe("Cross-Language Environment Variable Access", () => {
  const baseURL = "http://localhost:8001"; // Use different port for E2E
  const scriptsPath = join(import.meta.dir, "../fixtures/test-scripts");
  
  let serverProcess: Awaited<ReturnType<typeof startKortixMaster>> | null = null;
  let opencode: Awaited<ReturnType<typeof startDummyOpenCode>> | null = null;
  let fixture: RuntimeFixture;

  beforeAll(async () => {
    fixture = createRuntimeFixture("kortix-cross-language-");
    opencode = await startDummyOpenCode(9001);
    serverProcess = await startKortixMaster(8001, fixture, {
      KORTIX_TOKEN: "e2e-test-token",
      OPENCODE_PORT: "9001",
    });
  });

  afterAll(async () => {
    await serverProcess?.stop();
    await opencode?.stop();
    await cleanupRuntimeFixture(fixture);
  });

  beforeEach(async () => {
    // Clear any existing test variables
    await fetch(`${baseURL}/env/E2E_TEST_KEY`, { method: "DELETE" }).catch(() => {});
    await fetch(`${baseURL}/env/E2E_SPECIAL_KEY`, { method: "DELETE" }).catch(() => {});
    await fetch(`${baseURL}/env/E2E_UNICODE_KEY`, { method: "DELETE" }).catch(() => {});
  });

  async function setEnvVar(key: string, value: string) {
    const response = await fetch(`${baseURL}/env/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to set env var: ${response.status} ${await response.text()}`);
    }
  }

  async function runScript(scriptName: string, key: string): Promise<any> {
    const scriptPath = join(scriptsPath, scriptName);
    const s6Env = Object.fromEntries(
      readdirSync(fixture.s6EnvDir).map((entry) => [entry, readFileSync(join(fixture.s6EnvDir, entry), 'utf8')]),
    )
    const command = scriptName === 'test-env'
      ? { file: 'go', args: ['run', join(scriptsPath, 'test-env.go'), key] }
      : { file: scriptPath, args: [key] }
    
    return new Promise((resolve, reject) => {
      const child = spawn(command.file, command.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...s6Env, S6_ENV_DIR: fixture.s6EnvDir }
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Script failed with code ${code}: ${stderr}`));
        } else {
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch (e) {
            reject(new Error(`Invalid JSON output: ${stdout}`));
          }
        }
      });
    });
  }

  test("Python script should access environment variables", async () => {
    const testKey = "E2E_TEST_KEY";
    const testValue = "python-test-value";

    await setEnvVar(testKey, testValue);

    const result = await runScript("test-env.py", testKey);

    expect(result).toEqual({
      language: "python",
      key: testKey,
      value: testValue,
      found: true
    });
  });

  test("Node.js script should access environment variables", async () => {
    const testKey = "E2E_TEST_KEY";
    const testValue = "nodejs-test-value";

    await setEnvVar(testKey, testValue);

    const result = await runScript("test-env.js", testKey);

    expect(result).toEqual({
      language: "nodejs",
      key: testKey,
      value: testValue,
      found: true
    });
  });

  test("Bash script should access environment variables", async () => {
    const testKey = "E2E_TEST_KEY";
    const testValue = "bash-test-value";

    await setEnvVar(testKey, testValue);

    const result = await runScript("test-env.sh", testKey);

    expect(result).toEqual({
      language: "bash",
      key: testKey,
      value: testValue,
      found: true
    });
  });

  test("Go binary should access environment variables", async () => {
    const testKey = "E2E_TEST_KEY";
    const testValue = "go-test-value";

    await setEnvVar(testKey, testValue);

    const result = await runScript("test-env", testKey);

    expect(result).toEqual({
      language: "go",
      key: testKey,
      value: testValue,
      found: true
    });
  });

  test("All languages should handle special characters", async () => {
    const testKey = "E2E_SPECIAL_KEY";
    const testValue = "p@$$w0rd!#&*";

    await setEnvVar(testKey, testValue);

    const pythonResult = await runScript("test-env.py", testKey);
    const nodeResult = await runScript("test-env.js", testKey);
    const bashResult = await runScript("test-env.sh", testKey);
    const goResult = await runScript("test-env", testKey);

    [pythonResult, nodeResult, bashResult, goResult].forEach(result => {
      expect(result.value).toBe(testValue);
      expect(result.found).toBe(true);
    });
  });

  test("All languages should handle Unicode", async () => {
    const testKey = "E2E_UNICODE_KEY";
    const testValue = "🔑🚀";

    await setEnvVar(testKey, testValue);

    const pythonResult = await runScript("test-env.py", testKey);
    const nodeResult = await runScript("test-env.js", testKey);
    const bashResult = await runScript("test-env.sh", testKey);
    const goResult = await runScript("test-env", testKey);

    [pythonResult, nodeResult, bashResult, goResult].forEach(result => {
      expect(result.value).toBe(testValue);
      expect(result.found).toBe(true);
    });
  });

  test("All languages should handle non-existent variables", async () => {
    const nonExistentKey = "NON_EXISTENT_KEY_E2E";

    const pythonResult = await runScript("test-env.py", nonExistentKey);
    const nodeResult = await runScript("test-env.js", nonExistentKey);
    const bashResult = await runScript("test-env.sh", nonExistentKey);
    const goResult = await runScript("test-env", nonExistentKey);

    [pythonResult, nodeResult, bashResult, goResult].forEach(result => {
      expect(result.found).toBe(false);
      expect(result.value == null || result.value === '').toBe(true);
    });
  });
});
