import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { SecretStore } from '../../src/services/secret-store'
import { existsSync, unlinkSync, mkdtempSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomBytes, scryptSync, createCipheriv } from 'crypto'

/**
 * Comprehensive tests for the SecretStore service.
 *
 * Each test uses a unique temp directory for the secrets, salt, and
 * encryption key files so tests are fully isolated.
 */

describe('SecretStore', () => {
  let tempDir: string
  let secretsPath: string
  let saltPath: string
  let encryptionKeyPath: string

  // Saved originals so we can restore after each test
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'secret-store-test-'))
    secretsPath = join(tempDir, '.secrets.json')
    saltPath = join(tempDir, '.salt')
    encryptionKeyPath = join(tempDir, '.encryption-key')

    // Save and override environment
    savedEnv.SECRET_FILE_PATH = process.env.SECRET_FILE_PATH
    savedEnv.SALT_FILE_PATH = process.env.SALT_FILE_PATH
    savedEnv.ENCRYPTION_KEY_PATH = process.env.ENCRYPTION_KEY_PATH
    savedEnv.KORTIX_TOKEN = process.env.KORTIX_TOKEN

    process.env.SECRET_FILE_PATH = secretsPath
    process.env.SALT_FILE_PATH = saltPath
    process.env.ENCRYPTION_KEY_PATH = encryptionKeyPath
    process.env.KORTIX_TOKEN = 'test-token-for-encryption'
  })

  afterEach(() => {
    // Restore original environment
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = val
      }
    }

    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}

    // Clean up any test env vars that may have been set
    delete process.env.TEST_KEY
    delete process.env.TEST_KEY_2
    delete process.env.UNICODE_KEY
    delete process.env.SPECIAL_KEY
    delete process.env.EMPTY_KEY
    delete process.env.LARGE_KEY
    delete process.env.PERSIST_KEY
    delete process.env.LOADED_A
    delete process.env.LOADED_B
  })

  // ─── Core CRUD ────────────────────────────────────────────────────────────

  describe('set / get (encrypt + decrypt roundtrip)', () => {
    it('stores and retrieves a simple string value', async () => {
      const store = new SecretStore()
      await store.set('TEST_KEY', 'hello-world')

      const value = await store.get('TEST_KEY')
      expect(value).toBe('hello-world')
    })

    it('encrypts the value on disk (not stored in plaintext)', async () => {
      const store = new SecretStore()
      await store.set('MY_SECRET', 'super-secret-value')

      // Read the raw file
      const raw = await Bun.file(secretsPath).text()
      // The plaintext value must NOT appear in the file
      expect(raw).not.toContain('super-secret-value')
      // But the key name is visible (it's the JSON key, not encrypted)
      expect(raw).toContain('MY_SECRET')
    })

    it('handles empty string values', async () => {
      const store = new SecretStore()
      await store.set('EMPTY_KEY', '')

      const value = await store.get('EMPTY_KEY')
      expect(value).toBe('')
    })

    it('handles special characters', async () => {
      const store = new SecretStore()
      const special = 'p@$$w0rd!#&*(){}[]|\\;:\'",.<>?/`~'
      await store.set('SPECIAL_KEY', special)

      const value = await store.get('SPECIAL_KEY')
      expect(value).toBe(special)
    })

    it('handles Unicode / emoji values', async () => {
      const store = new SecretStore()
      const emoji = '🔑🚀 ñ ü 日本語'
      await store.set('UNICODE_KEY', emoji)

      const value = await store.get('UNICODE_KEY')
      expect(value).toBe(emoji)
    })

    it('handles large values (10KB)', async () => {
      const store = new SecretStore()
      const large = 'x'.repeat(10_000)
      await store.set('LARGE_KEY', large)

      const value = await store.get('LARGE_KEY')
      expect(value).toBe(large)
    })

    it('overwrites an existing key', async () => {
      const store = new SecretStore()
      await store.set('TEST_KEY', 'original')
      await store.set('TEST_KEY', 'updated')

      const value = await store.get('TEST_KEY')
      expect(value).toBe('updated')
    })

    it('supports multiple keys simultaneously', async () => {
      const store = new SecretStore()
      await store.set('A', 'value-a')
      await store.set('B', 'value-b')
      await store.set('C', 'value-c')

      expect(await store.get('A')).toBe('value-a')
      expect(await store.get('B')).toBe('value-b')
      expect(await store.get('C')).toBe('value-c')
    })
  })

  // ─── get: missing key ────────────────────────────────────────────────────

  describe('get (missing key)', () => {
    it('returns null for a key that was never set', async () => {
      const store = new SecretStore()
      const value = await store.get('NON_EXISTENT')
      expect(value).toBeNull()
    })

    it('returns null when the secrets file does not exist', async () => {
      // Don't set anything — file doesn't even get created
      const store = new SecretStore()
      expect(existsSync(secretsPath)).toBe(false)

      const value = await store.get('ANYTHING')
      expect(value).toBeNull()
    })
  })

  // ─── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('removes a key so get returns null', async () => {
      const store = new SecretStore()
      await store.set('TEST_KEY', 'to-delete')
      expect(await store.get('TEST_KEY')).toBe('to-delete')

      await store.delete('TEST_KEY')
      expect(await store.get('TEST_KEY')).toBeNull()
    })

    it('does not throw when deleting a non-existent key', async () => {
      const store = new SecretStore()
      // Should not throw
      await store.delete('NON_EXISTENT')
      expect(await store.get('NON_EXISTENT')).toBeNull()
    })

    it('does not affect other keys', async () => {
      const store = new SecretStore()
      await store.set('KEEP', 'keep-me')
      await store.set('DELETE_ME', 'bye')

      await store.delete('DELETE_ME')

      expect(await store.get('KEEP')).toBe('keep-me')
      expect(await store.get('DELETE_ME')).toBeNull()
    })
  })

  // ─── listKeys ────────────────────────────────────────────────────────────

  describe('listKeys', () => {
    it('returns empty array when no secrets exist', async () => {
      const store = new SecretStore()
      const keys = await store.listKeys()
      expect(keys).toEqual([])
    })

    it('returns all stored key names', async () => {
      const store = new SecretStore()
      await store.set('ALPHA', 'a')
      await store.set('BETA', 'b')
      await store.set('GAMMA', 'c')

      const keys = await store.listKeys()
      expect(keys.sort()).toEqual(['ALPHA', 'BETA', 'GAMMA'])
    })

    it('reflects deletions', async () => {
      const store = new SecretStore()
      await store.set('A', '1')
      await store.set('B', '2')
      await store.delete('A')

      const keys = await store.listKeys()
      expect(keys).toEqual(['B'])
    })
  })

  // ─── getAll ──────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns empty object when no secrets exist', async () => {
      const store = new SecretStore()
      const all = await store.getAll()
      expect(all).toEqual({})
    })

    it('returns all key-value pairs decrypted', async () => {
      const store = new SecretStore()
      await store.set('KEY1', 'value1')
      await store.set('KEY2', 'value2')

      const all = await store.getAll()
      expect(all).toEqual({ KEY1: 'value1', KEY2: 'value2' })
    })
  })

  // ─── loadIntoProcessEnv ──────────────────────────────────────────────────

  describe('loadIntoProcessEnv', () => {
    it('loads all stored secrets into process.env', async () => {
      const store = new SecretStore()
      await store.set('LOADED_A', 'aaa')
      await store.set('LOADED_B', 'bbb')

      // Ensure they aren't in env yet
      delete process.env.LOADED_A
      delete process.env.LOADED_B

      await store.loadIntoProcessEnv()

      expect(process.env.LOADED_A).toBe('aaa')
      expect(process.env.LOADED_B).toBe('bbb')
    })

    it('does nothing when there are no secrets', async () => {
      const store = new SecretStore()
      // Should not throw
      await store.loadIntoProcessEnv()
    })
  })

  // ─── setEnv / deleteEnv (combined process.env + store) ───────────────────

  describe('setEnv', () => {
    it('sets the value in the store AND in process.env', async () => {
      const store = new SecretStore()
      await store.setEnv('TEST_KEY', 'env-value')

      // Check process.env
      expect(process.env.TEST_KEY).toBe('env-value')

      // Check store
      const stored = await store.get('TEST_KEY')
      expect(stored).toBe('env-value')
    })
  })

  describe('deleteEnv', () => {
    it('removes the value from the store AND from process.env', async () => {
      const store = new SecretStore()
      await store.setEnv('TEST_KEY', 'env-value')
      expect(process.env.TEST_KEY).toBe('env-value')

      await store.deleteEnv('TEST_KEY')
      expect(process.env.TEST_KEY).toBeUndefined()
      expect(await store.get('TEST_KEY')).toBeNull()
    })
  })

  // ─── Concurrency (mutex) ────────────────────────────────────────────────

  describe('concurrent writes (mutex)', () => {
    it('serializes concurrent set() calls — no data loss (deterministic)', async () => {
      const store = new SecretStore()

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.set(`CONCURRENT_${i}`, `value_${i}`),
        ),
      )

      const keys = await store.listKeys()
      expect(keys.length).toBe(10)
      for (let i = 0; i < 10; i++) {
        expect(await store.get(`CONCURRENT_${i}`)).toBe(`value_${i}`)
      }
    })

    it('serializes mixed set() and delete() — no data loss (deterministic)', async () => {
      const store = new SecretStore()
      await store.set('KEEP_ME', 'important')

      await Promise.all([
        store.set('NEW_KEY', 'new-value'),
        store.delete('NON_EXISTENT'),
        store.set('ANOTHER', 'another-value'),
      ])

      expect(await store.get('KEEP_ME')).toBe('important')
      expect(await store.get('NEW_KEY')).toBe('new-value')
      expect(await store.get('ANOTHER')).toBe('another-value')
    })

    it('onboarding scenario — 4 concurrent env writes all persist (deterministic)', async () => {
      const store = new SecretStore()

      await Promise.all([
        store.set('ONBOARDING_COMPLETE', 'true'),
        store.set('ONBOARDING_USER_NAME', 'Test User'),
        store.set('ONBOARDING_USER_SUMMARY', 'Developer at Acme'),
        store.set('ONBOARDING_COMPLETED_AT', '2026-03-19T00:00:00Z'),
      ])

      expect(await store.get('ONBOARDING_COMPLETE')).toBe('true')
      expect(await store.get('ONBOARDING_USER_NAME')).toBe('Test User')
      expect(await store.get('ONBOARDING_USER_SUMMARY')).toBe('Developer at Acme')
      expect(await store.get('ONBOARDING_COMPLETED_AT')).toBe('2026-03-19T00:00:00Z')
      expect((await store.listKeys()).length).toBe(4)
    })
  })

  // ─── Persistence across instances ────────────────────────────────────────

  describe('persistence', () => {
    it('data persists across SecretStore instances sharing the same paths', async () => {
      const store1 = new SecretStore()
      await store1.set('PERSIST', 'persisted-value')

      const store2 = new SecretStore()
      const value = await store2.get('PERSIST')
      expect(value).toBe('persisted-value')
    })

    it('salt is created once and reused', async () => {
      const store1 = new SecretStore()
      await store1.set('KEY1', 'val1')

      // Salt file should exist now
      expect(existsSync(saltPath)).toBe(true)

      // A second store reads the same salt and can decrypt
      const store2 = new SecretStore()
      expect(await store2.get('KEY1')).toBe('val1')
    })

    it('encryption key is created once and reused', async () => {
      const store1 = new SecretStore()
      await store1.set('KEY1', 'val1')

      // Encryption key file should exist now
      expect(existsSync(encryptionKeyPath)).toBe(true)

      // A second store reads the same encryption key and can decrypt
      const store2 = new SecretStore()
      expect(await store2.get('KEY1')).toBe('val1')
    })
  })

  // ─── KORTIX_TOKEN independence ──────────────────────────────────────────

  describe('encryption decoupled from KORTIX_TOKEN', () => {
    it('secrets survive KORTIX_TOKEN change', async () => {
      const store1 = new SecretStore()
      await store1.set('API_KEY', 'sk-test-123')
      await store1.set('OTHER_KEY', 'other-value')

      // Simulate KORTIX_TOKEN change (API restart, rotation, etc.)
      process.env.KORTIX_TOKEN = 'completely-different-token'

      // New store instance with new KORTIX_TOKEN — secrets should still work
      const store2 = new SecretStore()
      expect(await store2.get('API_KEY')).toBe('sk-test-123')
      expect(await store2.get('OTHER_KEY')).toBe('other-value')
    })

    it('secrets survive KORTIX_TOKEN being unset', async () => {
      const store1 = new SecretStore()
      await store1.set('IMPORTANT', 'must-survive')

      // Simulate KORTIX_TOKEN being completely absent
      delete process.env.KORTIX_TOKEN

      const store2 = new SecretStore()
      expect(await store2.get('IMPORTANT')).toBe('must-survive')
    })

    it('rotateToken does NOT break existing secrets', async () => {
      const store = new SecretStore()
      await store.set('BEFORE_ROTATE', 'original-value')

      // Rotate token
      await store.rotateToken('brand-new-token')

      // Secrets should still be readable
      expect(await store.get('BEFORE_ROTATE')).toBe('original-value')
      expect(process.env.KORTIX_TOKEN).toBe('brand-new-token')
    })
  })

  // ─── No auto-purge ──────────────────────────────────────────────────────

  describe('no auto-purge of undecryptable secrets', () => {
    it('loadIntoProcessEnv does NOT delete secrets it cannot decrypt', async () => {
      // Write a secrets file with garbage encrypted data
      const fakeSecrets = {
        secrets: {
          GOOD_KEY: '', // will be properly encrypted below
          BAD_KEY: 'invalid:encrypted:data',
        },
        version: 2,
      }

      // We need a real encrypted value for GOOD_KEY
      const store = new SecretStore()
      await store.set('GOOD_KEY', 'good-value')

      // Now tamper: add a bad key directly to the file
      const data = JSON.parse(readFileSync(secretsPath, 'utf8'))
      data.secrets.BAD_KEY = 'definitely:not:valid-encrypted-hex'
      writeFileSync(secretsPath, JSON.stringify(data, null, 2))

      // Load — should skip BAD_KEY but NOT delete it
      const store2 = new SecretStore()
      await store2.loadIntoProcessEnv()

      // Good key should be loaded
      expect(process.env.GOOD_KEY).toBe('good-value')

      // BAD_KEY should NOT be in process.env (can't decrypt)
      expect(process.env.BAD_KEY).toBeUndefined()

      // But BAD_KEY should STILL be on disk
      const afterData = JSON.parse(readFileSync(secretsPath, 'utf8'))
      expect(afterData.secrets.BAD_KEY).toBe('definitely:not:valid-encrypted-hex')
    })

    it('getAll does NOT delete secrets it cannot decrypt', async () => {
      const store = new SecretStore()
      await store.set('REAL_KEY', 'real-value')

      // Tamper the file
      const data = JSON.parse(readFileSync(secretsPath, 'utf8'))
      data.secrets.CORRUPTED = 'garbage:auth:data'
      writeFileSync(secretsPath, JSON.stringify(data, null, 2))

      // getAll should return only decryptable keys
      const store2 = new SecretStore()
      const all = await store2.getAll()
      expect(all).toEqual({ REAL_KEY: 'real-value' })

      // Corrupted key should still be on disk
      const afterData = JSON.parse(readFileSync(secretsPath, 'utf8'))
      expect(afterData.secrets.CORRUPTED).toBe('garbage:auth:data')
    })
  })

  // ─── V1 → V2 Migration ─────────────────────────────────────────────────

  describe('v1 → v2 migration', () => {
    /**
     * Helper: create a v1-style secrets file encrypted with KORTIX_TOKEN-derived key.
     * This mimics what the old SecretStore would have written.
     */
    function createV1Secrets(token: string, secrets: Record<string, string>) {
      // Generate salt
      const salt = randomBytes(32)
      writeFileSync(saltPath, salt, { mode: 0o600 })

      // Derive key the old way: scrypt(KORTIX_TOKEN, salt, 32)
      const key = scryptSync(token, salt, 32)

      // Encrypt each value
      const encrypted: Record<string, string> = {}
      for (const [k, v] of Object.entries(secrets)) {
        const iv = randomBytes(16)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        let enc = cipher.update(v, 'utf8', 'hex')
        enc += cipher.final('hex')
        const authTag = cipher.getAuthTag()
        encrypted[k] = `${iv.toString('hex')}:${authTag.toString('hex')}:${enc}`
      }

      // Write v1 secrets file (no version field, or version: 1)
      const data = { secrets: encrypted, version: 1 }
      writeFileSync(secretsPath, JSON.stringify(data, null, 2), { mode: 0o600 })
    }

    it('automatically migrates v1 secrets to v2 on first access', async () => {
      // Create v1 secrets (encrypted with KORTIX_TOKEN)
      createV1Secrets('test-token-for-encryption', {
        OPENAI_KEY: 'sk-old-openai',
        CUSTOM_VAR: 'my-custom-value',
      })

      // No encryption key file yet
      expect(existsSync(encryptionKeyPath)).toBe(false)

      // Create store — should auto-migrate
      const store = new SecretStore()
      const val = await store.get('OPENAI_KEY')
      expect(val).toBe('sk-old-openai')
      expect(await store.get('CUSTOM_VAR')).toBe('my-custom-value')

      // Encryption key file should now exist
      expect(existsSync(encryptionKeyPath)).toBe(true)

      // Secrets file should be v2
      const data = JSON.parse(readFileSync(secretsPath, 'utf8'))
      expect(data.version).toBe(2)
    })

    it('creates a backup before migration', async () => {
      createV1Secrets('test-token-for-encryption', { KEY: 'value' })

      const store = new SecretStore()
      await store.get('KEY')

      // Check backup file exists
      const files = require('fs').readdirSync(tempDir)
      const backups = files.filter((f: string) => f.includes('backup-pre-v2-migration'))
      expect(backups.length).toBe(1)
    })

    it('migrated secrets survive KORTIX_TOKEN change', async () => {
      createV1Secrets('test-token-for-encryption', {
        PRESERVED: 'must-survive-token-change',
      })

      // Migrate
      const store1 = new SecretStore()
      expect(await store1.get('PRESERVED')).toBe('must-survive-token-change')

      // Change token
      process.env.KORTIX_TOKEN = 'new-completely-different-token'

      // Should still work (encryption key is now independent)
      const store2 = new SecretStore()
      expect(await store2.get('PRESERVED')).toBe('must-survive-token-change')
    })
  })

  // ─── Encryption key rotation ────────────────────────────────────────────

  describe('rotateEncryptionKey', () => {
    it('re-encrypts all secrets with a new key', async () => {
      const store = new SecretStore()
      await store.set('KEY_A', 'value-a')
      await store.set('KEY_B', 'value-b')

      // Read the raw encrypted values before rotation
      const beforeData = JSON.parse(readFileSync(secretsPath, 'utf8'))
      const beforeA = beforeData.secrets.KEY_A

      const result = await store.rotateEncryptionKey()
      expect(result.rotated).toBe(2)
      expect(result.failed).toBe(0)

      // Values should still be readable
      expect(await store.get('KEY_A')).toBe('value-a')
      expect(await store.get('KEY_B')).toBe('value-b')

      // Raw encrypted data should be different (new key)
      const afterData = JSON.parse(readFileSync(secretsPath, 'utf8'))
      expect(afterData.secrets.KEY_A).not.toBe(beforeA)
    })

    it('creates a backup before rotation', async () => {
      const store = new SecretStore()
      await store.set('KEY', 'value')

      await store.rotateEncryptionKey()

      const files = require('fs').readdirSync(tempDir)
      const backups = files.filter((f: string) => f.includes('backup-pre-key-rotation'))
      expect(backups.length).toBe(1)
    })
  })
})
