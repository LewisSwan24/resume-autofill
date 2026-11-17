import UIKit
import CryptoKit
import Security

/// Offline Resume Keyboard App Extension (`RequestsOpenAccess = NO`).
/// Reads the stripped encrypted keyboard projection (`keyboard.enc`) from the shared App Group container,
/// never accesses network APIs or UIPasteboard, and never stores user keystrokes.
final class ResumeKeyboardViewController: UIInputViewController {
    private static let appGroupId = "group.app.raf.ios"
    private static let keyAccount = "app.raf.ios.vault.master"

    private struct KeyboardItem: Decodable {
        let label: String
        let value: String
    }

    private struct KeyboardResume: Decodable {
        let id: String
        let title: String
        let items: [KeyboardItem]
    }

    private struct KeyboardProjection: Decodable {
        let resumes: [KeyboardResume]
    }

    private var items: [KeyboardItem] = []
    private let stackView = UIStackView()

    override func viewDidLoad() {
        super.viewDidLoad()
        setupLayout()
        loadProjection()
    }

    private func setupLayout() {
        stackView.axis = .vertical
        stackView.spacing = 6
        stackView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stackView)

        NSLayoutConstraint.activate([
            stackView.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            stackView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            stackView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            stackView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),
            stackView.heightAnchor.constraint(greaterThanOrEqualToConstant: 180)
        ])

        let switchButton = UIButton(type: .system)
        switchButton.setTitle("Next Keyboard", for: .normal)
        switchButton.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
        stackView.addArrangedSubview(switchButton)
    }

    private func loadProjection() {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupId)?
            .appendingPathComponent("raf_vault", isDirectory: true),
              let combined = try? Data(contentsOf: dir.appendingPathComponent("keyboard.enc")),
              let key = loadMasterKey(),
              let box = try? AES.GCM.SealedBox(combined: combined),
              let plaintext = try? AES.GCM.open(box, using: key, authenticating: Data("keyboard".utf8)),
              let projection = try? JSONDecoder().decode(KeyboardProjection.self, from: plaintext) else {
            return
        }
        items = projection.resumes.first?.items ?? []
        renderChips()
    }

    private func loadMasterKey() -> SymmetricKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: Self.keyAccount,
            kSecAttrAccessGroup as String: Self.appGroupId,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data, data.count == 32 else { return nil }
        return SymmetricKey(data: data)
    }

    private func renderChips() {
        for item in items.prefix(12) {
            let button = UIButton(type: .system)
            button.contentHorizontalAlignment = .leading
            button.setTitle("\(item.label): \(item.value)", for: .normal)
            button.accessibilityLabel = item.label
            button.addAction(UIAction { [weak self] _ in
                self?.textDocumentProxy.insertText(item.value)
            }, for: .touchUpInside)
            stackView.addArrangedSubview(button)
        }
    }
}
