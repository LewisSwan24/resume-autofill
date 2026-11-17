// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const iosDir = join(repo, 'mobile/ios/App');

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\"])\/\/.*$/gm, '$1');

describe('iOS Capacitor native & extension security compliance', () => {
  it('enforces RequestsOpenAccess = NO and zero network/pasteboard APIs in KeyboardExtension', () => {
    const plist = readFileSync(join(iosDir, 'KeyboardExtension/Info.plist'), 'utf8');
    expect(plist).toMatch(/<key>RequestsOpenAccess<\/key>\s*<false\/>/);
    expect(plist).toContain('com.apple.keyboard-service');

    const swift = stripComments(readFileSync(join(iosDir, 'KeyboardExtension/ResumeKeyboardViewController.swift'), 'utf8'));
    expect(swift).not.toMatch(/\b(URLSession|NSURLConnection|URLRequest|UIPasteboard|WKWebView|SFSafariViewController)\b/);
    expect(swift).toContain('CryptoKit');
    expect(swift).toContain('group.app.raf.ios');
  });

  it('uses isolated WKContentWorld and Keychain + iCloud backup exclusion on host plugins', () => {
    const vault = readFileSync(join(iosDir, 'App/Plugins/ProfileVaultPlugin.swift'), 'utf8');
    expect(vault).toContain('isExcludedFromBackup = true');
    expect(vault).toContain('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly');
    expect(vault).toContain('AES.GCM.seal');

    const browser = readFileSync(join(iosDir, 'App/Plugins/BrowserModalPlugin.swift'), 'utf8');
    expect(browser).toContain('WKContentWorld.world(name: "raf_isolated")');
    expect(browser).toContain('WKScriptMessageHandlerWithReply');
    expect(browser).toMatch(/originProto == "http" \|\| originProto == "https"/);

    const print = readFileSync(join(iosDir, 'App/Plugins/PrintBridgePlugin.swift'), 'utf8');
    expect(print).toContain('UIPrintInteractionController.shared');

    expect(existsSync(join(iosDir, 'ShareExtension/ShareViewController.swift'))).toBe(true);
    expect(existsSync(join(iosDir, 'ExportOptions.plist'))).toBe(true);
    expect(existsSync(join(repo, '.github/workflows/mobile-build.yml'))).toBe(true);
  });
});
