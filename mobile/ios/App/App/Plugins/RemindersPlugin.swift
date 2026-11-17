import Foundation
import Capacitor
import UserNotifications

/// Local deadline notification bridge using UNUserNotificationCenter with privacy-redacted lockscreen copy.
@objc(RemindersPlugin)
public class RemindersPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RemindersPlugin"
    public let jsName = "Reminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private static let maxEntries = 1000
    private static let idPrefix = "raf_deadline_"

    @objc func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let perm: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                perm = "granted"
            case .denied:
                perm = "denied"
            default:
                perm = "prompt"
            }
            call.resolve([
                "permission": perm,
                "enabled": perm == "granted",
                "channelBlocked": settings.authorizationStatus == .denied
            ])
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            call.resolve(["permission": granted ? "granted" : "denied"])
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url) { ok in
                    call.resolve(["opened": ok])
                }
            } else {
                call.resolve(["opened": false])
            }
        }
    }

    @objc func sync(_ call: CAPPluginCall) {
        let entries = call.getArray("entries", JSObject.self) ?? []
        let publicText = call.getString("publicText") ?? "有一个网申快截止了"
        if entries.count > Self.maxEntries {
            call.reject("TOO_MANY_ENTRIES")
            return
        }

        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let oldIds = pending.map(\.identifier).filter { $0.hasPrefix(Self.idPrefix) }
            center.removePendingNotificationRequests(withIdentifiers: oldIds)

            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"

            var scheduled = 0
            for item in entries {
                guard let id = item["id"] as? String,
                      let at = item["at"] as? String,
                      let fireDate = formatter.date(from: at),
                      fireDate > Date() else { continue }

                let content = UNMutableNotificationContent()
                content.title = (item["title"] as? String) ?? publicText
                content.body = (item["text"] as? String) ?? ""
                content.sound = .default

                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
                let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                let req = UNNotificationRequest(identifier: Self.idPrefix + id, content: content, trigger: trigger)
                center.add(req)
                scheduled += 1
            }
            call.resolve(["scheduled": scheduled])
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let ids = pending.map(\.identifier).filter { $0.hasPrefix(Self.idPrefix) }
            center.removePendingNotificationRequests(withIdentifiers: ids)
            call.resolve()
        }
    }
}
