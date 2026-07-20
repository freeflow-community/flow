// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Flow",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "Flow",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            linkerSettings: [
                // swift build autolinks the _AVKit_SwiftUI overlay but not
                // AVKit.framework itself; without this, instantiating
                // VideoPlayer aborts at runtime ("failed to demangle
                // superclass of VideoPlayerView from 'So12AVPlayerViewC'").
                .linkedFramework("AVKit"),
            ]
        ),
        .testTarget(
            name: "FlowTests",
            dependencies: ["Flow"]
        ),
    ]
)
