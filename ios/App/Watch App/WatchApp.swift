import SwiftUI
import WatchKit

private struct WatchRecord: Codable, Identifiable {
    let id: UUID
    let date: Date
    let color: String?
    let status: Double?
    let spicy: Bool
    let rating: Int?
}

@main
struct ShiJiWatchApp: App {
    var body: some Scene {
        WindowGroup {
            WatchRecordView()
        }
    }
}

private struct WatchRecordView: View {
    private let colors: [(name: String, hex: String)] = [
        ("琥珀", "#A96800"),
        ("金黄", "#E0B458"),
        ("棕色", "#805238"),
        ("棕红", "#B96D4B"),
        ("橄榄", "#74844A"),
        ("蓝灰", "#5F7898"),
    ]

    @State private var selectedColor = -1
    @State private var customColorHex: String?
    @State private var isPalettePresented = false
    @State private var status = 0.5
    @State private var hasStatus = false
    @State private var spicy = false
    @State private var rating: Int?
    @State private var feedback = ""
    @State private var savedAt: Date?

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 10) {
                        Button(action: saveRecord) {
                            Label("记录一次", systemImage: "plus")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 54)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.66, green: 0.40, blue: 0.12))

                        if let savedAt {
                            Text("已记录 · \(savedAt.formatted(date: .omitted, time: .shortened))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        } else if !feedback.isEmpty {
                            Text(feedback)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                    .overlay(alignment: .topTrailing) {
                        spicyButton
                            .padding(.top, 2)
                            .padding(.trailing, 2)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        colorPicker
                        statusPicker
                        ratingPicker
                    }
                    .padding(.bottom, 12)
                }
                .padding(.horizontal, 4)
            }
        }
        .fullScreenCover(isPresented: $isPalettePresented) {
            WatchColorPaletteView(initialHex: customColorHex) { hex in
                customColorHex = hex
                selectedColor = -1
            }
        }
    }

    private var colorPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 4), spacing: 5) {
                ForEach(colors.indices, id: \.self) { index in
                    Button {
                        if selectedColor == index {
                            selectedColor = -1
                            customColorHex = nil
                        } else {
                            selectedColor = index
                            customColorHex = nil
                        }
                    } label: {
                        Circle()
                            .fill(Color(hex: colors[index].hex))
                            .frame(width: 21, height: 21)
                            .overlay {
                                Circle()
                                    .strokeBorder(.white.opacity(0.8), lineWidth: 1)
                            }
                            .overlay {
                                if selectedColor == index {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(.white)
                                }
                        }
                            .frame(maxWidth: .infinity, minHeight: 27)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("选择颜色：\(colors[index].name)")
                    .accessibilityAddTraits(selectedColor == index ? .isSelected : [])
                }

                Button {
                    isPalettePresented = true
                } label: {
                    paletteButtonSwatch
                        .frame(width: 21, height: 21)
                        .overlay {
                            Circle().strokeBorder(.white.opacity(0.8), lineWidth: 1)
                        }
                        .overlay {
                            if customColorHex != nil {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(.white)
                            } else {
                                Image(systemName: "plus")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 27)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(customColorHex == nil ? "更多颜色" : "更改自选颜色")
            }
        }
    }

    @ViewBuilder
    private var paletteButtonSwatch: some View {
        if let customColorHex {
            Circle().fill(Color(hex: customColorHex))
        } else {
            Circle().fill(ColorPalette.hueGradient)
        }
    }

    private var statusPicker: some View {
        HStack(spacing: 7) {
            statusEndpoint(
                topLeft: "若", topRight: "上",
                bottomLeft: "水", bottomRight: "善",
                accessibilityLabel: "上善若水", value: 0
            )

            statusTrack
                .frame(maxWidth: .infinity, minHeight: 34)

            statusEndpoint(
                topLeft: "磐", topRight: "坚",
                bottomLeft: "石", bottomRight: "如",
                accessibilityLabel: "坚如磐石", value: 1
            )
        }
    }

    private func statusEndpoint(
        topLeft: String,
        topRight: String,
        bottomLeft: String,
        bottomRight: String,
        accessibilityLabel: String,
        value: Double
    ) -> some View {
        Button {
            if hasStatus && status == value {
                hasStatus = false
                status = 0.5
            } else {
                status = value
                hasStatus = true
            }
        } label: {
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    Text(topLeft)
                    Text(topRight)
                }
                HStack(spacing: 0) {
                    Text(bottomLeft)
                    Text(bottomRight)
                }
            }
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(hasStatus && status == value ? .primary : .secondary)
            .padding(3)
            .background {
                if hasStatus && status == value {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color.primary.opacity(0.12))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(hasStatus && status == value ? .isSelected : [])
    }

    private var statusTrack: some View {
        GeometryReader { geometry in
            let trackWidth = max(geometry.size.width, 1)
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.secondary.opacity(0.28))
                    .frame(height: 5)

                if hasStatus {
                    Capsule()
                        .fill(Color.accentColor)
                        .frame(width: trackWidth * status, height: 5)
                }

                Circle()
                    .fill(hasStatus ? Color.accentColor : Color.secondary.opacity(0.7))
                    .frame(width: 13, height: 13)
                    .offset(x: max(0, min(trackWidth - 13, trackWidth * status - 6.5)))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        status = min(1, max(0, drag.location.x / trackWidth))
                        hasStatus = true
                    }
            )
            .accessibilityElement()
            .accessibilityLabel("状态")
            .accessibilityValue(hasStatus ? statusLabel : "未设置")
        }
    }

    private var spicyButton: some View {
        Button {
            spicy.toggle()
        } label: {
            Image(systemName: spicy ? "flame.fill" : "flame")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(spicy ? Color.orange : Color.secondary)
                .frame(width: 34, height: 34)
                .background(.thinMaterial, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(spicy ? "关闭吃辣标签" : "开启吃辣标签")
        .accessibilityAddTraits(spicy ? .isSelected : [])
    }

    private var ratingPicker: some View {
        HStack(spacing: 4) {
            ForEach(1...5, id: \.self) { value in
                Button {
                    rating = rating == value ? nil : value
                } label: {
                    Image(systemName: rating.map { value <= $0 } == true ? "star.fill" : "star")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(rating.map { value <= $0 } == true ? Color(red: 0.82, green: 0.58, blue: 0.18) : .secondary)
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(value) 星")
                .accessibilityAddTraits(rating == value ? .isSelected : [])
            }
        }
    }

    private var statusLabel: String {
        if status < 0.34 { return "上善若水" }
        if status > 0.66 { return "坚如磐石" }
        return "中庸之道"
    }

    private func saveRecord() {
        let record = WatchRecord(
            id: UUID(),
            date: Date(),
            color: customColorHex ?? (colors.indices.contains(selectedColor) ? colors[selectedColor].hex : nil),
            status: hasStatus ? status : nil,
            spicy: spicy,
            rating: rating
        )

        do {
            let recordsKey = "shiji-watch-records"
            let defaults = UserDefaults(suiteName: "group.com.mingyu.shiji") ?? .standard
            if defaults.data(forKey: recordsKey) == nil,
               let legacyData = UserDefaults.standard.data(forKey: recordsKey) {
                defaults.set(legacyData, forKey: recordsKey)
            }
            let existing = defaults.data(forKey: recordsKey) ?? Data("[]".utf8)
            var records = try JSONDecoder().decode([WatchRecord].self, from: existing)
            records.append(record)
            defaults.set(try JSONEncoder().encode(records), forKey: recordsKey)
            savedAt = record.date
            feedback = ""
            WKInterfaceDevice.current().play(.success)
            selectedColor = -1
            customColorHex = nil
            hasStatus = false
            status = 0.5
            spicy = false
            rating = nil
        } catch {
            feedback = "保存失败，请重试"
            WKInterfaceDevice.current().play(.failure)
        }
    }
}

private struct WatchColorPaletteView: View {
    let initialHex: String?
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var hue = 38.0
    @State private var lightness = 46.0

    private var selectedColor: Color {
        Color(hex: ColorPalette.hex(hue: hue, lightness: lightness))
    }

    var body: some View {
        VStack(spacing: 9) {
            hueBar
                .frame(height: 26)

            lightnessBar
                .frame(height: 26)

            HStack(spacing: 8) {
                Text(ColorPalette.hex(hue: hue, lightness: lightness))
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    .foregroundStyle(.primary)

                Spacer(minLength: 4)

                Button(action: confirmColor) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .bold))
                        .frame(width: 30, height: 30)
                        .background(Color.green.opacity(0.9), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("使用此颜色")
            }
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .onAppear {
            if let initialHex, let components = ColorPalette.hsl(from: initialHex) {
                hue = components.hue
                lightness = components.lightness
            }
        }
    }

    private var hueBar: some View {
        GeometryReader { geometry in
            let width = max(geometry.size.width, 18)
            let usableWidth = max(width - 18, 1)
            let position = ColorPalette.hueToPosition(hue)

            ZStack {
                Capsule()
                    .fill(ColorPalette.hueGradient)
                    .frame(height: 12)
                    .padding(.horizontal, 9)

                sliderThumb
                    .position(x: 9 + usableWidth * position, y: geometry.size.height / 2)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                let fraction = min(1, max(0, (value.location.x - 9) / usableWidth))
                hue = ColorPalette.positionToHue(fraction)
            })
        }
    }

    private var lightnessBar: some View {
        GeometryReader { geometry in
            let width = max(geometry.size.width, 18)
            let usableWidth = max(width - 18, 1)
            let fraction = (lightness - 8) / 84

            ZStack {
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "#171717"), selectedColor, .white],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: 12)
                    .padding(.horizontal, 9)

                sliderThumb
                    .position(x: 9 + usableWidth * fraction, y: geometry.size.height / 2)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                let position = min(1, max(0, (value.location.x - 9) / usableWidth))
                lightness = 8 + position * 84
            })
        }
    }

    private var sliderThumb: some View {
        Circle()
            .fill(selectedColor)
            .frame(width: 19, height: 19)
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .shadow(color: .black.opacity(0.4), radius: 2)
    }

    private func confirmColor() {
        onSelect(ColorPalette.hex(hue: hue, lightness: lightness))
        dismiss()
    }
}

private enum ColorPalette {
    private static let hueStops: [(position: Double, hue: Double)] = [
        (0, 0), (20, 20), (65, 70), (78, 150), (86, 200), (94, 260), (100, 360),
    ]

    static let hueGradient = LinearGradient(
        stops: [
            .init(color: Color(hex: "#FF0000"), location: 0.00),
            .init(color: Color(hex: "#FF3300"), location: 0.10),
            .init(color: Color(hex: "#FF7900"), location: 0.20),
            .init(color: Color(hex: "#FFC400"), location: 0.42),
            .init(color: Color(hex: "#E8F000"), location: 0.65),
            .init(color: Color(hex: "#47BD42"), location: 0.78),
            .init(color: Color(hex: "#26C7D6"), location: 0.86),
            .init(color: Color(hex: "#2855D9"), location: 0.94),
            .init(color: Color(hex: "#A833CC"), location: 0.97),
            .init(color: Color(hex: "#FF0000"), location: 1.00),
        ],
        startPoint: .leading,
        endPoint: .trailing
    )

    static func positionToHue(_ position: Double) -> Double {
        interpolate(position * 100, input: { $0.position }, output: { $0.hue })
    }

    static func hueToPosition(_ hue: Double) -> Double {
        interpolate(hue, input: { $0.hue }, output: { $0.position }) / 100
    }

    private static func interpolate(
        _ value: Double,
        input: ((position: Double, hue: Double)) -> Double,
        output: ((position: Double, hue: Double)) -> Double
    ) -> Double {
        for pair in zip(hueStops, hueStops.dropFirst()) {
            let lower = input(pair.0)
            let upper = input(pair.1)
            if value <= upper {
                let fraction = (value - lower) / max(upper - lower, 0.0001)
                return output(pair.0) + (output(pair.1) - output(pair.0)) * fraction
            }
        }
        return hueStops.last.map(output) ?? value
    }

    static func hex(hue: Double, lightness: Double) -> String {
        let saturation = 0.72
        let lightnessRatio = lightness / 100
        let chroma = (1 - abs(2 * lightnessRatio - 1)) * saturation
        let section = hue / 60
        let secondary = chroma * (1 - abs(section.truncatingRemainder(dividingBy: 2) - 1))
        let red: Double
        let green: Double
        let blue: Double
        if section < 1 { (red, green, blue) = (chroma, secondary, 0) }
        else if section < 2 { (red, green, blue) = (secondary, chroma, 0) }
        else if section < 3 { (red, green, blue) = (0, chroma, secondary) }
        else if section < 4 { (red, green, blue) = (0, secondary, chroma) }
        else if section < 5 { (red, green, blue) = (secondary, 0, chroma) }
        else { (red, green, blue) = (chroma, 0, secondary) }
        let offset = lightnessRatio - chroma / 2
        return String(format: "#%02X%02X%02X", Int((red + offset) * 255), Int((green + offset) * 255), Int((blue + offset) * 255))
    }

    static func hsl(from hex: String) -> (hue: Double, lightness: Double)? {
        let value = UInt(hex.dropFirst(), radix: 16) ?? 0
        let red = Double((value >> 16) & 0xff) / 255
        let green = Double((value >> 8) & 0xff) / 255
        let blue = Double(value & 0xff) / 255
        let maximum = max(red, green, blue)
        let minimum = min(red, green, blue)
        let delta = maximum - minimum
        let lightness = (maximum + minimum) * 50
        guard delta > 0 else { return (0, lightness) }
        var hue: Double
        if maximum == red { hue = ((green - blue) / delta).truncatingRemainder(dividingBy: 6) }
        else if maximum == green { hue = (blue - red) / delta + 2 }
        else { hue = (red - green) / delta + 4 }
        hue = (hue * 60).truncatingRemainder(dividingBy: 360)
        if hue < 0 { hue += 360 }
        return (hue, lightness)
    }
}

private extension Color {
    init(hex: String) {
        let value = UInt(hex.dropFirst(), radix: 16) ?? 0
        self.init(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }
}
