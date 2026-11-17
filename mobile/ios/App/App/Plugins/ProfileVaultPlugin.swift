import Foundation
import Capacitor
import CryptoKit
import Security

/// Encrypted vault persisted in the shared App Group container using a Keychain-backed 256-bit AES-GCM key.
/// Every file stored under the vault explicitly disables iCloud backup via `isExcludedFromBackup = true`.
@objc(ProfileVaultPlugin)
public class ProfileVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ProfileVaultPlugin"
    public let jsName = "ProfileVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFileMeta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeKeyboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearKeyboard", returnType: CAPPluginReturnPromise)
    ]

    private static let appGroupId = "group.app.raf.ios"
    private static let keyAccount = "app.raf.ios.vault.master"
    private static let filePrefix = "file_"
    private static let metaSuffix = ".meta.enc"
    private static let dataSuffix = ".data.enc"

    private let ioQueue = DispatchQueue(label: "app.raf.ios.vault", qos: .userInitiated)

    private func vaultDirectory() throws -> URL {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupId)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        var dir = base.appendingPathComponent("raf_vault", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try dir.setResourceValues(resourceValues)
        return dir
    }

    private func loadOrCreateMasterKey() throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: Self.keyAccount,
            kSecAttrAccessGroup as String: Self.appGroupId,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        let fresh = SymmetricKey(size: .bits256)
        let raw = fresh.withUnsafeBytes { Data($0) }
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: Self.keyAccount,
            kSecAttrAccessGroup as String: Self.appGroupId,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: raw
        ]
        SecItemDelete(addQuery as CFDictionary)
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw NSError(domain: "ProfileVault", code: Int(addStatus))
        }
        return fresh
    }

    private func sealAndWrite(_ plaintext: Data, to fileName: String, aad: String) throws {
        let key = try loadOrCreateMasterKey()
        let sealed = try AES.GCM.seal(plaintext, using: key, authenticating: Data(aad.utf8))
        guard let combined = sealed.combined else {
            throw NSError(domain: "ProfileVault", code: -1)
        }
        var url = try vaultDirectory().appendingPathComponent(fileName)
        try combined.write(to: url, options: [.atomic, .completeFileProtection])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }

    private func readAndOpen(_ fileName: String, aad: String) throws -> Data? {
        let url = try vaultDirectory().appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let combined = try Data(contentsOf: url)
        let box = try AES.GCM.SealedBox(combined: combined)
        let key = try loadOrCreateMasterKey()
        return try AES.GCM.open(box, using: key, authenticating: Data(aad.utf8))
    }

    @objc func read(_ call: CAPPluginCall) {
        ioQueue.async {
            do {
                let data = try self.readAndOpen("profile.enc", aad: "profile")
                call.resolve(["data": data.flatMap { String(data: $0, encoding: .utf8) } as Any])
            } catch {
                call.reject("VAULT_READ_FAILED")
            }
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let text = call.getString("data") else {
            call.reject("BAD_INPUT")
            return
        }
        ioQueue.async {
            do {
                try self.sealAndWrite(Data(text.utf8), to: "profile.enc", aad: "profile")
                call.resolve()
            } catch {
                call.reject("VAULT_WRITE_FAILED")
            }
        }
    }

    @objc func readState(_ call: CAPPluginCall) {
        ioQueue.async {
            do {
                let data = try self.readAndOpen("state.enc", aad: "state")
                call.resolve(["data": data.flatMap { String(data: $0, encoding: .utf8) } as Any])
            } catch {
                call.reject("STATE_READ_FAILED")
            }
        }
    }

    @objc func writeState(_ call: CAPPluginCall) {
        guard let text = call.getString("data") else {
            call.reject("BAD_INPUT")
            return
        }
        ioQueue.async {
            do {
                try self.sealAndWrite(Data(text.utf8), to: "state.enc", aad: "state")
                call.resolve()
            } catch {
                call.reject("STATE_WRITE_FAILED")
            }
        }
    }

    @objc func clearState(_ call: CAPPluginCall) {
        ioQueue.async {
            if let dir = try? self.vaultDirectory() {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent("state.enc"))
            }
            call.resolve()
        }
    }

    private func validFileId(_ id: String?) -> String? {
        guard let id, !id.isEmpty, id.count <= 64,
              id.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else {
            return nil
        }
        return id
    }

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let id = validFileId(call.getString("id")),
              let meta = call.getString("meta"),
              let b64 = call.getString("data"),
              let raw = Data(base64Encoded: b64) else {
            call.reject("BAD_INPUT")
            return
        }
        ioQueue.async {
            do {
                try self.sealAndWrite(Data(meta.utf8), to: "\(Self.filePrefix)\(id)\(Self.metaSuffix)", aad: "file_meta:\(id)")
                try self.sealAndWrite(raw, to: "\(Self.filePrefix)\(id)\(Self.dataSuffix)", aad: "file_data:\(id)")
                call.resolve()
            } catch {
                call.reject("FILE_WRITE_FAILED")
            }
        }
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let id = validFileId(call.getString("id")) else {
            call.reject("BAD_INPUT")
            return
        }
        ioQueue.async {
            do {
                let meta = try self.readAndOpen("\(Self.filePrefix)\(id)\(Self.metaSuffix)", aad: "file_meta:\(id)")
                let data = try self.readAndOpen("\(Self.filePrefix)\(id)\(Self.dataSuffix)", aad: "file_data:\(id)")
                call.resolve([
                    "meta": meta.flatMap { String(data: $0, encoding: .utf8) } as Any,
                    "data": data?.base64EncodedString() as Any
                ])
            } catch {
                call.reject("FILE_READ_FAILED")
            }
        }
    }

    @objc func readFileMeta(_ call: CAPPluginCall) {
        guard let id = validFileId(call.getString("id")) else {
            call.reject("BAD_INPUT")
            return
        }
        ioQueue.async {
            do {
                let meta = try self.readAndOpen("\(Self.filePrefix)\(id)\(Self.metaSuffix)", aad: "file_meta:\(id)")
                call.resolve(["meta": meta.flatMap { String(data: $0, encoding: .utf8) } as Any])
            } catch {
                call.reject("FILE_READ_FAILED")
            }
        }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let id = validFileId(call.getString("id")) else {
            call.reject("BAD_INPUT")
            return
        }
        ioQueue.async {
            if let dir = try? self.vaultDirectory() {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(Self.filePrefix)\(id)\(Self.metaSuffix)"))
                try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(Self.filePrefix)\(id)\(Self.dataSuffix)"))
            }
            call.resolve()
        }
    }

    @objc func listFiles(_ call: CAPPluginCall) {
        ioQueue.async {
            guard let dir = try? self.vaultDirectory(),
                  let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else {
                call.resolve(["ids": []])
                return
            }
            let ids = Set(names.compactMap { name -> String? in
                guard name.hasPrefix(Self.filePrefix) else { return nil }
                if name.hasSuffix(Self.metaSuffix) {
                    return String(name.dropFirst(Self.filePrefix.count).dropLast(Self.metaSuffix.count))
                }
                if name.hasSuffix(Self.dataSuffix) {
                    return String(name.dropFirst(Self.filePrefix.count).dropLast(Self.dataSuffix.count))
                }
                return nil
            })
            call.resolve(["ids": Array(ids).sorted()])
        }
    }

    @objc func writeKeyboard(_ call: CAPPluginCall) {
        guard let text = call.getString("data") else {
            call.reject("BAD_INPUT")
            return
        }
        ioQueue.async {
            do {
                try self.sealAndWrite(Data(text.utf8), to: "keyboard.enc", aad: "keyboard")
                call.resolve()
            } catch {
                call.reject("KEYBOARD_WRITE_FAILED")
            }
        }
    }

    @objc func clearKeyboard(_ call: CAPPluginCall) {
        ioQueue.async {
            if let dir = try? self.vaultDirectory() {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent("keyboard.enc"))
            }
            call.resolve()
        }
    }
}
