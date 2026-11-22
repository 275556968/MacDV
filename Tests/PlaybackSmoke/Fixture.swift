import AVFoundation
import CoreVideo

struct SmokeError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw SmokeError(message) }
}

// Real H.264 clips, created in a disposable directory. No CDN, ffmpeg, camera,
// sample downloads or screen-recording permission required.
func writeClip(_ url: URL, red: UInt8, green: UInt8, blue: UInt8) throws {
    let w = 96, h = 64, fps = 12
    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h
    ])
    let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h,
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ])
    writer.add(input)
    try require(writer.startWriting(), "cannot start H.264 encoder: \(String(describing: writer.error))")
    writer.startSession(atSourceTime: .zero)
    var buffer: CVPixelBuffer?
    let result = CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_32BGRA, nil, &buffer)
    guard result == kCVReturnSuccess, let buffer else { throw SmokeError("pixel buffer allocation failed") }
    CVPixelBufferLockBaseAddress(buffer, [])
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
    for y in 0..<h {
        for x in 0..<w {
            let offset = y * stride + x * 4
            base[offset] = blue; base[offset + 1] = green; base[offset + 2] = red; base[offset + 3] = 255
        }
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    let deadline = Date().addingTimeInterval(15)
    for i in 0..<(fps * 5) {
        while !input.isReadyForMoreMediaData {
            try require(Date() < deadline && writer.status == .writing, "fixture encoding stalled")
            Thread.sleep(forTimeInterval: 0.005)
        }
        try require(adapter.append(buffer, withPresentationTime: CMTime(value: Int64(i), timescale: Int32(fps))), "fixture frame rejected")
    }
    input.markAsFinished()
    let gate = DispatchSemaphore(value: 0)
    writer.finishWriting { gate.signal() }
    try require(gate.wait(timeout: .now() + 15) == .success && writer.status == .completed, "cannot finish fixture: \(String(describing: writer.error))")
}
