import { describe, test, expect } from 'bun:test';
import { DEFAULT_PORTS, buildDockerRunCommand, sanitizePorts } from '../update/container-config';
import { buildContainerConfig } from '../update/setup';

describe('sandbox container port config', () => {
  test('default port list does not bind host port 3456', () => {
    expect(DEFAULT_PORTS).not.toContain('3456:3456');
  });

  test('buildContainerConfig inherits non-conflicting default ports', () => {
    const config = buildContainerConfig({ image: 'kortix/computer:0.8.20' });
    expect(config.ports).toEqual(DEFAULT_PORTS);
    expect(config.ports).not.toContain('3456:3456');
  });

  test('buildDockerRunCommand does not emit 3456 binding by default', () => {
    const config = buildContainerConfig({ image: 'kortix/computer:0.8.20' });
    const command = buildDockerRunCommand(config);
    expect(command).not.toContain('-p 3456:3456');
    expect(command).toContain('-p 8000:8000');
  });

  test('sanitizePorts strips legacy 3456 host binding', () => {
    expect(sanitizePorts(['3000:3000', '3456:3456', '8000:8000'])).toEqual([
      '3000:3000',
      '8000:8000',
    ]);
  });

  test('buildContainerConfig sanitizes custom ports too', () => {
    const config = buildContainerConfig({
      image: 'kortix/computer:0.8.20',
      ports: ['3456:3456', '8000:8000'],
    });
    expect(config.ports).toEqual(['8000:8000']);
  });
});
