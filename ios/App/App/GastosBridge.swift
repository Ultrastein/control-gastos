// Puente entre la web (js/io/native.js) y iOS: enlaces gastos:// y datos para el widget.
// Sin plugins de terceros: un solo plugin propio registrado a mano.
import UIKit
import Capacitor
import WidgetKit

enum GastosShared {
    // Tiene que coincidir con el App Group de la app y de la extensión GastosWidgets.
    static let appGroup = "group.com.nicolaskane.gastos"
    static let widgetKey = "widgetData"
}

// gastos://quick-add?amount=2500&cat=Comida -> "#/quick-add?amount=2500&cat=Comida"
// gastos://reportes -> "#/reportes". Cualquier otra cosa: nil.
func hashForDeepLink(_ url: URL) -> String? {
    guard url.scheme?.lowercased() == "gastos", let host = url.host, !host.isEmpty else { return nil }
    let allowed = ["quick-add", "reportes", "resumen", "historial", "presupuestos"]
    guard allowed.contains(host) else { return nil }
    let query = url.query.map { "?" + $0 } ?? ""
    return "#/" + host + query
}

class GastosBridgeViewController: CAPBridgeViewController {
    let widgetBridge = WidgetBridgePlugin()

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(widgetBridge)
    }

    // Con la app ya abierta se cambia el hash (app.js escucha hashchange).
    // En frío queda pendiente y la web lo pide con takeLink() al arrancar.
    func open(_ url: URL) {
        guard let hash = hashForDeepLink(url) else { return }
        if widgetBridge.jsReady, let webView = webView {
            let literal = (try? String(data: JSONSerialization.data(withJSONObject: [hash]), encoding: .utf8)) ?? "[]"
            webView.evaluateJavaScript("location.hash = \(literal)[0];", completionHandler: nil)
        } else {
            widgetBridge.pendingHash = hash
        }
    }
}

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeLink", returnType: CAPPluginReturnPromise),
    ]

    var pendingHash: String?
    var jsReady = false

    // Guarda los textos ya formateados por la web ($50.000,00) y refresca los widgets.
    @objc func update(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: GastosShared.appGroup) else {
            call.reject("Sin App Group")
            return
        }
        let keys = ["month", "spent", "balance", "perDay", "limitPct", "currency", "updated"]
        var data: [String: String] = [:]
        for k in keys {
            if let v = call.getString(k) { data[k] = v }
        }
        if let json = try? JSONSerialization.data(withJSONObject: data) {
            defaults.set(json, forKey: GastosShared.widgetKey)
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    // La web avisa que ya arrancó y se lleva el enlace pendiente (si lo hay).
    @objc func takeLink(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.jsReady = true
            let hash = self.pendingHash
            self.pendingHash = nil
            call.resolve(hash.map { ["hash": $0] } ?? [:])
        }
    }
}
