import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            Image("IntellaLogo")
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 240, maxHeight: 240)
                .accessibilityLabel("Intella")
        }
    }
}

#Preview {
    ContentView()
}
