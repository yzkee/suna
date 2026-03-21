import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { cleanupRuntimeFixture, createRuntimeFixture, startDummyOpenCode, startKortixMaster, type RuntimeFixture, type StartedServer } from "./helpers";

describe("Environment Variable Persistence", () => {
  const baseURL = "http://localhost:8002"; // Different port for isolation
  let fixture: RuntimeFixture;
  let opencode: Awaited<ReturnType<typeof startDummyOpenCode>> | null = null;
  
  beforeAll(async () => {
    fixture = createRuntimeFixture("kortix-persistence-");
    opencode = await startDummyOpenCode(9002);
  });

  afterAll(async () => {
    await opencode?.stop();
    await cleanupRuntimeFixture(fixture);
  });

  async function startServer(): Promise<StartedServer> {
    return startKortixMaster(8002, fixture, {
      KORTIX_TOKEN: "persistence-test-token",
      OPENCODE_PORT: "9002",
    });
  }

  async function stopServer(serverProcess: StartedServer | null) {
    await serverProcess?.stop();
  }

  async function setEnvVar(key: string, value: string) {
    const response = await fetch(`${baseURL}/env/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to set env var: ${response.status}`);
    }
  }

  async function getEnvVar(key: string): Promise<string | null> {
    const response = await fetch(`${baseURL}/env/${key}`);
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to get env var: ${response.status}`);
    }
    
    const data = await response.json();
    return data[key];
  }

  async function getAllEnvVars(): Promise<Record<string, string>> {
    const response = await fetch(`${baseURL}/env`);
    
    if (!response.ok) {
      throw new Error(`Failed to get all env vars: ${response.status}`);
    }
    
    const data = await response.json();
    return data.secrets ?? data;
  }

  test("environment variables should persist across server restarts", async () => {
    // Start server
    let server = await startServer();

    try {
      // Set multiple environment variables
      await setEnvVar("PERSIST_KEY_1", "value1");
      await setEnvVar("PERSIST_KEY_2", "value2");
      await setEnvVar("PERSIST_SPECIAL", "sp3c!@l#ch@rs");

      // Verify they're set
      expect(await getEnvVar("PERSIST_KEY_1")).toBe("value1");
      expect(await getEnvVar("PERSIST_KEY_2")).toBe("value2");
      expect(await getEnvVar("PERSIST_SPECIAL")).toBe("sp3c!@l#ch@rs");

      // Stop server
      await stopServer(server);

      // Start new server instance
      server = await startServer();

      // Verify variables are still available
      expect(await getEnvVar("PERSIST_KEY_1")).toBe("value1");
      expect(await getEnvVar("PERSIST_KEY_2")).toBe("value2");
      expect(await getEnvVar("PERSIST_SPECIAL")).toBe("sp3c!@l#ch@rs");

      // Verify all variables are loaded
      const allVars = await getAllEnvVars();
      expect(allVars).toMatchObject({
        PERSIST_KEY_1: "value1",
        PERSIST_KEY_2: "value2",
        PERSIST_SPECIAL: "sp3c!@l#ch@rs"
      });

    } finally {
      await stopServer(server);
    }
  });

  test("deleted variables should not persist", async () => {
    let server = await startServer();

    try {
      // Set a variable
      await setEnvVar("DELETE_PERSIST_KEY", "will-be-deleted");
      expect(await getEnvVar("DELETE_PERSIST_KEY")).toBe("will-be-deleted");

      // Delete it
      const deleteResponse = await fetch(`${baseURL}/env/DELETE_PERSIST_KEY`, {
        method: "DELETE"
      });
      expect(deleteResponse.ok).toBe(true);

      // Verify it's gone
      expect(await getEnvVar("DELETE_PERSIST_KEY")).toBeNull();

      // Restart server
      await stopServer(server);
      server = await startServer();

      // Variable should still be gone
      expect(await getEnvVar("DELETE_PERSIST_KEY")).toBeNull();

    } finally {
      await stopServer(server);
    }
  });

  test("modified variables should persist with new values", async () => {
    let server = await startServer();

    try {
      // Set initial value
      await setEnvVar("MODIFY_KEY", "initial-value");
      expect(await getEnvVar("MODIFY_KEY")).toBe("initial-value");

      // Modify value
      await setEnvVar("MODIFY_KEY", "modified-value");
      expect(await getEnvVar("MODIFY_KEY")).toBe("modified-value");

      // Restart server
      await stopServer(server);
      server = await startServer();

      // Should have the modified value
      expect(await getEnvVar("MODIFY_KEY")).toBe("modified-value");

    } finally {
      await stopServer(server);
    }
  });

  test("large number of variables should persist", async () => {
    let server = await startServer();

    try {
      const variableCount = 50;
      const testVars: Record<string, string> = {};

      // Set many variables
      for (let i = 0; i < variableCount; i++) {
        const key = `BULK_KEY_${i}`;
        const value = `bulk-value-${i}`;
        testVars[key] = value;
        await setEnvVar(key, value);
      }

      // Verify all are set
      const allVars = await getAllEnvVars();
      for (const [key, value] of Object.entries(testVars)) {
        expect(allVars[key]).toBe(value);
      }

      // Restart server
      await stopServer(server);
      server = await startServer();

      // Verify all variables persisted
      const persistedVars = await getAllEnvVars();
      for (const [key, value] of Object.entries(testVars)) {
        expect(persistedVars[key]).toBe(value);
      }

    } finally {
      await stopServer(server);
    }
  });
});
