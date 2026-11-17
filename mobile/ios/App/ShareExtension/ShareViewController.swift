import UIKit
import UniformTypeIdentifiers

/// Share Extension receiving shared job links (`http`/`https`) or resume files (`PDF`/`.docx`)
/// and staging them into the App Group handoff folder before launching the host app via `raf://incoming`.
final class ShareViewController: UIViewController {
    private static let appGroupId = "group.app.raf.ios"

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleSharedItems()
    }

    private func handleSharedItems() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let providers = item.attachments, !providers.isEmpty else {
            finish()
            return
        }

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                    if let url = data as? URL, url.scheme == "http" || url.scheme == "https" {
                        self?.stageHandoff(["kind": "url", "url": url.absoluteString])
                    }
                    self?.finish()
                }
                return
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                copySharedFile(provider: provider, typeId: UTType.pdf.identifier)
                return
            }
            let docxId = "org.openxmlformats.wordprocessingml.document"
            if provider.hasItemConformingToTypeIdentifier(docxId) {
                copySharedFile(provider: provider, typeId: docxId)
                return
            }
        }
        finish()
    }

    private func copySharedFile(provider: NSItemProvider, typeId: String) {
        provider.loadFileRepresentation(forTypeIdentifier: typeId) { [weak self] tempUrl, _ in
            defer { self?.finish() }
            guard let tempUrl,
                  let dir = self?.handoffDirectory() else { return }
            let dest = dir.appendingPathComponent(tempUrl.lastPathComponent)
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.copyItem(at: tempUrl, to: dest)
            self?.stageHandoff(["kind": "file", "path": dest.lastPathComponent])
        }
    }

    private func handoffDirectory() -> URL? {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupId) else {
            return nil
        }
        var dir = base.appendingPathComponent("raf_incoming", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }

    private func stageHandoff(_ payload: [String: String]) {
        guard let dir = handoffDirectory(),
              let json = try? JSONSerialization.data(withJSONObject: payload) else { return }
        try? json.write(to: dir.appendingPathComponent("pending.json"), options: .atomic)
        DispatchQueue.main.async {
            if let schemeUrl = URL(string: "raf://incoming") {
                var responder: UIResponder? = self
                while let r = responder {
                    if let app = r as? UIApplication {
                        app.open(schemeUrl, options: [:], completionHandler: nil)
                        break
                    }
                    responder = r.next
                }
            }
        }
    }

    private func finish() {
        DispatchQueue.main.async {
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }
}
