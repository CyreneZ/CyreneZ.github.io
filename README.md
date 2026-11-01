# Cyrene ♡ Discord profile

Trang hồ sơ để gắn vào Discord: video edit, ảnh và vài dòng về mình. Đây là trang tĩnh chạy trên GitHub Pages, không cần server hay tài khoản gì thêm.

## Đăng bài

Chọn một hay nhiều file ảnh, video rồi **kéo thả vào `dang-bai.bat`**. Công cụ sẽ tự:

- nén video xuống tối đa 1080p, tạo ảnh bìa và đoạn xem trước,
- xoá thông tin ẩn trong file (vị trí GPS, tên máy),
- thêm bài vào trang, rồi hỏi có đăng lên web luôn không.

**Tên file chính là tiêu đề**: `đêm mưa.mp4` sẽ hiện là "đêm mưa". File tên kiểu `IMG_1234` hay `0602` thì để trống tiêu đề.

Bài mới xuất hiện sau vài phút. Bài cũ thì **chạy `xoa-bai.bat`** rồi gõ số thứ tự để xoá.

## Sửa thông tin

Mở `profile.json` bằng Notepad để đổi tên, dòng giới thiệu, username Discord và các link. Muốn sửa tiêu đề một bài thì sửa trong `posts.json`.

Sửa xong, **chạy `cap-nhat.bat`** để đưa thay đổi lên web. Bước này cũng làm mới khung xem trước trên Discord. Discord nhớ khung cũ khá lâu, muốn thấy bản mới ngay thì dán link kèm `?v=2`.

## Xem trước trên máy

Chạy `xem-thu.bat`, trang sẽ mở ở `http://localhost:5600/`.

## Trạng thái Discord trực tiếp (tuỳ chọn)

Vào [server Discord của Lanyard](https://discord.gg/lanyard), rồi đổi `"live": false` thành `true` trong `profile.json`. Trang sẽ hiện chấm online, trạng thái và bài đang nghe trên Spotify. Lanyard là dịch vụ bên thứ ba và các thông tin này sẽ công khai.

## Giới hạn của GitHub

- Cả trang tối đa 1 GB, công cụ sẽ báo mức đã dùng sau mỗi lần đăng. Một edit 30 giây sau khi nén nặng khoảng 15 MB.
- Mỗi file tối đa 100 MB. Video dài hơn sẽ bị nén mạnh hơn, nếu vẫn quá thì công cụ báo để bạn cắt ngắn.
- Tài khoản miễn phí bắt buộc repo công khai, ai cũng tải được ảnh và video. Bài đã xoá biến mất khỏi trang nhưng vẫn còn trong lịch sử Git.
- File HEIC của iPhone chưa đọc được, hãy đổi sang JPG trước.

## Cấu trúc

| File | Vai trò |
|---|---|
| `index.html`, `style.css`, `app.js` | Giao diện, đọc mọi nội dung từ hai file JSON |
| `profile.json` | Thông tin cá nhân |
| `posts.json` | Danh sách bài, do công cụ đăng bài ghi |
| `media/` | Ảnh, video đã nén và ảnh xem trước cho Discord |
| `tools/post.mjs` | Công cụ đăng bài, xoá bài |
| `serve.js` | Máy chủ xem trước |
