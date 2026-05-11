import SwiftUI
import WebKit

#if os(macOS)
typealias ViewRepresentable = NSViewRepresentable
#elseif os(iOS)
typealias ViewRepresentable = UIViewRepresentable
#endif

struct WebView: ViewRepresentable {
    let url: URL?
    let localFile: String?

    init(url: URL) {
        self.url = url
        self.localFile = nil
    }

    init(localFile: String) {
        self.url = nil
        self.localFile = localFile
    }

    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView()
        loadContent(in: webView)
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
    }
    #elseif os(iOS)
    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        loadContent(in: webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
    }
    #endif

    private func loadContent(in webView: WKWebView) {
        if let localFile = localFile {
            if let path = Bundle.main.path(forResource: localFile, ofType: "html", inDirectory: "Web") {
                let fileURL = URL(fileURLWithPath: path)
                let directoryURL = fileURL.deletingLastPathComponent()
                webView.loadFileURL(fileURL, allowingReadAccessTo: directoryURL)
            }
        } else if let url = url {
            webView.load(URLRequest(url: url))
        }
    }
}
