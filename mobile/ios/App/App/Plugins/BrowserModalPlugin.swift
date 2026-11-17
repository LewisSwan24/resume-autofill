import Foundation
import UIKit
import WebKit
import Capacitor

/// Isolated in-app fill browser hosted inside a modal WKWebView using a dedicated `WKContentWorld`
/// (`raf_isolated`) so host page scripts cannot access extension/autofill scripts or bridge handlers.
@objc(BrowserModalPlugin)
public class BrowserModalPlugin: CAPPlugin, CAPBridgedPlugin, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    public let identifier = "BrowserModalPlugin"
    public let jsName = "FillBrowser"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "navigate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "post", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSiteData", returnType: CAPPluginReturnPromise)
    ]

    private static let world = WKContentWorld.world(name: "raf_isolated")
    private static let handlerName = "rafBridge"

    private var presentedNav: UINavigationController?
    private var webView: WKWebView?
    private var frameSecrets: [String: String] = [:]

    @objc func capabilities(_ call: CAPPluginCall) {
        call.resolve(["supported": true, "worldIsolation": true])
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let urlStr = call.getString("url"),
              let url = URL(string: urlStr),
              url.scheme == "http" || url.scheme == "https" else {
            call.reject("BAD_ARGS")
            return
        }

        DispatchQueue.main.async {
            let config = WKWebViewConfiguration()
            let userContent = WKUserContentController()
            userContent.addScriptMessageHandler(self, contentWorld: Self.world, name: Self.handlerName)

            if let injectUrl = Bundle.main.url(forResource: "engine", withExtension: "js", subdirectory: "public/raf"),
               let scriptText = try? String(contentsOf: injectUrl, encoding: .utf8) {
                let script = WKUserScript(source: scriptText, injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: Self.world)
                userContent.addUserScript(script)
            }
            config.userContentController = userContent
            config.websiteDataStore = WKWebsiteDataStore.default()

            let wv = WKWebView(frame: .zero, configuration: config)
            wv.navigationDelegate = self
            self.webView = wv

            let vc = UIViewController()
            vc.view = wv
            vc.navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(self.dismissModal))

            let nav = UINavigationController(rootViewController: vc)
            nav.modalPresentationStyle = .fullScreen
            self.presentedNav = nav
            self.bridge?.viewController?.present(nav, animated: true) {
                wv.load(URLRequest(url: url))
                call.resolve()
            }
        }
    }

    @objc private func dismissModal() {
        presentedNav?.dismiss(animated: true)
        presentedNav = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName, contentWorld: Self.world)
        webView = nil
        frameSecrets.removeAll()
        notifyListeners("navigation", data: ["closed": true])
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.dismissModal()
            call.resolve()
        }
    }

    @objc func loadUrl(_ call: CAPPluginCall) {
        guard let urlStr = call.getString("url"),
              let url = URL(string: urlStr),
              url.scheme == "http" || url.scheme == "https" else {
            call.reject("BAD_ARGS")
            return
        }
        DispatchQueue.main.async {
            self.webView?.load(URLRequest(url: url))
            call.resolve()
        }
    }

    @objc func navigate(_ call: CAPPluginCall) {
        let dir = call.getString("direction")
        DispatchQueue.main.async {
            if dir == "back", self.webView?.canGoBack == true {
                self.webView?.goBack()
            } else if dir == "forward", self.webView?.canGoForward == true {
                self.webView?.goForward()
            } else if dir == "reload" {
                self.webView?.reload()
            }
            call.resolve()
        }
    }

    @objc func post(_ call: CAPPluginCall) {
        guard let payload = call.getObject("payload"),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            call.reject("BAD_ARGS")
            return
        }
        DispatchQueue.main.async {
            guard let wv = self.webView else {
                call.reject("NOT_FOUND")
                return
            }
            wv.evaluateJavaScript("window.__rafNativeMessage && window.__rafNativeMessage(\(json))", in: nil, in: Self.world) { result in
                switch result {
                case .success:
                    call.resolve()
                case .failure:
                    call.reject("FAILED")
                }
            }
        }
    }

    @objc func clearSiteData(_ call: CAPPluginCall) {
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: .distantPast) {
            call.resolve()
        }
    }

    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        let originProto = message.frameInfo.securityOrigin.protocol
        guard originProto == "http" || originProto == "https" else {
            replyHandler(nil, "FORBIDDEN_ORIGIN")
            return
        }
        notifyListeners("message", data: [
            "origin": "\(originProto)://\(message.frameInfo.securityOrigin.host)",
            "isMainFrame": message.frameInfo.isMainFrame,
            "body": message.body
        ])
        replyHandler(["ok": true], nil)
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        notifyListeners("navigation", data: [
            "url": webView.url?.absoluteString ?? "",
            "title": webView.title ?? "",
            "canGoBack": webView.canGoBack,
            "canGoForward": webView.canGoForward
        ])
    }
}
