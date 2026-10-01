import SwiftUI

public struct CommentSheetView: View {
    public let awemeId: String
    public var onClose: () -> Void
    
    @State private var comments: [CommentItem] = []
    @State private var isLoading: Bool = true
    @State private var errorMessage: String? = nil
    
    public init(awemeId: String, onClose: @escaping () -> Void) {
        self.awemeId = awemeId
        self.onClose = onClose
    }
    
    public var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("评论 \(comments.count > 0 ? "(\(comments.count))" : "")")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.primary)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            
            Divider()
            
            // Content
            if isLoading {
                VStack(spacing: 12) {
                    Spacer()
                    ProgressView()
                    Text("正在加载评论...")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                    Spacer()
                }
            } else if let error = errorMessage {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 28))
                        .foregroundColor(.secondary)
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                    Button("重试") {
                        loadComments()
                    }
                    .buttonStyle(.borderedProminent)
                    Spacer()
                }
            } else if comments.isEmpty {
                VStack(spacing: 8) {
                    Spacer()
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 32))
                        .foregroundColor(.secondary)
                    Text("暂无评论，快来抢沙发~")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                    Spacer()
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(comments) { comment in
                            CommentRow(comment: comment)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(NSColor.windowBackgroundColor).opacity(0.95))
        .onAppear {
            loadComments()
        }
    }
    
    private func loadComments() {
        isLoading = true
        errorMessage = nil
        Task {
            do {
                let list = try await DouyinEngine.shared.fetchComments(awemeId: awemeId)
                await MainActor.run {
                    self.comments = list
                    self.isLoading = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = "加载评论失败"
                    self.isLoading = false
                }
            }
        }
    }
}

// MARK: - Comment Row
private struct CommentRow: View {
    let comment: CommentItem
    
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // User Avatar
            if let avatarUrl = comment.user?.bestAvatarUrl {
                AsyncImage(url: avatarUrl) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 34, height: 34)
                            .clipShape(Circle())
                    case .empty, .failure:
                        Circle()
                            .fill(Color.gray.opacity(0.4))
                            .frame(width: 34, height: 34)
                            .overlay(Image(systemName: "person.fill").font(.system(size: 14)).foregroundColor(.white))
                    @unknown default:
                        EmptyView()
                    }
                }
            } else {
                Circle()
                    .fill(Color.gray.opacity(0.4))
                    .frame(width: 34, height: 34)
                    .overlay(Image(systemName: "person.fill").font(.system(size: 14)).foregroundColor(.white))
            }
            
            // Text & Meta
            VStack(alignment: .leading, spacing: 4) {
                Text(comment.user?.nickname ?? "抖音用户")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.secondary)
                
                Text(comment.text ?? "")
                    .font(.system(size: 13))
                    .foregroundColor(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                
                HStack(spacing: 8) {
                    Text(comment.formattedTime)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                    
                    if let replyTotal = comment.replyCommentTotal, replyTotal > 0 {
                        Text("\(replyTotal) 条回复")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.accentColor)
                    }
                }
            }
            
            Spacer()
            
            // Digg / Like count
            VStack(spacing: 3) {
                Image(systemName: "heart")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
                if let digg = comment.diggCount, digg > 0 {
                    Text("\(digg)")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
            }
        }
    }
}
