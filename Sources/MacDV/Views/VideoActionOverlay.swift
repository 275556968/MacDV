import SwiftUI

public struct VideoActionOverlay: View {
    public let aweme: AwemeItem
    public let isPaused: Bool
    public let progress: Double // 0.0 ... 1.0
    public let isControlsVisible: Bool
    public let isPureMode: Bool
    public var onTogglePlay: () -> Void
    public var onOpenComment: () -> Void
    public var onToggleFullScreen: (() -> Void)? = nil
    
    @State private var isLiked: Bool = false
    @State private var isCollected: Bool = false
    @State private var showCopiedAlert: Bool = false
    @State private var rotationAngle: Double = 0.0
    
    public init(
        aweme: AwemeItem,
        isPaused: Bool,
        progress: Double,
        isControlsVisible: Bool = true,
        isPureMode: Bool = false,
        onTogglePlay: @escaping () -> Void,
        onOpenComment: @escaping () -> Void,
        onToggleFullScreen: (() -> Void)? = nil
    ) {
        self.aweme = aweme
        self.isPaused = isPaused
        self.progress = progress
        self.isControlsVisible = isControlsVisible
        self.isPureMode = isPureMode
        self.onTogglePlay = onTogglePlay
        self.onOpenComment = onOpenComment
        self.onToggleFullScreen = onToggleFullScreen
    }
    
    public var body: some View {
        ZStack {
            // Center Play/Pause & Fullscreen tap target
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(count: 2) {
                    onToggleFullScreen?()
                }
                .onTapGesture(count: 1) {
                    onTogglePlay()
                }
            
            if isPaused && !isPureMode {
                Circle()
                    .fill(Color.black.opacity(0.45))
                    .frame(width: 72, height: 72)
                    .overlay(
                        Image(systemName: "play.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white.opacity(0.9))
                            .offset(x: 3)
                    )
                    .transition(.scale.combined(with: .opacity))
            }
            
            // Bottom gradient shadow for readability
            VStack {
                Spacer()
                LinearGradient(
                    colors: [.clear, .black.opacity(0.3), .black.opacity(0.75)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 180)
                .allowsHitTesting(false)
            }
            .opacity(!isPureMode && (isControlsVisible || isPaused) ? 1.0 : 0.0)
            .animation(.easeInOut(duration: 0.25), value: !isPureMode && (isControlsVisible || isPaused))
            
            // Main Overlay UI
            VStack(spacing: 0) {
                Spacer()
                
                HStack(alignment: .bottom, spacing: 16) {
                    // Bottom-Left Info (Author & Desc)
                    VStack(alignment: .leading, spacing: 10) {
                        if let author = aweme.author {
                            HStack(spacing: 8) {
                                Text("@\(author.nickname ?? "抖音用户")")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(.white)
                                    .shadow(radius: 2)
                                
                                Text(aweme.qualityLabel)
                                    .font(.system(size: 10, weight: .heavy))
                                    .foregroundColor(.cyan)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(Color.cyan.opacity(0.25)))
                                    .overlay(Capsule().stroke(Color.cyan.opacity(0.5), lineWidth: 1))
                            }
                        }
                        
                        if let desc = aweme.desc, !desc.isEmpty {
                            Text(desc)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundColor(.white.opacity(0.95))
                                .lineLimit(3)
                                .shadow(radius: 2)
                        }
                        
                        // Music title
                        HStack(spacing: 6) {
                            Image(systemName: "music.note")
                                .font(.system(size: 11))
                            Text(aweme.music?.title ?? "原声 - \(aweme.author?.nickname ?? "抖音")")
                                .font(.system(size: 12))
                                .lineLimit(1)
                        }
                        .foregroundColor(.white.opacity(0.8))
                        .shadow(radius: 2)
                    }
                    .frame(maxWidth: 680, alignment: .leading)
                    .padding(.leading, 18)
                    .padding(.bottom, 22)
                    
                    // Right Action Buttons Column
                    VStack(spacing: 18) {
                        // Author Avatar
                        if let avatarUrl = aweme.author?.bestAvatarUrl {
                            AsyncImage(url: avatarUrl) { phase in
                                switch phase {
                                case .success(let image):
                                    image.resizable()
                                        .aspectRatio(contentMode: .fill)
                                        .frame(width: 48, height: 48)
                                        .clipShape(Circle())
                                        .overlay(Circle().stroke(Color.white, lineWidth: 2))
                                case .empty, .failure:
                                    Circle()
                                        .fill(Color.gray.opacity(0.6))
                                        .frame(width: 48, height: 48)
                                        .overlay(Image(systemName: "person.fill").foregroundColor(.white))
                                @unknown default:
                                    EmptyView()
                                }
                            }
                            .shadow(radius: 4)
                        }
                        
                        // Like Button
                        ActionButton(
                            icon: isLiked ? "heart.fill" : "heart.fill",
                            color: isLiked ? Color.red : Color.white,
                            count: aweme.statistics?.formattedDiggCount ?? "0"
                        ) {
                            withAnimation(.spring(response: 0.25, dampingFraction: 0.5)) {
                                isLiked.toggle()
                            }
                        }
                        
                        // Comment Button
                        ActionButton(
                            icon: "bubble.right.fill",
                            color: .white,
                            count: aweme.statistics?.formattedCommentCount ?? "0"
                        ) {
                            onOpenComment()
                        }
                        
                        // Favorite Button
                        ActionButton(
                            icon: isCollected ? "star.fill" : "star.fill",
                            color: isCollected ? Color.yellow : Color.white,
                            count: aweme.statistics?.formattedCollectCount ?? "0"
                        ) {
                            withAnimation(.spring(response: 0.25, dampingFraction: 0.5)) {
                                isCollected.toggle()
                            }
                        }
                        
                        // Share Button
                        ActionButton(
                            icon: "arrowshape.turn.up.right.fill",
                            color: .white,
                            count: aweme.statistics?.formattedShareCount ?? "分享"
                        ) {
                            let link = "https://www.douyin.com/video/\(aweme.awemeId)"
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(link, forType: .string)
                            withAnimation {
                                showCopiedAlert = true
                            }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                withAnimation {
                                    showCopiedAlert = false
                                }
                            }
                        }
                        
                        // Rotating Music Record
                        Circle()
                            .fill(LinearGradient(colors: [.gray.opacity(0.8), .black], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 38, height: 38)
                            .overlay(
                                Image(systemName: "opticaldisc.fill")
                                    .font(.system(size: 20))
                                    .foregroundColor(.white.opacity(0.85))
                            )
                            .rotationEffect(.degrees(rotationAngle))
                            .onAppear {
                                withAnimation(.linear(duration: 4).repeatForever(autoreverses: false)) {
                                    rotationAngle = 360.0
                                }
                            }
                            .shadow(radius: 4)
                    }
                    .padding(.trailing, 16)
                    .padding(.bottom, 20)
                }
                .opacity(!isPureMode && (isControlsVisible || isPaused) ? 1.0 : 0.0)
                .allowsHitTesting(!isPureMode)
                .animation(.easeInOut(duration: 0.25), value: !isPureMode && (isControlsVisible || isPaused))
                
                // Slim Progress Bar at the very bottom
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle()
                            .fill(Color.white.opacity(0.2))
                            .frame(height: 3)
                        Rectangle()
                            .fill(Color.white)
                            .frame(width: max(0, min(geo.size.width, geo.size.width * CGFloat(progress))), height: 3)
                    }
                }
                .frame(height: 3)
                .opacity(!isPureMode ? 1.0 : 0.0)
                .animation(.easeInOut(duration: 0.25), value: isPureMode)
            }
            
            // Copied Toast
            if showCopiedAlert {
                VStack {
                    Spacer().frame(height: 40)
                    Text("视频链接已复制到剪贴板")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(Color.black.opacity(0.8)))
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }
}

// MARK: - Action Button Component
private struct ActionButton: View {
    let icon: String
    let color: Color
    let count: String
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 26))
                    .foregroundColor(color)
                    .shadow(radius: 3)
                Text(count)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
                    .shadow(radius: 2)
            }
        }
        .buttonStyle(.plain)
    }
}
