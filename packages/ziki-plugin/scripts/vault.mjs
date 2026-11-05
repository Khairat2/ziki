import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function windowsProtect(action, value, run = spawnSync) {
  const operation = action === 'set' ? 'Protect' : 'Unprotect';
  const script = `[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=${action === 'set' ? '[Text.Encoding]::UTF8.GetBytes($v)' : '[Convert]::FromBase64String($v)'}; $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write(${action === 'set' ? '[Convert]::ToBase64String($r)' : '[Text.Encoding]::UTF8.GetString($r)'});`;
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: value, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0 || !result.stdout) throw new Error('Windows credential protection failed. No plaintext credentials were saved.');
  return result.stdout;
}

// No plaintext fallback: Windows user-bound DPAPI or Linux Secret Service.
export function vault(action, value, platform = process.platform, run = spawnSync) {
  if (platform === 'win32') {
    const file = join(homedir(), '.ziki-plugin', 'credential.dpapi');
    if (action === 'delete') { rmSync(file, { force: true }); return; }
    if (action === 'get') { try { value = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
    const result = windowsProtect(action, value, run);
    if (action === 'set') { mkdirSync(join(homedir(), '.ziki-plugin'), { recursive: true }); writeFileSync(file, result, { mode: 0o600 }); return; }
    return result;
  }
  if (platform === 'linux') {
    const args = action === 'set' ? ['store', '--label=Ziki coding plugin', 'application', 'ziki-code-plugin'] : [action === 'get' ? 'lookup' : 'clear', 'application', 'ziki-code-plugin'];
    const result = run('secret-tool', args, { input: action === 'set' ? value : undefined, encoding: 'utf8' });
    if (action === 'get' && result.status === 1) return null;
    if (result.error || result.status !== 0) throw new Error('Linux Secret Service is required (secret-tool and an unlocked login keyring).');
    return action === 'get' ? result.stdout.trimEnd() : undefined;
  }
  throw new Error('This MVP supports Windows DPAPI and Linux Secret Service. macOS credential storage is not implemented.');
}
