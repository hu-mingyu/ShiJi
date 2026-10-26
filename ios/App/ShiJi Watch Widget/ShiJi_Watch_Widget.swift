import SwiftUI
import WidgetKit
import AppIntents

private struct ShiJiWatchRecord: Codable {
    let id: UUID
    let date: Date
    let color: String?
    let status: Double?
    let spicy: Bool
    let rating: Int?
}

private enum ShiJiWatchRecordStore {
    static let appGroup = "group.com.mingyu.shiji"
    static let recordsKey = "shiji-watch-records"
    static let confirmationDateKey = "shiji-watch-widget-confirmation-date"

    static func appendQuickRecord(at date: Date = .now) throws {
        guard let defaults = UserDefaults(suiteName: appGroup) else {
            throw StoreError.unavailable
        }

        let data = defaults.data(forKey: recordsKey) ?? Data("[]".utf8)
        var records = try JSONDecoder().decode([ShiJiWatchRecord].self, from: data)
        records.append(ShiJiWatchRecord(
            id: UUID(),
            date: date,
            color: nil,
            status: nil,
            spicy: false,
            rating: nil
        ))
        defaults.set(try JSONEncoder().encode(records), forKey: recordsKey)
        defaults.set(date, forKey: confirmationDateKey)
    }

    private enum StoreError: Error {
        case unavailable
    }
}

struct ShiJiQuickRecordIntent: AppIntent {
    static var title: LocalizedStringResource = "记录一次"
    static var description = IntentDescription("在 ShiJi 中快速记录当前时间。")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        try ShiJiWatchRecordStore.appendQuickRecord()
        return .result()
    }
}

private struct ShiJiWidgetEntry: TimelineEntry {
    let date: Date
    let lastRecordedAt: Date?
}

private struct ShiJiWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> ShiJiWidgetEntry {
        ShiJiWidgetEntry(date: .now, lastRecordedAt: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ShiJiWidgetEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ShiJiWidgetEntry>) -> Void) {
        let entry = currentEntry()
        let policy: TimelineReloadPolicy
        if let lastRecordedAt = entry.lastRecordedAt {
            policy = .after(lastRecordedAt.addingTimeInterval(60))
        } else {
            policy = .never
        }
        completion(Timeline(entries: [entry], policy: policy))
    }

    private func currentEntry() -> ShiJiWidgetEntry {
        let defaults = UserDefaults(suiteName: ShiJiWatchRecordStore.appGroup)
        let now = Date.now
        let confirmationDate = defaults?.object(forKey: ShiJiWatchRecordStore.confirmationDateKey) as? Date
        let recentConfirmation = confirmationDate.flatMap { date in
            now.timeIntervalSince(date) >= 0 && now.timeIntervalSince(date) < 60 ? date : nil
        }
        return ShiJiWidgetEntry(
            date: now,
            lastRecordedAt: recentConfirmation
        )
    }
}

private struct ShiJiWidgetEntryView: View {
    var entry: ShiJiWidgetProvider.Entry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular:
                Text("💩")
                    .font(.system(size: 32))

            case .accessoryInline:
                Label("ShiJi · 记录一次", systemImage: "plus.circle.fill")

            case .accessoryRectangular:
                Button(intent: ShiJiQuickRecordIntent()) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("ShiJi")
                            .font(.caption.weight(.bold))
                        HStack(spacing: 4) {
                            if let lastRecordedAt = entry.lastRecordedAt {
                                Label(lastRecordedAt.formatted(date: .omitted, time: .shortened), systemImage: "checkmark.circle.fill")
                                    .lineLimit(1)
                            } else {
                                Label("记录一次", systemImage: "plus.circle.fill")
                                    .lineLimit(1)
                            }
                        }
                        .font(.caption2.weight(.semibold))
                        }
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            case .accessoryCorner:
                Label("ShiJi", systemImage: "plus.circle.fill")
            @unknown default:
                Label("ShiJi · 记录一次", systemImage: "plus.circle.fill")
            }
        }
    }
}

@main
struct ShiJi_Watch_Widget: Widget {
    let kind = "ShiJi_QuickRecord_Widget_v2"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ShiJiWidgetProvider()) { entry in
            ShiJiWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("ShiJi")
        .description("轻点矩形按钮，在 ShiJi 中直接记录当前时间。")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}
