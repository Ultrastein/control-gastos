// Extensión de widgets de Gastos: widget de inicio (chico y mediano) y control del Centro de control.
// Los datos los escribe la app (WidgetBridgePlugin) en el App Group; acá solo se leen.
// Todo toque abre la app con un enlace gastos:// (la web lo convierte en #/quick-add o #/reportes).
import WidgetKit
import SwiftUI
import AppIntents

private let appGroup = "group.com.nicolaskane.gastos"
private let widgetKey = "widgetData"
private let newExpenseURL = URL(string: "gastos://quick-add")!
private let newIncomeURL = URL(string: "gastos://quick-add?type=ingreso")!
private let reportURL = URL(string: "gastos://reportes")!

// Textos ya formateados por la app ($50.000,00). Vacío si todavía no se abrió la app.
struct Snapshot {
    var month = ""
    var spent = ""
    var balance = ""
    var perDay = ""
    var limitPct = ""

    static func load() -> Snapshot {
        guard let data = UserDefaults(suiteName: appGroup)?.data(forKey: widgetKey),
              let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: String] else {
            return Snapshot()
        }
        return Snapshot(month: dict["month"] ?? "", spent: dict["spent"] ?? "", balance: dict["balance"] ?? "",
                        perDay: dict["perDay"] ?? "", limitPct: dict["limitPct"] ?? "")
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let snap: Snapshot
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: .now, snap: Snapshot(month: "Septiembre", spent: "$250.000,00", balance: "$80.000,00"))
    }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now, snap: Snapshot.load()))
    }
    // La app pide recargar cada vez que cambia algo; igual se refresca solo cada hora.
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
        completion(Timeline(entries: [Entry(date: .now, snap: Snapshot.load())], policy: .after(next)))
    }
}

struct ResumenView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        let s = entry.snap
        VStack(alignment: .leading, spacing: 4) {
            Text(s.month.isEmpty ? "Gastos" : "Gastado en " + s.month)
                .font(.caption).foregroundStyle(.secondary)
            Text(s.spent.isEmpty ? "Abrí la app" : s.spent)
                .font(.title3).bold().minimumScaleFactor(0.6).lineLimit(1)
            if !s.balance.isEmpty {
                Text("Saldo " + s.balance).font(.caption).lineLimit(1).minimumScaleFactor(0.7)
            }
            if !s.perDay.isEmpty {
                Text(s.perDay + " por día").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            if family == .systemMedium {
                HStack {
                    Link(destination: newExpenseURL) { Label("Gasto", systemImage: "minus.circle.fill") }
                    Spacer()
                    Link(destination: newIncomeURL) { Label("Ingreso", systemImage: "plus.circle.fill") }
                    Spacer()
                    Link(destination: reportURL) { Label("Reporte", systemImage: "chart.bar.fill") }
                }
                .font(.caption).bold()
            } else {
                Label("Cargar gasto", systemImage: "plus.circle.fill").font(.caption).bold()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(newExpenseURL)
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct ResumenWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.nicolaskane.gastos.resumen", provider: Provider()) { entry in
            ResumenView(entry: entry)
        }
        .configurationDisplayName("Gastos del mes")
        .description("Cuánto gastaste este mes y un acceso para cargar un gasto.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// Centro de control (iOS 18): un botón que abre la carga rápida.
@available(iOS 18.0, *)
struct NuevoGastoControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.nicolaskane.gastos.nuevo-gasto") {
            ControlWidgetButton(action: OpenURLIntent(newExpenseURL)) {
                Label("Nuevo gasto", systemImage: "plus.circle")
            }
        }
        .displayName("Nuevo gasto")
        .description("Abre Gastos lista para cargar un gasto.")
    }
}

@main
struct GastosWidgetsBundle: WidgetBundle {
    var body: some Widget {
        ResumenWidget()
        if #available(iOS 18.0, *) {
            NuevoGastoControl()
        }
    }
}
