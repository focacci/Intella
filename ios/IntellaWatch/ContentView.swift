import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            Image("IntellaLogo")
                .resizable()
                .scaledToFit()
                .padding(12)
                .accessibilityLabel("Intella")
        }
    }
}

#Preview {
    ContentView()
}
