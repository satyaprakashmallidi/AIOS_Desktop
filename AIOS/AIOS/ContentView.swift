//
//  ContentView.swift
//  AIOS
//
//  Created by vamsi reddy on 11/05/26.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView(localFile: "index")
            .frame(minWidth: 800, minHeight: 600)
    }
}

#Preview {
    ContentView()
}
