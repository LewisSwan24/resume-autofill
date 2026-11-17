import Foundation
import UIKit
import Capacitor

/// Native UIPrintInteractionController bridge to print or save formatted resume HTML as PDF via iOS Files/AirPrint.
@objc(PrintBridgePlugin)
public class PrintBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrintBridgePlugin"
    public let jsName = "PrintBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise)
    ]

    private static let maxHtmlBytes = 2 * 1024 * 1024

    @objc func printHtml(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty, html.utf8.count <= Self.maxHtmlBytes else {
            call.reject("BAD_INPUT")
            return
        }
        let jobName = call.getString("jobName") ?? "resume-autofill"

        DispatchQueue.main.async {
            guard UIPrintInteractionController.isPrintingAvailable else {
                call.reject("UNAVAILABLE")
                return
            }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = jobName
            controller.printInfo = info
            controller.printFormatter = UIMarkupTextPrintFormatter(markupText: html)
            controller.present(animated: true) { _, _, error in
                if error != nil {
                    call.reject("PRINT_FAILED")
                } else {
                    call.resolve(["started": true])
                }
            }
        }
    }
}
