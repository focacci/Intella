import WidgetKit
import SwiftUI

struct IntellaEntry: TimelineEntry {
    let date: Date
}

struct IntellaProvider: TimelineProvider {
    func placeholder(in context: Context) -> IntellaEntry {
        IntellaEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (IntellaEntry) -> Void) {
        completion(IntellaEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<IntellaEntry>) -> Void) {
        // Static content — a single entry that never needs to refresh.
        completion(Timeline(entries: [IntellaEntry(date: Date())], policy: .never))
    }
}

struct IntellaWidgetView: View {
    var body: some View {
        ZStack {
            Color.black
            Image("IntellaLogo")
                .resizable()
                .scaledToFit()
                .padding(2)
        }
        .clipShape(Circle())
        .containerBackground(.black, for: .widget)
    }
}

struct IntellaWatchWidget: Widget {
    let kind: String = "IntellaWatchWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: IntellaProvider()) { _ in
            IntellaWidgetView()
        }
        .configurationDisplayName("Intella")
        .description("Open Intella.")
        .supportedFamilies([.accessoryCircular])
    }
}

#Preview(as: .accessoryCircular) {
    IntellaWatchWidget()
} timeline: {
    IntellaEntry(date: Date())
}
